const socket = io();

let myId = null;
let myNickname = '';
let currentLobby = null;
let activePlayers = [];
let myPlayerIndex = -1;

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
  const pin = document.getElementById('pin-input').value.trim();
  if (!nickname) return (homeError.textContent = 'Enter a nickname first.');
  if (!/^\d{4}$/.test(pin)) return (homeError.textContent = 'Enter a 4-digit PIN.');
  myNickname = nickname;
  homeError.textContent = '';
  socket.emit('create_lobby', { nickname, pin });
};

document.getElementById('btn-join').onclick = () => {
  const nickname = nicknameInput.value.trim();
  const pin = document.getElementById('pin-input').value.trim();
  const code = codeInput.value.trim().toUpperCase();
  if (!nickname) return (homeError.textContent = 'Enter a nickname first.');
  if (!/^\d{4}$/.test(pin)) return (homeError.textContent = 'Enter a 4-digit PIN.');
  if (!code) return (homeError.textContent = 'Enter a lobby code.');
  myNickname = nickname;
  homeError.textContent = '';
  socket.emit('join_lobby', { nickname, pin, code });
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
      <span class="tag-ready">${p.ready ? 'Ready' : 'Not ready'}</span>
    </div>
  `).join('');

  const startBtn = document.getElementById('btn-start');
  startBtn.style.display = lobby.hostId === myId ? 'block' : 'none';
}

document.getElementById('btn-ready').onclick = () => socket.emit('toggle_ready');
document.getElementById('btn-start').onclick = () => socket.emit('start_game');
document.getElementById('btn-leave').onclick = () => {
  socket.emit('leave_lobby');
  currentLobby = null;
  myId = null;
  myPlayerIndex = -1;
  document.getElementById('lobby-error').textContent = '';
  showScreen('screen-home');
  loadLeaderboard();
};

socket.on('error_message', (msg) => {
  const activeScreen = document.querySelector('.screen.active')?.id;
  if (activeScreen === 'screen-home') homeError.textContent = msg;
  else if (activeScreen === 'screen-lobby') document.getElementById('lobby-error').textContent = msg;
});

// ---------- FOUR KEEPS GAME ENGINE ----------
const W = 900, HW = 170, HD = 48;
const CASTLE_HP = 1500, CASTLE_RANGE = 150, CASTLE_DMG = 12, CASTLE_CD = 0.8;
const GOLD_CAP = 500, BASE_INCOME = 5, MINE_BONUS = 4, MINE_R = 58, LOOT = 150, LEADER_BONUS = 1.15;
const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
const SERIF = 'Cinzel,Georgia,serif';

const SEATS = [
  { name:'South', cx:450, cy:852, ang:0 },
  { name:'West',  cx:48,  cy:450, ang:Math.PI/2 },
  { name:'North', cx:450, cy:48,  ang:Math.PI },
  { name:'East',  cx:852, cy:450, ang:-Math.PI/2 },
];
const COLORS = [
  { name:'Blue',  c:'#5b93ff', d:'#28498f' },
  { name:'Green', c:'#4fd18b', d:'#1f6f46' },
  { name:'Red',   c:'#ff6262', d:'#8f2a2a' },
  { name:'Gold',  c:'#ffd23f', d:'#8a6d0c' },
];
const KEYS = [['z','x','c','v'],['q','w','e','r'],['u','i','o','p'],['7','8','9','0']];
const UT = ['knight','archer','catapult'];
const TYPES = {
  knight:  { label:'Knight',   hp:110, speed:38, dmg:11, cd:.8,  range:6,   cost:25, r:7,  sight:85,  castleMult:1 },
  archer:  { label:'Archer',   hp:55,  speed:46, dmg:8,  cd:.65, range:88,  cost:30, r:6,  sight:115, castleMult:.6 },
  catapult:{ label:'Catapult', hp:80,  speed:22, dmg:32, cd:2.4, range:140, minRange:38, cost:55, r:9, sight:150, castleMult:2.5, splash:30 },
};
const MULT = { knight:{archer:2}, archer:{catapult:2}, catapult:{knight:2} };

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let scale = 1;
let gameLoopReq;

function fit() {
  const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(300, Math.round(r.width*dpr)); canvas.height = canvas.width; scale = canvas.width / W;
}
new ResizeObserver(fit).observe(canvas); fit();

const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const rand = (a,b) => a + Math.random()*(b-a);
const hash = n => { const x = Math.sin(n*127.1)*43758.5453; return x - Math.floor(x); };
function toWorld(p, lx, ly) {
  const s = p.seat, c = Math.cos(s.ang), n = Math.sin(s.ang);
  return { x: s.cx + lx*c - ly*n, y: s.cy + lx*n + ly*c };
}
function toLocal(p, x, y) {
  const s = p.seat, dx = x - s.cx, dy = y - s.cy, c = Math.cos(s.ang), n = Math.sin(s.ang);
  return { x: dx*c + dy*n, y: -dx*n + dy*c };
}
function rectDist(p, x, y) {
  const l = toLocal(p, x, y);
  return Math.hypot(Math.max(Math.abs(l.x)-HW,0), Math.max(Math.abs(l.y)-HD,0));
}
function rrect(x,y,w,h,r) {
  ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}
const BTN = i => ({ x:-156 + i*80, y:4, w:72, h:40 });
const fmtTime = t => { t = Math.floor(t); return Math.floor(t/60) + ':' + String(t%60).padStart(2,'0'); };

const tufts = Array.from({length:240}, (_,i) => ({ x:hash(i)*W, y:hash(i+500)*W, s:2+hash(i+900)*4 }));
const trees = [];
[[130,130],[770,130],[130,770],[770,770]].forEach(([cx,cy],k) => {
  for(let i=0;i<6;i++) trees.push({ x:cx+(hash(k*20+i)-.5)*110, y:cy+(hash(k*20+i+7)-.5)*110, r:12+hash(k*20+i+3)*10 });
});

let g = null, mode = 'menu';
let lastTime = 0;

function newGame(lobbyPlayers) {
  activePlayers = lobbyPlayers;
  myPlayerIndex = activePlayers.findIndex(p => p.id === myId);
  const numPlayers = activePlayers.length;
  
  // Assign positions based on player count
  const seatMap = { 1: [0], 2: [0, 2], 3: [0, 1, 3], 4: [0, 1, 2, 3] };
  const seatsToUse = seatMap[numPlayers] || [0];

  // Rotate which physical seat each player sits in so that THIS device's own
  // player always ends up at seatsToUse[0] (South / bottom of screen). The
  // board is fully rotationally symmetric (mine at dead-center, seats evenly
  // spaced around it), so this is purely a per-device viewing rotation - it
  // does not change the simulation outcome, only where "you" appear on your
  // own screen. Each device computes its own rotation independently.
  const rotate = myPlayerIndex >= 0 ? myPlayerIndex : 0;

  g = { time:0, players:[], units:[], proj:[], tracers:[], parts:[], banners:[], order:[], winner:-1,
        leader:-1, mineOwner:-1, nextId:1 };
        
  for(let i=0; i<numPlayers; i++) {
    const seatSlot = (i - rotate + numPlayers) % numPlayers;
    const seatIdx = seatsToUse[seatSlot];
    g.players.push({
      // Color is tied to the player's stable index (same order on every
      // device, from the shared lobby list) rather than the seat, so a
      // given player is always the same color for everyone, regardless of
      // where their castle is rotated to on each viewer's own screen.
      id: i, socketId: activePlayers[i].id, nickname: activePlayers[i].nickname,
      col: COLORS[i], seat: SEATS[seatIdx], isMe: activePlayers[i].id === myId,
      gold: 100, target: (i+1)%numPlayers, hp: CASTLE_HP, alive: true, flash: 0, fireCd: 0, 
      lastAttacker: -1, lastHitAt: -99, spawnCd: 0, income: BASE_INCOME, btn: [0,0,0,0], spawnCount: 0
    });
  }
}

function nextTarget(p) {
  for(let k=1; k<g.players.length; k++) { 
    const id = (p.target+k) % g.players.length; 
    if(id !== p.id && g.players[id].alive) return id; 
  }
  return p.target;
}

function spawnUnit(p, type) {
  const T = TYPES[type];
  if(!p.alive || p.spawnCd>0 || p.gold<T.cost) return false;
  p.gold -= T.cost; p.spawnCd = .22;
  // Seeded (not Math.random) so every client computes the exact same spawn
  // position/cooldown/offset for this unit, keeping the simulation in sync.
  const seed = (p.id*100000 + p.spawnCount) * 3;
  p.spawnCount++;
  const w = toWorld(p, (hash(seed)*2-1)*140, -HD-12);
  g.units.push({ id:g.nextId++, owner:p.id, type, x:w.x, y:w.y, hp:T.hp, maxHp:T.hp, cd:hash(seed+1)*.3,
                 r:T.r, face:0, off:(hash(seed+2)*2-1)*60, dead:false });
  return true;
}

function spark(x,y,c,n=3){ for(let i=0;i<n;i++) g.parts.push({ x,y, vx:rand(-50,50), vy:rand(-50,50), t:0, life:rand(.25,.5), c, s:rand(1.5,3) }); }
function puff(x,y,c,n=10){ for(let i=0;i<n;i++) g.parts.push({ x,y, vx:rand(-90,90), vy:rand(-90,90), t:0, life:rand(.4,.8), c, s:rand(2,4.5) }); }

function hitUnit(o, ownerId, attType, base) {
  if(o.dead) return;
  let d = base * (MULT[attType] && MULT[attType][o.type] || 1);
  if(o.owner === g.leader) d *= LEADER_BONUS;
  o.hp -= d; spark(o.x,o.y,'#ffe9b0',2);
  if(o.hp <= 0){ o.dead = true; puff(o.x,o.y,g.players[o.owner].col.c,8); }
}

function hitCastle(ci, ownerId, attType, base) {
  const p = g.players[ci]; if(!p.alive) return;
  let d = base * ((TYPES[attType] && TYPES[attType].castleMult) || 1);
  if(ci === g.leader) d *= LEADER_BONUS;
  p.hp -= d; p.flash = .12; p.lastAttacker = ownerId; p.lastHitAt = g.time;
  if(p.hp <= 0) eliminate(ci, ownerId);
}

function banner(text,color){ g.banners.push({ text, color, t:5 }); if(g.banners.length>3) g.banners.shift(); }

function eliminate(ci, killer) {
  const p = g.players[ci]; p.alive = false; p.hp = 0; g.order.push(ci);
  const k = g.players[killer];
  if(k && k.alive){ k.gold = Math.min(GOLD_CAP, k.gold + LOOT); }
  for(const u of g.units) if(u.owner===ci && !u.dead){ u.dead = true; puff(u.x,u.y,p.col.c,6); }
  for(let i=0;i<40;i++){ const w = toWorld(p, rand(-HW,HW), rand(-HD,HD)); puff(w.x,w.y,'#8b8577',1); }
  banner(`${p.nickname}'s keep has fallen to ${k.nickname}! (+${LOOT} gold)`, k.col.c);
  const alive = g.players.filter(q => q.alive);
  if(alive.length <= 1) g.winner = alive.length ? alive[0].id : -1;
}

