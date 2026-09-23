const socket = io();

let myId = null;
let myNickname = '';
let currentLobby = null;
let currentGameState = null;
let chatTargetId = null;
let chatHistories = {}; // targetId -> [{fromId, fromName, message, timestamp}]

// ---------- Screen helpers ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ---------- HOME ----------
const nicknameInput = document.getElementById('nickname-input');
const codeInput = document.getElementById('code-input');
const homeError = document.getElementById('home-error');

document.getElementById('btn-create').onclick = () => {
  const nickname = nicknameInput.value.trim();
  if (!nickname) return (homeError.textContent = 'Enter a nickname first.');
  myNickname = nickname;
  socket.emit('create_lobby', { nickname });
};

document.getElementById('btn-join').onclick = () => {
  const nickname = nicknameInput.value.trim();
  const code = codeInput.value.trim().toUpperCase();
  if (!nickname) return (homeError.textContent = 'Enter a nickname first.');
  if (!code) return (homeError.textContent = 'Enter a lobby code.');
  myNickname = nickname;
  socket.emit('join_lobby', { nickname, code });
};

function loadLeaderboard() {
  socket.emit('get_leaderboard');
}
socket.on('leaderboard_data', (data) => renderLeaderboard(data));

function renderLeaderboard(data) {
  const el = document.getElementById('leaderboard-list');
  if (!data || data.length === 0) {
    el.innerHTML = '<em>No matches played yet.</em>';
    return;
  }
  el.innerHTML = data.map((row, i) => `
    <div class="lb-row">
      <span><span class="lb-rank">#${i + 1}</span> ${escapeHtml(row.nickname)}</span>
      <span>${row.points} pts · ${row.wins}🏆</span>
    </div>
  `).join('');
}
loadLeaderboard();

// ---------- LOBBY ----------
socket.on('lobby_created', ({ code, you }) => {
  myId = you;
  homeError.textContent = '';
  showScreen('screen-lobby');
  document.getElementById('lobby-code-display').textContent = code;
});

socket.on('lobby_joined', ({ code, you }) => {
  myId = you;
  homeError.textContent = '';
  showScreen('screen-lobby');
  document.getElementById('lobby-code-display').textContent = code;
});

socket.on('lobby_update', (lobby) => {
  currentLobby = lobby;
  renderLobby(lobby);
});

function renderLobby(lobby) {
  const el = document.getElementById('lobby-players');
  el.innerHTML = lobby.players.map(p => `
    <div class="lobby-player-row">
      <span>${escapeHtml(p.nickname)} ${p.id === lobby.hostId ? '<span class="tag-host">HOST</span>' : ''}</span>
      <span class="tag-ready">${p.ready ? '✅ Ready' : '⏳ Not ready'}</span>
    </div>
  `).join('');

  const startBtn = document.getElementById('btn-start');
  if (lobby.hostId === myId) {
    startBtn.style.display = 'block';
  } else {
    startBtn.style.display = 'none';
  }
}

document.getElementById('btn-ready').onclick = () => socket.emit('toggle_ready');
document.getElementById('btn-start').onclick = () => socket.emit('start_game');

socket.on('error_message', (msg) => {
  const activeScreen = document.querySelector('.screen.active').id;
  if (activeScreen === 'screen-home') homeError.textContent = msg;
  else if (activeScreen === 'screen-lobby') document.getElementById('lobby-error').textContent = msg;
  else document.getElementById('attack-error').textContent = msg;
});

// ---------- GAME ----------
const TROOP_ICONS = { barbarian: '🪓', archer: '🏹', giant: '👹', wizard: '🧙' };

socket.on('game_started', (state) => {
  showScreen('screen-game');
  currentGameState = state;
  renderGame(state);
});

socket.on('game_update', (state) => {
  currentGameState = state;
  renderGame(state);
});

function renderGame(state) {
  renderBases(state);
  renderTrainPanel(state);
  renderAttackTargets(state);
  renderChatTargets(state);
  renderScoreboard(state);
  renderTopbar(state);
}

function me(state) {
  return state.players.find(p => p.id === myId);
}

