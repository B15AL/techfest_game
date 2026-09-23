const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TROOPS = require('./troops');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ---------- Leaderboard (simple JSON file persistence) ----------
const LB_FILE = path.join(__dirname, 'leaderboard.json');
function loadLeaderboard() {
  try {
    return JSON.parse(fs.readFileSync(LB_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}
function saveLeaderboard(lb) {
  fs.writeFileSync(LB_FILE, JSON.stringify(lb, null, 2));
}
let leaderboard = loadLeaderboard(); // { nickname: { points, wins, matches } }

function recordResult(nickname, points, won) {
  if (!leaderboard[nickname]) leaderboard[nickname] = { points: 0, wins: 0, matches: 0 };
  leaderboard[nickname].points += points;
  leaderboard[nickname].matches += 1;
  if (won) leaderboard[nickname].wins += 1;
  saveLeaderboard(leaderboard);
}

function getTopLeaderboard(n = 20) {
  return Object.entries(leaderboard)
    .map(([nickname, v]) => ({ nickname, ...v }))
    .sort((a, b) => b.points - a.points)
    .slice(0, n);
}

// ---------- Lobby / Game state (in-memory) ----------
// lobbies: { [code]: LobbyObject }
const lobbies = {};

const MAX_PLAYERS = 4;
const STARTING_GOLD = 150;
const STARTING_HEALTH = 1000;
const GOLD_TICK_MS = 3000;
const GOLD_PER_TICK = 15;
const MATCH_TIME_LIMIT_MS = 10 * 60 * 1000; // 10 minutes

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (lobbies[code]);
  return code;
}

function makePlayer(id, nickname, socketId) {
  return {
    id,
    nickname,
    socketId,
    ready: false,
    connected: true,
    gold: STARTING_GOLD,
    base: { health: STARTING_HEALTH, maxHealth: STARTING_HEALTH },
    troops: { barbarian: 0, archer: 0, giant: 0, wizard: 0 },
    score: 0,
    alive: true
  };
}

function lobbyPublicState(lobby) {
  return {
    code: lobby.code,
    hostId: lobby.hostId,
    status: lobby.status,
    players: Object.values(lobby.players).map(p => ({
      id: p.id, nickname: p.nickname, ready: p.ready, connected: p.connected
    }))
  };
}

function gamePublicState(lobby) {
  const allianceList = Array.from(lobby.alliances);
  return {
    code: lobby.code,
    status: lobby.status,
    startedAt: lobby.startedAt,
    timeLimitMs: MATCH_TIME_LIMIT_MS,
    alliances: allianceList,
    players: Object.values(lobby.players).map(p => ({
      id: p.id,
      nickname: p.nickname,
      connected: p.connected,
      gold: p.gold,
      base: p.base,
      troops: p.troops,
      score: p.score,
      alive: p.alive
    })),
    troopConfig: TROOPS
  };
}

function broadcastLobby(lobby) {
  io.to(lobby.code).emit('lobby_update', lobbyPublicState(lobby));
}
function broadcastGame(lobby) {
  io.to(lobby.code).emit('game_update', gamePublicState(lobby));
}

function allianceKey(a, b) {
  return [a, b].sort().join('|');
}

function endMatch(lobby, reason) {
  if (lobby.status !== 'playing') return;
  lobby.status = 'ended';
  clearInterval(lobby.goldInterval);

  const players = Object.values(lobby.players);
  let winner = null;
  const alivePlayers = players.filter(p => p.alive);
  if (alivePlayers.length === 1) {
    winner = alivePlayers[0];
  } else {
    // time limit or tie -> highest score wins
    winner = players.reduce((a, b) => (b.score > a.score ? b : a), players[0]);
  }
  if (winner) winner.score += 100; // winner bonus

  players.forEach(p => {
    recordResult(p.nickname, p.score, winner && p.id === winner.id);
  });

  io.to(lobby.code).emit('game_over', {
    reason,
    winnerId: winner ? winner.id : null,
    scores: players.map(p => ({ id: p.id, nickname: p.nickname, score: p.score })),
    leaderboard: getTopLeaderboard()
  });
}

function checkForWinner(lobby) {
  const players = Object.values(lobby.players);
  const alive = players.filter(p => p.alive);
  if (alive.length <= 1 && lobby.status === 'playing') {
    endMatch(lobby, 'last_base_standing');
  }
}

io.on('connection', (socket) => {
  socket.data.playerId = null;
  socket.data.lobbyCode = null;

  socket.on('create_lobby', ({ nickname }) => {
    nickname = (nickname || 'Player').toString().slice(0, 16);
    const code = genCode();
    const playerId = socket.id;
    const lobby = {
      code,
      hostId: playerId,
      status: 'waiting',
      players: {},
      alliances: new Set(),
      pendingAllianceRequests: {}, // key targetId -> Set of requesterIds
      startedAt: null,
      goldInterval: null
    };
    lobby.players[playerId] = makePlayer(playerId, nickname, socket.id);
    lobbies[code] = lobby;

    socket.join(code);
    socket.data.playerId = playerId;
    socket.data.lobbyCode = code;

    socket.emit('lobby_created', { code, you: playerId });
    broadcastLobby(lobby);
  });

  socket.on('join_lobby', ({ nickname, code }) => {
    code = (code || '').toString().toUpperCase().trim();
    const lobby = lobbies[code];
    if (!lobby) return socket.emit('error_message', 'Lobby not found.');
    if (lobby.status !== 'waiting') return socket.emit('error_message', 'Game already started.');
    if (Object.keys(lobby.players).length >= MAX_PLAYERS) return socket.emit('error_message', 'Lobby is full.');

    nickname = (nickname || 'Player').toString().slice(0, 16);
    const playerId = socket.id;
    lobby.players[playerId] = makePlayer(playerId, nickname, socket.id);

    socket.join(code);
    socket.data.playerId = playerId;
    socket.data.lobbyCode = code;

    socket.emit('lobby_joined', { code, you: playerId });
    broadcastLobby(lobby);
  });

  socket.on('toggle_ready', () => {
    const lobby = lobbies[socket.data.lobbyCode];
    if (!lobby) return;
    const p = lobby.players[socket.data.playerId];
    if (!p) return;
    p.ready = !p.ready;
    broadcastLobby(lobby);
  });

  socket.on('start_game', () => {
    const lobby = lobbies[socket.data.lobbyCode];
    if (!lobby) return;
    if (lobby.hostId !== socket.data.playerId) return socket.emit('error_message', 'Only host can start.');
    const playerCount = Object.keys(lobby.players).length;
    if (playerCount < 2) return socket.emit('error_message', 'Need at least 2 players.');
    if (lobby.status !== 'waiting') return;

    lobby.status = 'playing';
    lobby.startedAt = Date.now();

    lobby.goldInterval = setInterval(() => {
      Object.values(lobby.players).forEach(p => {
        if (p.alive) p.gold += GOLD_PER_TICK;
      });
      broadcastGame(lobby);
      if (Date.now() - lobby.startedAt >= MATCH_TIME_LIMIT_MS) {
        endMatch(lobby, 'time_limit');
      }
    }, GOLD_TICK_MS);

    io.to(lobby.code).emit('game_started', gamePublicState(lobby));
  });

  socket.on('train_troop', ({ troopType, count }) => {
    const lobby = lobbies[socket.data.lobbyCode];
    if (!lobby || lobby.status !== 'playing') return;
    const p = lobby.players[socket.data.playerId];
    if (!p || !p.alive) return;
    const troop = TROOPS[troopType];
    count = Math.max(1, Math.min(50, parseInt(count) || 0));
    if (!troop || !count) return;
    const totalCost = troop.cost * count;
    if (p.gold < totalCost) return socket.emit('error_message', 'Not enough gold.');
    p.gold -= totalCost;
    p.troops[troopType] += count;
    broadcastGame(lobby);
  });

  socket.on('attack', ({ targetId, troops }) => {
    const lobby = lobbies[socket.data.lobbyCode];
    if (!lobby || lobby.status !== 'playing') return;
    const attacker = lobby.players[socket.data.playerId];
    const defender = lobby.players[targetId];
    if (!attacker || !defender || !attacker.alive || !defender.alive) return;
    if (attacker.id === defender.id) return;
    if (lobby.alliances.has(allianceKey(attacker.id, defender.id))) {
      return socket.emit('error_message', "You can't attack an ally. Break the alliance first.");
    }

    // Validate & deduct attacker troops
    let totalAttackPower = 0;
    const sentTroops = {};
    for (const [type, cnt] of Object.entries(troops || {})) {
      const c = Math.max(0, Math.min(attacker.troops[type] || 0, parseInt(cnt) || 0));
      if (c > 0) {
        sentTroops[type] = c;
        totalAttackPower += TROOPS[type].power * c;
      }
    }
    if (totalAttackPower <= 0) return socket.emit('error_message', 'Send at least one troop to attack.');
    for (const [type, c] of Object.entries(sentTroops)) attacker.troops[type] -= c;

    // Build defender garrison list (weakest troop first)
    let garrison = [];
    for (const [type, c] of Object.entries(defender.troops)) {
      for (let i = 0; i < c; i++) garrison.push(type);
    }
    garrison.sort((a, b) => TROOPS[a].power - TROOPS[b].power);

    let remainingPower = totalAttackPower;
    let killedCount = {};
    let pointsEarned = 0;
    let i = 0;
    for (; i < garrison.length; i++) {
      const t = garrison[i];
      if (remainingPower >= TROOPS[t].power) {
        remainingPower -= TROOPS[t].power;
        defender.troops[t] -= 1;
        killedCount[t] = (killedCount[t] || 0) + 1;
        pointsEarned += TROOPS[t].killPoints;
      } else {
        break;
      }
    }

    const brokeThrough = i === garrison.length; // all defender troops destroyed
    let baseDamage = 0;
    let attackSucceeded = false;

    if (brokeThrough && remainingPower > 0) {
      // Attack breaks through to the base; attacking troops survive & return home
      baseDamage = remainingPower;
      defender.base.health = Math.max(0, defender.base.health - baseDamage);
      for (const [type, c] of Object.entries(sentTroops)) attacker.troops[type] += c;
      attackSucceeded = true;
      if (defender.base.health <= 0) {
        defender.alive = false;
        pointsEarned += 150; // bonus for destroying a base
      }
    } else {
      // Attack repelled: sent troops are lost, only partial troop-kill points earned
    }

    attacker.score += pointsEarned;

    io.to(lobby.code).emit('attack_result', {
      attackerId: attacker.id,
      attackerName: attacker.nickname,
      defenderId: defender.id,
      defenderName: defender.nickname,
      sentTroops,
      killedCount,
      baseDamage,
      attackSucceeded,
      pointsEarned,
      defenderDefeated: !defender.alive
    });

    broadcastGame(lobby);
    checkForWinner(lobby);
  });

  socket.on('propose_alliance', ({ targetId }) => {
    const lobby = lobbies[socket.data.lobbyCode];
    if (!lobby || lobby.status !== 'playing') return;
    const from = lobby.players[socket.data.playerId];
    const to = lobby.players[targetId];
    if (!from || !to || from.id === to.id) return;
    const target = lobby.players[targetId];
    if (!lobby.pendingAllianceRequests[targetId]) lobby.pendingAllianceRequests[targetId] = new Set();
    lobby.pendingAllianceRequests[targetId].add(from.id);
    io.to(target.socketId).emit('alliance_request', { fromId: from.id, fromName: from.nickname });
  });

  socket.on('respond_alliance', ({ targetId, accept }) => {
    const lobby = lobbies[socket.data.lobbyCode];
    if (!lobby) return;
    const me = lobby.players[socket.data.playerId];
    if (!me) return;
    const pending = lobby.pendingAllianceRequests[me.id];
    if (!pending || !pending.has(targetId)) return;
    pending.delete(targetId);
    if (accept) {
      lobby.alliances.add(allianceKey(me.id, targetId));
      broadcastGame(lobby);
    }
    const requester = lobby.players[targetId];
    if (requester) {
      io.to(requester.socketId).emit('alliance_response', { fromId: me.id, fromName: me.nickname, accepted: !!accept });
    }
  });

  socket.on('break_alliance', ({ targetId }) => {
    const lobby = lobbies[socket.data.lobbyCode];
    if (!lobby) return;
    const me = lobby.players[socket.data.playerId];
    if (!me) return;
    lobby.alliances.delete(allianceKey(me.id, targetId));
    broadcastGame(lobby);
  });

  socket.on('private_message', ({ targetId, message }) => {
    const lobby = lobbies[socket.data.lobbyCode];
    if (!lobby) return;
    const me = lobby.players[socket.data.playerId];
    const target = lobby.players[targetId];
    if (!me || !target || !message) return;
    message = message.toString().slice(0, 500);
    const payload = { fromId: me.id, fromName: me.nickname, toId: target.id, message, timestamp: Date.now() };
    io.to(target.socketId).emit('private_message', payload);
    socket.emit('private_message', payload); // echo to sender
  });

  socket.on('get_leaderboard', () => {
    socket.emit('leaderboard_data', getTopLeaderboard());
  });

  socket.on('leave_lobby', () => {
    handleDisconnectLogic(socket);
  });

  socket.on('disconnect', () => {
    handleDisconnectLogic(socket);
  });

  function handleDisconnectLogic(sock) {
    const code = sock.data.lobbyCode;
    const lobby = lobbies[code];
    if (!lobby) return;
    const p = lobby.players[sock.data.playerId];
    if (!p) return;

    if (lobby.status === 'waiting') {
      delete lobby.players[p.id];
      if (lobby.hostId === p.id) {
        const remaining = Object.keys(lobby.players);
        lobby.hostId = remaining[0] || null;
      }
      if (Object.keys(lobby.players).length === 0) {
        delete lobbies[code];
      } else {
        broadcastLobby(lobby);
      }
    } else if (lobby.status === 'playing') {
      p.connected = false;
      p.alive = false; // disconnected player is knocked out
      broadcastGame(lobby);
      checkForWinner(lobby);
    }
  }
});

app.get('/api/leaderboard', (req, res) => {
  res.json(getTopLeaderboard());
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Clan Clash Lite running on http://localhost:${PORT}`);
});