function fireAtUnit(u, o){
  const T = TYPES[u.type]; u.cd = T.cd; u.face = Math.atan2(o.y-u.y, o.x-u.x);
  if(u.type==='knight'){ hitUnit(o,u.owner,'knight',T.dmg); }
  else if(u.type==='archer'){
    g.tracers.push({ x1:u.x,y1:u.y,x2:o.x,y2:o.y,t:0,life:.1,c:g.players[u.owner].col.c });
    hitUnit(o,u.owner,'archer',T.dmg);
  } else {
    const d = Math.hypot(o.x-u.x,o.y-u.y);
    g.proj.push({ sx:u.x,sy:u.y,tx:o.x,ty:o.y,t:0,dur:.5+d/380,owner:u.owner,dmg:T.dmg,castle:-1 });
  }
}

function fireAtCastle(u, ci){
  const T = TYPES[u.type], c = g.players[ci]; u.cd = T.cd;
  const l = toLocal(c,u.x,u.y);
  const near = toWorld(c, clamp(l.x,-HW,HW), clamp(l.y,-HD,HD));
  u.face = Math.atan2(near.y-u.y, near.x-u.x);
  if(u.type==='knight'){ spark(near.x,near.y,'#ffe9b0',2); hitCastle(ci,u.owner,'knight',T.dmg); }
  else if(u.type==='archer'){
    g.tracers.push({ x1:u.x,y1:u.y,x2:near.x,y2:near.y,t:0,life:.1,c:g.players[u.owner].col.c });
    hitCastle(ci,u.owner,'archer',T.dmg);
  } else {
    const d = Math.hypot(near.x-u.x,near.y-u.y);
    g.proj.push({ sx:u.x,sy:u.y,tx:near.x,ty:near.y,t:0,dur:.5+d/380,owner:u.owner,dmg:T.dmg,castle:ci });
  }
}