function renderTopbar(state) {
  const m = me(state);
  document.getElementById('my-gold-display').textContent = `💰 ${m ? m.gold : 0}`;

  if (state.startedAt) {
    const elapsed = Date.now() - state.startedAt;
    const remaining = Math.max(0, state.timeLimitMs - elapsed);
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    document.getElementById('match-timer').textContent =
      `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}

function isAlly(state, otherId) {
  const key = [myId, otherId].sort().join('|');
  return state.alliances.includes(key);
}

function renderBases(state) {
  const el = document.getElementById('bases-row');
  el.innerHTML = state.players.map(p => {
    const pct = Math.round((p.base.health / p.base.maxHealth) * 100);
    const classes = ['base-card'];
    if (p.id === myId) classes.push('me');
    else if (isAlly(state, p.id)) classes.push('ally');
    if (!p.alive) classes.push('dead');

    const troopsStr = Object.entries(p.troops)
      .filter(([, c]) => c > 0)
      .map(([t, c]) => `${TROOP_ICONS[t]}${c}`)
      .join(' ') || 'No troops';

    let actionBtns = '';
    if (p.id !== myId && p.alive) {
      if (isAlly(state, p.id)) {
        actionBtns = `<button class="btn btn-small btn-secondary" onclick="breakAlliance('${p.id}')">Break Alliance</button>`;
      } else {
        actionBtns = `<button class="btn btn-small btn-secondary" onclick="proposeAlliance('${p.id}')">🤝 Ally</button>`;
      }
    }

    return `
      <div class="${classes.join(' ')}">
        <div class="base-name">
          <span>${p.id === myId ? '🏠 You' : escapeHtml(p.nickname)}${isAlly(state, p.id) && p.id !== myId ? ' <span class="ally-badge">ALLY</span>' : ''}</span>
          <span>${p.alive ? pct + '%' : '💀'}</span>
        </div>
        <div class="health-bar-bg"><div class="health-bar-fill" style="width:${pct}%"></div></div>
        <div class="base-troops">${troopsStr}</div>
        <div style="margin-top:6px">${actionBtns}</div>
      </div>
    `;
  }).join('');
}

function renderTrainPanel(state) {
  const m = me(state);
  const el = document.getElementById('train-list');
  if (!m) return;
  el.innerHTML = Object.entries(state.troopConfig).map(([type, cfg]) => `
    <div class="troop-row">
      <div>
        <div class="tname">${TROOP_ICONS[type]} ${cfg.name} (${m.troops[type]})</div>
        <div class="tstat">💰${cfg.cost} · ⚔️${cfg.power} · 🎯${cfg.killPoints}pts</div>
      </div>
      <div>
        <input type="number" min="1" max="50" value="1" id="train-count-${type}" />
        <button class="btn btn-small btn-primary" onclick="trainTroop('${type}')">Train</button>
      </div>
    </div>
  `).join('');
}

function trainTroop(type) {
  const count = parseInt(document.getElementById(`train-count-${type}`).value) || 1;
  socket.emit('train_troop', { troopType: type, count });
}

function renderAttackTargets(state) {
  const select = document.getElementById('attack-target');
  const prev = select.value;
  const targets = state.players.filter(p => p.id !== myId && p.alive);
  select.innerHTML = targets.map(p =>
    `<option value="${p.id}">${escapeHtml(p.nickname)}${isAlly(state, p.id) ? ' (Ally)' : ''}</option>`
  ).join('');
  if (targets.some(t => t.id === prev)) select.value = prev;
  renderAttackTroopInputs(state);
  select.onchange = () => renderAttackTroopInputs(state);
}

function renderAttackTroopInputs(state) {
  const m = me(state);
  const el = document.getElementById('attack-troop-inputs');
  if (!m) return;
  el.innerHTML = Object.entries(state.troopConfig).map(([type, cfg]) => `
    <div class="troop-row">
      <div class="tname">${TROOP_ICONS[type]} ${cfg.name} (have ${m.troops[type]})</div>
      <input type="number" min="0" max="${m.troops[type]}" value="0" id="attack-count-${type}" />
    </div>
  `).join('');
}

document.getElementById('btn-attack').onclick = () => {
  const targetId = document.getElementById('attack-target').value;
  const errEl = document.getElementById('attack-error');
  errEl.textContent = '';
  if (!targetId) return (errEl.textContent = 'Choose a target.');
  const troops = {};
  Object.keys(currentGameState.troopConfig).forEach(type => {
    const val = parseInt(document.getElementById(`attack-count-${type}`).value) || 0;
    if (val > 0) troops[type] = val;
  });
  if (Object.keys(troops).length === 0) return (errEl.textContent = 'Select troops to send.');
  socket.emit('attack', { targetId, troops });
};

socket.on('attack_result', (r) => {
  const log = document.getElementById('battle-log');
  const entry = document.createElement('div');
  entry.className = 'log-entry ' + (r.attackSucceeded ? 'win' : 'fail');
  const sentStr = Object.entries(r.sentTroops).map(([t, c]) => `${TROOP_ICONS[t]}${c}`).join(' ');
  if (r.attackSucceeded) {
    entry.textContent = `⚔️ ${r.attackerName} attacked ${r.defenderName} with ${sentStr} → dealt ${r.baseDamage} dmg (+${r.pointsEarned} pts)${r.defenderDefeated ? ' 💀 BASE DESTROYED!' : ''}`;
  } else {
    entry.textContent = `🛡️ ${r.defenderName} repelled ${r.attackerName}'s attack (${sentStr})`;
  }
  log.prepend(entry);
});