function moveToward(u,tx,ty,dt,T){
  const dx=tx-u.x, dy=ty-u.y, d=Math.hypot(dx,dy)||1, m=Math.min(T.speed*dt,d);
  u.face = Math.atan2(dy,dx); u.x += dx/d*m; u.y += dy/d*m;
}

function updateUnit(u, dt){
  const T = TYPES[u.type], me = g.players[u.owner];
  u.cd -= dt;
  let bu = null, bs = 1e9;
  for(const o of g.units){
    if(o.dead || o.owner===u.owner) continue;
    const d = Math.hypot(o.x-u.x, o.y-u.y);
    if(d > T.sight) continue;
    const gap = d - u.r - o.r;
    if(u.type==='catapult' && (gap > T.range || gap < T.minRange)) continue;
    const s = d - (MULT[u.type][o.type] ? 40 : 0);
    if(s < bs){ bs = s; bu = o; }
  }
  const tc = me.target, castle = g.players[tc];
  const inCastle = castle.alive && tc!==u.owner && rectDist(castle,u.x,u.y) <= T.range + u.r + .5;
  let moving = true;
  if(u.type==='catapult'){
    if(inCastle){ moving = false; if(u.cd<=0) fireAtCastle(u,tc); }
    else if(bu && u.cd<=0) fireAtUnit(u,bu);
  } else if(bu){
    const gap = Math.hypot(bu.x-u.x,bu.y-u.y) - u.r - bu.r;
    moving = false;
    if(gap <= T.range){ u.face = Math.atan2(bu.y-u.y,bu.x-u.x); if(u.cd<=0) fireAtUnit(u,bu); }
    else moveToward(u,bu.x,bu.y,dt,T);
  } else if(inCastle){
    moving = false; if(u.cd<=0) fireAtCastle(u,tc);
  }
  if(moving && castle.alive){
    const l = toLocal(castle,u.x,u.y);
    let nx = clamp(l.x,-HW,HW), ny = clamp(l.y,-HD,HD);
    if(l.y < -HD) nx = clamp(l.x + u.off, -150, 150);
    const w = toWorld(castle,nx,ny);
    moveToward(u,w.x,w.y,dt,T);
  }
}

function step(dt) {
  g.time += dt;
  for(const b of g.banners) b.t -= dt;
  g.banners = g.banners.filter(b => b.t > 0);

  const cnt = [0,0,0,0];
  for(const u of g.units) if(!u.dead && Math.hypot(u.x-450,u.y-450) <= MINE_R + u.r) cnt[u.owner]++;
  let mo=-1, mx=0, sec=0;
  for(let i=0;i<g.players.length;i++){ if(cnt[i]>mx){ sec=mx; mx=cnt[i]; mo=i; } else if(cnt[i]>sec) sec=cnt[i]; }
  g.mineOwner = (mx>0 && mx>sec) ? mo : -1;

  const alive = g.players.filter(p => p.alive);
  g.leader = -1;
  if(alive.length >= 3){
    const s = [...alive].sort((a,b) => b.hp - a.hp);
    if(s[0].hp >= s[1].hp*1.15) g.leader = s[0].id;
  }

  for(const p of g.players) {
    if(!p.alive) continue;
    p.income = BASE_INCOME + (g.mineOwner===p.id ? MINE_BONUS : 0);
    p.gold = Math.min(GOLD_CAP, p.gold + p.income*dt);
    p.spawnCd -= dt; p.flash = Math.max(0, p.flash-dt);
    for(let k=0;k<4;k++) p.btn[k] = Math.max(0, p.btn[k]-dt);
    if(p.target===p.id || !g.players[p.target].alive) p.target = nextTarget(p);
  }

  for(const u of g.units) if(!u.dead) updateUnit(u, dt);

  const us = g.units;
  for(let i=0;i<us.length;i++){
    const a = us[i]; if(a.dead) continue;
    for(let j=i+1;j<us.length;j++){
      const b = us[j]; if(b.dead) continue;
      const dx=b.x-a.x, dy=b.y-a.y, m=a.r+b.r;
      if(Math.abs(dx)>m || Math.abs(dy)>m) continue;
      const d2 = dx*dx+dy*dy;
      if(d2 < m*m && d2 > 0.0001){
        const d=Math.sqrt(d2), push=(m-d)/2, nx=dx/d, ny=dy/d;
        a.x-=nx*push; a.y-=ny*push; b.x+=nx*push; b.y+=ny*push;
      }
    }
  }
  for(const u of us){
    if(u.dead) continue;
    for(const p of g.players){
      if(!p.alive) continue;
      const l = toLocal(p,u.x,u.y);
      const px = HW + u.r - Math.abs(l.x), py = HD + u.r - Math.abs(l.y);
      if(px>0 && py>0){
        let nx=l.x, ny=l.y;
        if(px < py) nx = Math.sign(l.x||1)*(HW+u.r); else ny = Math.sign(l.y||-1)*(HD+u.r);
        const w = toWorld(p,nx,ny); u.x=w.x; u.y=w.y;
      }
    }
    u.x = clamp(u.x,u.r,W-u.r); u.y = clamp(u.y,u.r,W-u.r);
  }

  for(const p of g.players){
    if(!p.alive) continue;
    p.fireCd -= dt;
    if(p.fireCd > 0) continue;
    let best=null, bd=1e9;
    for(const u of g.units){
      if(u.dead || u.owner===p.id) continue;
      const d = rectDist(p,u.x,u.y) - u.r;
      if(d <= CASTLE_RANGE && d < bd){ bd=d; best=u; }
    }
    if(best){
      p.fireCd = CASTLE_CD;
      const l = toLocal(p,best.x,best.y), from = toWorld(p, clamp(l.x,-150,150), -HD);
      g.tracers.push({ x1:from.x,y1:from.y,x2:best.x,y2:best.y,t:0,life:.12,c:'#f4e7b8' });
      hitUnit(best,p.id,'castle',CASTLE_DMG);
    }
  }

  for(const pr of g.proj){
    pr.t += dt/pr.dur;
    if(pr.t >= 1){
      pr.done = true; puff(pr.tx,pr.ty,'#ffb04a',10);
      if(pr.castle >= 0) hitCastle(pr.castle,pr.owner,'catapult',pr.dmg);
      else for(const o of g.units) if(!o.dead && o.owner!==pr.owner && Math.hypot(o.x-pr.tx,o.y-pr.ty) <= TYPES.catapult.splash + o.r) hitUnit(o,pr.owner,'catapult',pr.dmg);
    }
  }
  g.proj = g.proj.filter(p => !p.done);
  for(const t of g.tracers) t.t += dt; g.tracers = g.tracers.filter(t => t.t < t.life);
  for(const q of g.parts){ q.t += dt; q.x += q.vx*dt; q.y += q.vy*dt; q.vx*=.94; q.vy*=.94; }
  g.parts = g.parts.filter(q => q.t < q.life).slice(-350);
  g.units = g.units.filter(u => !u.dead);
}