function renderScoreboard(state) {
  const el = document.getElementById('scoreboard-list');
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  el.innerHTML = sorted.map(p => `
    <div class="score-row">
      <span>${p.id === myId ? '👉 ' : ''}${escapeHtml(p.nickname)} ${!p.alive ? '💀' : ''}</span>
      <span>${p.score} pts</span>
    </div>
  `).join('');
}

// ---------- Alliances ----------
function proposeAlliance(targetId) {
  socket.emit('propose_alliance', { targetId });
}
function breakAlliance(targetId) {
  socket.emit('break_alliance', { targetId });
}

const allianceToast = document.getElementById('alliance-toast');
let pendingAllianceFrom = null;

socket.on('alliance_request', ({ fromId, fromName }) => {
  pendingAllianceFrom = fromId;
  document.getElementById('alliance-toast-text').textContent = `${fromName} wants to ally with you`;
  allianceToast.style.display = 'flex';
});

document.getElementById('alliance-accept').onclick = () => {
  if (pendingAllianceFrom) socket.emit('respond_alliance', { targetId: pendingAllianceFrom, accept: true });
  allianceToast.style.display = 'none';
};
document.getElementById('alliance-decline').onclick = () => {
  if (pendingAllianceFrom) socket.emit('respond_alliance', { targetId: pendingAllianceFrom, accept: false });
  allianceToast.style.display = 'none';
};

socket.on('alliance_response', ({ fromName, accepted }) => {
  const log = document.getElementById('battle-log');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.textContent = accepted ? `🤝 ${fromName} accepted your alliance request.` : `${fromName} declined your alliance request.`;
  log.prepend(entry);
});

// ---------- Chat ----------
function renderChatTargets(state) {
  const select = document.getElementById('chat-target');
  const prev = select.value;
  const others = state.players.filter(p => p.id !== myId);
  select.innerHTML = others.map(p => `<option value="${p.id}">${escapeHtml(p.nickname)}</option>`).join('');
  if (others.some(o => o.id === prev)) select.value = prev;
  else if (others[0]) select.value = others[0].id;
  chatTargetId = select.value;
  select.onchange = () => { chatTargetId = select.value; renderChatMessages(); };
  if (!document.getElementById('chat-target').dataset.bound) {
    document.getElementById('chat-target').dataset.bound = '1';
  }
  renderChatMessages();
}

document.getElementById('btn-send-chat').onclick = sendChat;
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

function sendChat() {
  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message || !chatTargetId) return;
  socket.emit('private_message', { targetId: chatTargetId, message });
  input.value = '';
}

socket.on('private_message', (msg) => {
  const otherId = msg.fromId === myId ? msg.toId : msg.fromId;
  if (!chatHistories[otherId]) chatHistories[otherId] = [];
  chatHistories[otherId].push(msg);
  if (otherId === chatTargetId) renderChatMessages();
});

function renderChatMessages() {
  const el = document.getElementById('chat-messages');
  const history = chatHistories[chatTargetId] || [];
  el.innerHTML = history.map(m => `
    <div class="chat-msg"><span class="who">${m.fromId === myId ? 'You' : escapeHtml(m.fromName)}:</span> ${escapeHtml(m.message)}</div>
  `).join('');
  el.scrollTop = el.scrollHeight;
}

// ---------- Game Over ----------
socket.on('game_over', ({ winnerId, scores, leaderboard }) => {
  const modal = document.getElementById('modal-gameover');
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  document.getElementById('gameover-title').textContent =
    winnerId ? `🏆 ${sorted.find(s => s.id === winnerId)?.nickname || 'Someone'} wins!` : 'Game Over';
  document.getElementById('gameover-scores').innerHTML = sorted.map((s, i) => `
    <div class="gameover-row"><span>#${i + 1} ${escapeHtml(s.nickname)}${s.id === myId ? ' (you)' : ''}</span><span>${s.score} pts</span></div>
  `).join('');
  modal.classList.add('active');
  renderLeaderboard(leaderboard);
});

document.getElementById('btn-back-home').onclick = () => {
  document.getElementById('modal-gameover').classList.remove('active');
  showScreen('screen-home');
  chatHistories = {};
  loadLeaderboard();
};

// ---------- Live timer refresh ----------
setInterval(() => {
  if (currentGameState && currentGameState.status === 'playing') {
    renderTopbar(currentGameState);
  }
}, 1000);

// ---------- Utils ----------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