function drawBoard() {
  const gr = ctx.createRadialGradient(450,450,60,450,450,650);
  gr.addColorStop(0,'#4e7d3c'); gr.addColorStop(1,'#375c2b');
  ctx.fillStyle = gr; ctx.fillRect(0,0,W,W);
  ctx.fillStyle = 'rgba(190,165,105,.30)';
  ctx.fillRect(0,415,W,70); ctx.fillRect(415,0,70,W);
  ctx.strokeStyle = 'rgba(20,50,15,.5)'; ctx.lineWidth = 1.2;
  for(const t of tufts){ ctx.beginPath(); ctx.moveTo(t.x,t.y); ctx.lineTo(t.x-1,t.y-t.s); ctx.moveTo(t.x,t.y); ctx.lineTo(t.x+2,t.y-t.s*.8); ctx.stroke(); }
  for(const t of trees){
    ctx.fillStyle='rgba(0,0,0,.22)'; ctx.beginPath(); ctx.arc(t.x+4,t.y+5,t.r,0,7); ctx.fill();
    ctx.fillStyle='#2b5a27'; ctx.beginPath(); ctx.arc(t.x,t.y,t.r,0,7); ctx.fill();
    ctx.fillStyle='#3b7332'; ctx.beginPath(); ctx.arc(t.x-t.r*.25,t.y-t.r*.25,t.r*.6,0,7); ctx.fill();
  }
}

function drawMine() {
  const t = g.time, o = g.mineOwner;
  ctx.save(); ctx.translate(450,450);
  const gl = ctx.createRadialGradient(0,0,8,0,0,MINE_R+16);
  gl.addColorStop(0,'rgba(255,214,90,.55)'); gl.addColorStop(1,'rgba(255,214,90,0)');
  ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0,0,MINE_R+16+Math.sin(t*2)*3,0,7); ctx.fill();
  ctx.fillStyle = '#5b4a2c'; ctx.beginPath(); ctx.arc(0,0,MINE_R,0,7); ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = o>=0 ? g.players[o].col.c : 'rgba(255,220,120,.55)';
  ctx.setLineDash(o>=0 ? [] : [8,7]); ctx.stroke(); ctx.setLineDash([]);
  for(let i=0;i<9;i++){
    const a = hash(i)*6.28, d = 8+hash(i+9)*36;
    ctx.fillStyle = i%2 ? '#f5c542' : '#ffdf75'; ctx.beginPath(); ctx.arc(Math.cos(a)*d,Math.sin(a)*d,4+hash(i+3)*4,0,7); ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `800 20px ${SERIF}`; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('MINE',0,-2);
  ctx.font = `700 11px ${FONT}`; ctx.fillStyle = o>=0 ? g.players[o].col.c : 'rgba(255,255,255,.7)';
  ctx.fillText(o>=0 ? `${g.players[o].col.name} +${MINE_BONUS}/s` : 'most units wins', 0, 15);
  ctx.restore();
}

function drawTargetLines() {
  ctx.save(); ctx.setLineDash([6,9]); ctx.lineWidth = 2;
  for(const p of g.players){
    if(!p.alive) continue;
    const t = g.players[p.target]; if(!t.alive || t===p) continue;
    const a = toWorld(p,0,-HD-4), b = toWorld(t,0,-HD-4);
    ctx.strokeStyle = p.col.c; ctx.globalAlpha = .28;
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  }
  ctx.restore();
}

function drawKeep(p) {
  const s = p.seat;
  ctx.save(); ctx.translate(s.cx,s.cy); ctx.rotate(s.ang);
  if(!p.alive){
    ctx.fillStyle = '#4a4338'; ctx.fillRect(-HW,-HD,2*HW,2*HD);
    for(let i=0;i<40;i++){
      const a=hash(i+s.cx), b=hash(i*3+s.cy+1), c=hash(i*7+2);
      ctx.fillStyle = `hsl(35 8% ${28+c*22}%)`; ctx.fillRect(-165+a*320,-44+b*84,6+c*16,5+c*10);
    }
    ctx.fillStyle='rgba(255,255,255,.6)'; ctx.font=`800 17px ${SERIF}`; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(p.nickname+' has fallen',0,0);
    ctx.restore(); return;
  }
  ctx.fillStyle='rgba(0,0,0,.32)'; ctx.fillRect(-HW+5,-HD+7,2*HW,2*HD);
  const gr = ctx.createLinearGradient(0,-HD,0,HD); gr.addColorStop(0,'#9c9481'); gr.addColorStop(1,'#6b6455');
  ctx.fillStyle = gr; ctx.fillRect(-HW,-HD,2*HW,2*HD);
  ctx.strokeStyle='rgba(0,0,0,.13)'; ctx.lineWidth=1;
  for(let y=-HD+16;y<HD;y+=16){ ctx.beginPath(); ctx.moveTo(-HW,y); ctx.lineTo(HW,y); ctx.stroke(); }
  ctx.fillStyle = p.col.c; ctx.fillRect(-HW,-HD,2*HW,5);
  ctx.fillStyle = '#aaa28e'; for(let x=-HW;x<HW;x+=22) ctx.fillRect(x+2,-HD-10,14,10);
  ctx.fillStyle = '#7f7765'; ctx.fillRect(-HW-14,-HD-8,26,2*HD+16); ctx.fillRect(HW-12,-HD-8,26,2*HD+16);
  ctx.fillStyle = p.col.d; ctx.fillRect(-HW-14,-HD-8,26,7); ctx.fillRect(HW-12,-HD-8,26,7);
  if(p.flash>0){ ctx.fillStyle=`rgba(255,255,255,${Math.min(.5,p.flash*4)})`; ctx.fillRect(-HW,-HD,2*HW,2*HD); }

  const ratio = p.hp/CASTLE_HP;
  ctx.fillStyle='rgba(10,8,5,.75)'; rrect(-150,-37,300,13,4); ctx.fill();
  ctx.fillStyle = ratio<.25 ? '#ff5a3c' : p.col.c; rrect(-150,-37,Math.max(4,300*ratio),13,4); ctx.fill();
  ctx.fillStyle='#fff'; ctx.font=`700 10px ${FONT}`; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(Math.ceil(p.hp)+' / '+CASTLE_HP,0,-30);

  ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillStyle='#f5c542'; ctx.beginPath(); ctx.arc(-143,-11,6,0,7); ctx.fill();
  ctx.strokeStyle='#8a6d0c'; ctx.lineWidth=1.5; ctx.stroke();
  ctx.fillStyle='#fff'; ctx.font=`800 15px ${FONT}`; ctx.fillText(String(Math.floor(p.gold)),-131,-10);
  ctx.fillStyle='rgba(255,255,255,.75)'; ctx.font=`600 11px ${FONT}`;
  ctx.fillText('+'+p.income.toFixed(0)+'/s',-92,-9);
  ctx.textAlign='right'; ctx.fillStyle = '#fff'; ctx.font=`800 14px ${SERIF}`;
  ctx.fillText((g.leader===p.id ? '\u265B ' : '') + p.nickname + (p.isMe ? ' (You)' : ''),150,-10);

  for(let i=0;i<4;i++){
    const b = BTN(i), isT = i===3, type = UT[i];
    const afford = isT || p.gold >= TYPES[type].cost;
    const pressed = p.btn[i] > 0;
    ctx.globalAlpha = p.isMe ? 1 : .5;
    ctx.fillStyle = pressed ? p.col.c : 'rgba(18,14,9,.88)';
    rrect(b.x,b.y,b.w,b.h,6); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = afford ? p.col.c : '#5b5442'; ctx.stroke();
    const fg = pressed ? '#141008' : (afford ? '#ffffff' : '#8b856f');
    ctx.textBaseline='middle'; ctx.textAlign='center'; ctx.fillStyle = fg; ctx.font=`800 12px ${FONT}`;
    ctx.fillText(isT ? 'Target' : TYPES[type].label, b.x+b.w/2, b.y+13);
    ctx.font=`700 11px ${FONT}`; ctx.textAlign='left';
    if(isT){ ctx.fillStyle = pressed ? '#141008' : g.players[p.target].col.c; ctx.fillText(g.players[p.target].col.name, b.x+7, b.y+30); }
    else { ctx.fillStyle = fg; ctx.fillText(TYPES[type].cost+'g', b.x+7, b.y+30); }
    if(p.isMe){
      ctx.textAlign='right'; ctx.fillStyle = pressed ? '#141008' : 'rgba(255,255,255,.65)'; ctx.font=`700 10px ui-monospace,Menlo,monospace`;
      ctx.fillText(KEYS[0][i].toUpperCase(), b.x+b.w-6, b.y+30);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawUnit(u) {
  const T = TYPES[u.type], c = g.players[u.owner].col, r = u.r;
  ctx.save(); ctx.translate(u.x,u.y);
  ctx.fillStyle='rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(1.5,2.5,r,r*.7,0,0,7); ctx.fill();
  ctx.rotate(u.face);
  if(u.type==='knight'){
    ctx.strokeStyle='#e8e8e8'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(r*.4,0); ctx.lineTo(r+6,0); ctx.stroke();
    ctx.fillStyle=c.c; ctx.strokeStyle='#15110b'; ctx.lineWidth=1.6; ctx.beginPath(); ctx.arc(0,0,r,0,7); ctx.fill(); ctx.stroke();
    ctx.fillStyle=c.d; ctx.beginPath(); ctx.arc(0,0,r*.5,0,7); ctx.fill();
  } else if(u.type==='archer'){
    ctx.fillStyle=c.c; ctx.strokeStyle='#15110b'; ctx.lineWidth=1.6;
    ctx.beginPath(); ctx.moveTo(r+2,0); ctx.lineTo(-r,r*.9); ctx.lineTo(-r*.5,0); ctx.lineTo(-r,-r*.9); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else {
    ctx.fillStyle=c.d; ctx.strokeStyle=c.c; ctx.lineWidth=2; rrect(-r,-r*.75,r*2,r*1.5,3); ctx.fill(); ctx.stroke();
    ctx.strokeStyle='#e0d2a8'; ctx.lineWidth=2.4; ctx.beginPath(); ctx.moveTo(-r*.4,0); ctx.lineTo(r+3,0); ctx.stroke();
    ctx.fillStyle='#15110b'; ctx.beginPath(); ctx.arc(-r*.5,-r*.85,2.4,0,7); ctx.arc(-r*.5,r*.85,2.4,0,7); ctx.fill();
  }
  ctx.restore();
  if(u.hp < u.maxHp){
    ctx.fillStyle='rgba(0,0,0,.6)'; ctx.fillRect(u.x-9,u.y-r-7,18,3);
    ctx.fillStyle = u.hp/u.maxHp>.4 ? '#7be07b' : '#ff6a4a'; ctx.fillRect(u.x-9,u.y-r-7,18*u.hp/u.maxHp,3);
  }
}

function draw() {
  ctx.setTransform(scale,0,0,scale,0,0);
  drawBoard(); drawMine(); drawTargetLines();
  for(const p of g.players) drawKeep(p);
  for(const u of g.units) drawUnit(u);
  for(const t of g.tracers){
    ctx.strokeStyle=t.c; ctx.globalAlpha = 1 - t.t/t.life; ctx.lineWidth=1.6;
    ctx.beginPath(); ctx.moveTo(t.x1,t.y1); ctx.lineTo(t.x2,t.y2); ctx.stroke(); ctx.globalAlpha=1;
  }
  for(const pr of g.proj){
    const x = pr.sx+(pr.tx-pr.sx)*pr.t, y = pr.sy+(pr.ty-pr.sy)*pr.t, h = Math.sin(Math.PI*pr.t)*42;
    ctx.fillStyle='rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x,y,4,2.5,0,0,7); ctx.fill();
    ctx.fillStyle='#2a2620'; ctx.beginPath(); ctx.arc(x,y-h,4.5,0,7); ctx.fill();
  }
  for(const q of g.parts){
    ctx.globalAlpha = 1 - q.t/q.life; ctx.fillStyle = q.c; ctx.fillRect(q.x-q.s/2,q.y-q.s/2,q.s,q.s);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.font=`700 15px ${FONT}`;
  ctx.fillStyle='rgba(255,255,255,.8)'; ctx.fillText(fmtTime(g.time),14,20);
  ctx.textAlign='center'; ctx.font=`800 15px ${FONT}`;
  g.banners.forEach((b,i) => {
    ctx.globalAlpha = Math.min(1,b.t); ctx.fillStyle='rgba(0,0,0,.55)';
    const w = ctx.measureText(b.text).width + 24; rrect(450-w/2,116+i*28,w,22,6); ctx.fill();
    ctx.fillStyle=b.color; ctx.fillText(b.text,450,127+i*28);
  });
  ctx.globalAlpha = 1;
}

function processInput(pi, ai) {
  const p = g.players[pi]; if(!p || !p.alive) return;
  if(ai < 3){ if(spawnUnit(p, UT[ai])) p.btn[ai] = .15; }
  else { p.target = nextTarget(p); p.btn[3] = .15; }
}

function emitInput(ai) {
  if (myPlayerIndex < 0 || !g) return;
  processInput(myPlayerIndex, ai);
  // Embed which player (by stable index) performed this action directly in
  // the payload, so the receiver doesn't need to match socket ids at all -
  // that matching was the likely point of failure before.
  const payload = JSON.stringify({ fk_action: ai, pi: myPlayerIndex });
  for (const gp of g.players) {
    if (gp.id === myPlayerIndex) continue;
    console.log('[fourkeeps] sending action', ai, 'to player', gp.id, 'socket', gp.socketId);
    socket.emit('private_message', { targetId: gp.socketId, message: payload });
  }
}

let pendingRemoteActions = [];

function applyRemoteAction(data, msg) {
  let pi = Number.isInteger(data.pi) ? data.pi : -1;
  if (pi < 0 || !g.players[pi]) {
    // Fallback for older/alternate server relays that don't round-trip
    // our custom fields: identify the sender by matching socket id.
    pi = g.players.findIndex(p => p.socketId === msg.fromId);
  }
  if (pi >= 0 && pi !== myPlayerIndex) {
    console.log('[fourkeeps] applying remote action', data.fk_action, 'from player', pi);
    processInput(pi, data.fk_action);
  } else {
    console.warn('[fourkeeps] could not resolve sender for action', data, msg);
  }
}

socket.on('private_message', (msg) => {
  console.log('[fourkeeps] private_message received', msg);
  let data;
  try { data = JSON.parse(msg.message); } catch(e) { return; }
  if (data.fk_action === undefined) return;
  if (mode !== 'play' || !g) {
    // This device may not have finished setting up its own game yet (a
    // brief race right at match start if a peer's action arrives first) -
    // buffer it and replay once ready instead of silently dropping it.
    pendingRemoteActions.push({ data, msg });
    return;
  }
  applyRemoteAction(data, msg);
});

const keyMap = {};
KEYS[0].forEach((k,ai) => keyMap[k] = ai); // Map local keys to local player actions

addEventListener('keydown', e => {
  if (mode !== 'play') return;
  const ai = keyMap[e.key.toLowerCase()];
  if (ai !== undefined && !e.repeat) {
    e.preventDefault();
    emitInput(ai);
  }
});

canvas.addEventListener('pointerdown', e => {
  if(mode !== 'play' || myPlayerIndex < 0) return;
  const p = g.players[myPlayerIndex];
  if(!p.alive) return;
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * W / r.width, y = (e.clientY - r.top) * W / r.height;
  const l = toLocal(p,x,y);
  for(let i=0;i<4;i++){
    const b = BTN(i);
    if(l.x>=b.x && l.x<=b.x+b.w && l.y>=b.y && l.y<=b.y+b.h) { emitInput(i); return; }
  }
});

function frame(now) {
  if (mode === 'play') {
    const dt = Math.min(.05, (now - lastTime) / 1000) || 0.016;
    lastTime = now;
    let t = dt;
    while(t > 0 && g.winner < 0){ const s = Math.min(t, 1/30); step(s); t -= s; }
    if(g.winner >= 0) {
      mode = 'over';
      showGameOver();
    }
  }
  draw();
  gameLoopReq = requestAnimationFrame(frame);
}

socket.on('game_started', (state) => {
  showScreen('screen-game');
  pendingRemoteActions = []; // fresh match - discard anything stale from before
  newGame(state.players);
  mode = 'play';
  lastTime = performance.now();
  if(gameLoopReq) cancelAnimationFrame(gameLoopReq);
  gameLoopReq = requestAnimationFrame(frame);
  // Replay any peer actions that arrived before we finished initializing.
  if (pendingRemoteActions.length) {
    const queued = pendingRemoteActions;
    pendingRemoteActions = [];
    queued.forEach(({ data, msg }) => applyRemoteAction(data, msg));
  }
});

function showGameOver() {
  const modal = document.getElementById('modal-gameover');
  const w = g.players[g.winner];
  document.getElementById('gameover-title').textContent = w ? `🏆 ${w.nickname} wins!` : 'Game Over';
  
  const rank = [g.winner, ...[...g.order].reverse()];
  document.getElementById('gameover-scores').innerHTML = rank.map((id, i) => `
    <div class="gameover-row"><span>#${i + 1} ${escapeHtml(g.players[id].nickname)}${id === myPlayerIndex ? ' (you)' : ''}</span></div>
  `).join('');
  
  modal.classList.add('active');
}

document.getElementById('btn-back-home').onclick = () => {
  document.getElementById('modal-gameover').classList.remove('active');
  showScreen('screen-home');
  mode = 'menu';
  loadLeaderboard();
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}