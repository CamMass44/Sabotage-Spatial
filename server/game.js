'use strict';
/*
 * Logique de jeu côté serveur : salons, phases, missions, éliminations,
 * sabotages, réunions/votes, conditions de victoire, reconnexion.
 */
const SHARED = require('../shared/shared');
const bots = require('./bots');

const rooms = new Map();
const TICK_MS = 100;
const DISCONNECT_GRACE_MS = 60000; // délai de reconnexion en partie
const ROOM_EMPTY_TTL_MS = 120000;

const rnd = (n) => Math.floor(Math.random() * n);

function rid(len = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[rnd(chars.length)];
  return s;
}

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sans I ni O (lisibilité)
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += chars[rnd(chars.length)];
    if (!rooms.has(c)) return c;
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cleanText = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);

/* ------------------------------------------------------------------ */
/* Salon                                                               */
/* ------------------------------------------------------------------ */

function createRoom(io) {
  const room = {
    io,
    code: makeCode(),
    hostId: null,
    phase: 'lobby', // lobby | play | meeting | end
    players: new Map(),
    settings: { ...SHARED.DEFAULT_SETTINGS },
    bodies: [],
    markers: [],
    sab: null,              // { type, endsAt|null, remaining? }
    sabCooldownUntil: 0,
    meeting: null,          // { stage, endsAt, votes, reporter, bodyOf }
    noMeetingUntil: 0,
    taskTotal: 0,
    taskDone: 0,
    emptySince: Date.now(),
    interval: null
  };
  room.interval = setInterval(() => {
    try { tick(room); } catch (e) { console.error('tick', room.code, e); }
  }, TICK_MS);
  rooms.set(room.code, room);
  console.log(`[room ${room.code}] créé`);
  return room;
}

function destroyRoom(room) {
  clearInterval(room.interval);
  rooms.delete(room.code);
  console.log(`[room ${room.code}] détruit`);
}

function addPlayer(room, socket, name) {
  const used = new Set([...room.players.values()].map((p) => p.color));
  let color = 0;
  for (let i = 0; i < SHARED.COLORS.length; i++) {
    if (!used.has(i)) { color = i; break; }
  }
  const p = {
    id: rid(8),
    token: rid(24),
    socketId: socket.id,
    name: cleanText(name, 16) || 'Joueur',
    color,
    x: SHARED.SPAWN.x, y: SHARED.SPAWN.y, dir: 1, moving: false,
    alive: true,
    role: null,
    tasks: [],
    emergenciesLeft: 0,
    killAt: 0,
    connected: true,
    disconnectedAt: 0,
    lastChat: 0,
    lastMarker: 0
  };
  room.players.set(p.id, p);
  if (!room.hostId) room.hostId = p.id;
  return p;
}

function removePlayer(room, p) {
  room.players.delete(p.id);
  // Ajuste la progression des missions si un équipier quitte définitivement
  if (room.phase === 'play' || room.phase === 'meeting') {
    if (p.role === 'crew') {
      room.taskTotal -= p.tasks.length;
      room.taskDone -= p.tasks.filter((t) => t.done).length;
      emitRoom(room, 'task:progress', { pct: taskPct(room) });
    }
  }
  if (room.hostId === p.id) {
    const all = [...room.players.values()];
    const next = all.find((q) => q.connected && !q.isBot) || all.find((q) => !q.isBot);
    room.hostId = next ? next.id : null;
  }
  // Plus aucun humain : on ferme le salon (les bots ne le maintiennent pas en vie)
  const humansLeft = [...room.players.values()].some((q) => !q.isBot);
  if (!humansLeft) {
    destroyRoom(room);
    return;
  }
  broadcastState(room);
  if (room.phase === 'play') checkWin(room);
}

/* Bots de développement -------------------------------------------- */

const BOT_NAMES = [
  'Bot Alpha', 'Bot Bravo', 'Bot Charlie', 'Bot Delta', 'Bot Echo',
  'Bot Fox', 'Bot Golf', 'Bot Hotel', 'Bot India', 'Bot Julia', 'Bot Kilo'
];

function addBot(room) {
  if (room.players.size >= SHARED.MAX_PLAYERS) return;
  const used = new Set([...room.players.values()].map((p) => p.color));
  let color = 0;
  for (let i = 0; i < SHARED.COLORS.length; i++) {
    if (!used.has(i)) { color = i; break; }
  }
  const taken = new Set([...room.players.values()].map((p) => p.name));
  const name = BOT_NAMES.find((n) => !taken.has(n)) || 'Bot';
  const p = {
    id: rid(8), token: rid(24), socketId: null,
    name, color,
    x: SHARED.SPAWN.x, y: SHARED.SPAWN.y, dir: 1, moving: false,
    alive: true, role: null, tasks: [], emergenciesLeft: 0, killAt: 0,
    connected: true, disconnectedAt: 0, lastChat: 0, lastMarker: 0,
    isBot: true, bot: {}
  };
  room.players.set(p.id, p);
  broadcastState(room);
}

/* ------------------------------------------------------------------ */
/* Diffusion                                                           */
/* ------------------------------------------------------------------ */

function emitRoom(room, ev, data) {
  room.io.to(room.code).emit(ev, data);
}

function sendTo(room, p, ev, data) {
  const s = room.io.sockets.sockets.get(p.socketId);
  if (s) s.emit(ev, data);
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, color: p.color, connected: p.connected, alive: p.alive, isBot: !!p.isBot };
}

function broadcastState(room) {
  emitRoom(room, 'room:state', {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    settings: room.settings,
    players: [...room.players.values()].map(publicPlayer)
  });
}

function taskPct(room) {
  return room.taskTotal > 0 ? Math.min(1, room.taskDone / room.taskTotal) : 0;
}

function sabPayload(room) {
  return room.sab ? { type: room.sab.type, endsAt: room.sab.endsAt || null } : null;
}

/* ------------------------------------------------------------------ */
/* Partie                                                              */
/* ------------------------------------------------------------------ */

function placeAtSpawn(room) {
  const ps = [...room.players.values()];
  const n = ps.length;
  ps.forEach((p, i) => {
    const a = (i / n) * Math.PI * 2;
    p.x = SHARED.SPAWN.x + Math.cos(a) * 130;
    p.y = SHARED.SPAWN.y + Math.sin(a) * 90;
    p.moving = false;
  });
}

function startGame(room) {
  const ps = shuffle([...room.players.values()]);
  const maxImp = Math.max(1, Math.floor((ps.length - 1) / 2));
  const nImp = Math.min(room.settings.impostors, 3, maxImp);
  ps.forEach((p, i) => { p.role = i < nImp ? 'impostor' : 'crew'; });

  const now = Date.now();
  room.taskTotal = 0;
  room.taskDone = 0;
  for (const p of ps) {
    p.alive = true;
    p.tasks = shuffle(SHARED.TASKS.slice())
      .slice(0, room.settings.tasksPerPlayer)
      .map((t) => ({ id: t.id, done: false }));
    if (p.role === 'crew') room.taskTotal += p.tasks.length;
    p.emergenciesLeft = room.settings.emergencies;
    p.killAt = now + 10000;
    if (p.isBot) p.bot = {};
  }
  placeAtSpawn(room);
  room.phase = 'play';
  room.sab = null;
  room.bodies = [];
  room.markers = [];
  room.sabCooldownUntil = now + 20000;
  room.noMeetingUntil = now + 15000;

  const partners = ps.filter((p) => p.role === 'impostor').map((p) => ({ id: p.id, name: p.name }));
  for (const p of ps) {
    sendTo(room, p, 'game:start', {
      role: p.role,
      partners: p.role === 'impostor' ? partners : [],
      tasks: p.tasks,
      settings: room.settings,
      x: p.x, y: p.y,
      killAt: p.killAt,
      emergenciesLeft: p.emergenciesLeft
    });
  }
  broadcastState(room);
  console.log(`[room ${room.code}] partie lancée (${ps.length} joueurs, ${nImp} saboteur(s))`);
}

function buildResync(room, p) {
  return {
    phase: room.phase,
    settings: room.settings,
    role: p.role,
    partners: p.role === 'impostor'
      ? [...room.players.values()].filter((q) => q.role === 'impostor').map((q) => ({ id: q.id, name: q.name }))
      : [],
    tasks: p.tasks,
    taskPct: taskPct(room),
    x: p.x, y: p.y,
    alive: p.alive,
    killAt: p.killAt,
    emergenciesLeft: p.emergenciesLeft,
    sab: sabPayload(room),
    bodies: room.bodies,
    markers: room.markers,
    meeting: room.meeting ? {
      stage: room.meeting.stage,
      endsAt: room.meeting.endsAt,
      reporter: room.meeting.reporter,
      bodyOf: room.meeting.bodyOf,
      voted: Object.keys(room.meeting.votes),
      deadIds: [...room.players.values()].filter((q) => !q.alive).map((q) => q.id)
    } : null
  };
}

function endGame(room, winner, reason) {
  room.phase = 'end';
  room.meeting = null;
  room.sab = null;
  emitRoom(room, 'game:over', {
    winner,
    reason,
    roles: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, role: p.role }))
  });
  broadcastState(room);
  console.log(`[room ${room.code}] fin de partie : ${winner} (${reason})`);
}

function checkWin(room) {
  if (room.phase !== 'play' && room.phase !== 'meeting') return false;
  const ps = [...room.players.values()];
  const imps = ps.filter((p) => p.alive && p.role === 'impostor');
  const crew = ps.filter((p) => p.alive && p.role === 'crew');
  if (imps.length === 0) {
    endGame(room, 'crew', 'Tous les saboteurs ont été démasqués');
    return true;
  }
  if (imps.length >= crew.length) {
    endGame(room, 'impostors', 'Les saboteurs sont en majorité');
    return true;
  }
  if (room.taskTotal > 0 && room.taskDone >= room.taskTotal) {
    endGame(room, 'crew', 'Toutes les missions ont été accomplies');
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Actions de jeu (partagées entre joueurs et bots)                    */
/* ------------------------------------------------------------------ */

function completeTask(room, player, taskId) {
  if (room.phase !== 'play') return false;
  const task = player.tasks.find((t) => t.id === taskId && !t.done);
  if (!task) return false;
  const def = SHARED.TASKS.find((t) => t.id === task.id);
  if (!def || dist(player, def) > 140) return false;
  task.done = true;
  if (player.role === 'crew') {
    room.taskDone++;
    emitRoom(room, 'task:progress', { pct: taskPct(room) });
    checkWin(room);
  }
  return true;
}

function doKill(room, killer, target) {
  if (room.phase !== 'play' || killer.role !== 'impostor' || !killer.alive) return false;
  const now = Date.now();
  if (now < killer.killAt) return false;
  if (!target || !target.alive || target.role !== 'crew') return false;
  if (dist(killer, target) > 120) return false;
  target.alive = false;
  const body = { id: rid(6), playerId: target.id, color: target.color, x: target.x, y: target.y };
  room.bodies.push(body);
  killer.killAt = now + room.settings.killCooldown * 1000;
  sendTo(room, target, 'died', { by: killer.id });
  sendTo(room, killer, 'kill:ok', { killAt: killer.killAt });
  emitRoom(room, 'body', body);
  checkWin(room);
  return true;
}

function tryReport(room, player) {
  if (room.phase !== 'play' || !player.alive) return false;
  const body = room.bodies.find((b) => dist(player, b) <= 150);
  if (!body) return false;
  startMeeting(room, player, body.playerId);
  return true;
}

function castVote(room, player, target) {
  if (room.phase !== 'meeting') return;
  const m = room.meeting;
  if (!m || m.stage !== 'voting' || !player.alive || m.votes[player.id]) return;
  if (target !== 'skip') {
    const tp = room.players.get(target);
    if (!tp || !tp.alive) return;
  }
  m.votes[player.id] = target;
  emitRoom(room, 'meeting:votes', { voted: Object.keys(m.votes) });
  const aliveConnected = [...room.players.values()].filter((p) => p.alive && p.connected);
  if (aliveConnected.every((p) => m.votes[p.id])) m.endsAt = 0; // dépouillement au prochain tick
}

function startSab(room, player, type) {
  if (room.phase !== 'play' || player.role !== 'impostor' || !player.alive || room.sab) return;
  const now = Date.now();
  if (now < room.sabCooldownUntil) return;
  const def = SHARED.SABOTAGES[type];
  if (!def) return;
  const dur = type === 'reactor' ? room.settings.reactorTime
    : type === 'o2' ? room.settings.o2Time : null;
  room.sab = { type, endsAt: dur ? now + dur * 1000 : null };
  emitRoom(room, 'sab', sabPayload(room));
}

function fixSab(room, player, type) {
  if (room.phase !== 'play' || !player.alive) return;
  if (!room.sab || room.sab.type !== type) return;
  const def = SHARED.SABOTAGES[room.sab.type];
  if (dist(player, SHARED.POINTS[def.fix]) > 140) return;
  room.sab = null;
  room.sabCooldownUntil = Date.now() + room.settings.sabCooldown * 1000;
  emitRoom(room, 'sab:off', { type });
}

function botChat(room, p, text) {
  emitRoom(room, 'chat', {
    channel: 'global', from: p.id, name: p.name, color: p.color, text, t: Date.now()
  });
}

// API exposée à l'IA des bots
const botApi = { completeTask, doKill, tryReport, castVote, startSab, fixSab, botChat };

/* ------------------------------------------------------------------ */
/* Réunions                                                            */
/* ------------------------------------------------------------------ */

function startMeeting(room, reporter, bodyOf) {
  const now = Date.now();
  room.phase = 'meeting';
  room.bodies = [];
  room.markers = [];
  // Met en pause le compte à rebours d'un sabotage critique
  if (room.sab && room.sab.endsAt) {
    room.sab.remaining = room.sab.endsAt - now;
    room.sab.endsAt = null;
  }
  placeAtSpawn(room);
  room.meetingSeq = (room.meetingSeq || 0) + 1;
  room.meeting = {
    stage: 'discussion',
    endsAt: now + room.settings.discussTime * 1000,
    votes: {},
    reporter: reporter.id,
    bodyOf: bodyOf || null
  };
  emitRoom(room, 'meeting:start', {
    reporter: { id: reporter.id, name: reporter.name },
    bodyOf: bodyOf || null,
    deadIds: [...room.players.values()].filter((p) => !p.alive).map((p) => p.id),
    stage: 'discussion',
    endsAt: room.meeting.endsAt
  });
  broadcastState(room);
}

function tallyVotes(room) {
  const m = room.meeting;
  const counts = {};
  let skip = 0;
  for (const v of Object.values(m.votes)) {
    if (v === 'skip') skip++;
    else counts[v] = (counts[v] || 0) + 1;
  }
  let best = null, bestN = 0, tie = false;
  for (const [id, n] of Object.entries(counts)) {
    if (n > bestN) { best = id; bestN = n; tie = false; }
    else if (n === bestN) tie = true;
  }
  let ejected = null;
  if (best && !tie && bestN > skip) ejected = best;

  let wasImpostor = null;
  if (ejected) {
    const p = room.players.get(ejected);
    if (p) {
      p.alive = false;
      if (room.settings.confirmEjects) wasImpostor = p.role === 'impostor';
    }
  }
  m.stage = 'reveal';
  m.endsAt = Date.now() + 6500;
  emitRoom(room, 'meeting:result', {
    ejected,
    wasImpostor,
    counts,
    skip,
    voters: Object.keys(m.votes).length
  });
}

function endMeeting(room) {
  const now = Date.now();
  room.meeting = null;
  if (checkWin(room)) return;
  room.phase = 'play';
  if (room.sab && room.sab.remaining != null) {
    room.sab.endsAt = now + room.sab.remaining;
    delete room.sab.remaining;
    emitRoom(room, 'sab', sabPayload(room));
  }
  for (const p of room.players.values()) {
    if (p.role === 'impostor') p.killAt = now + room.settings.killCooldown * 1000;
  }
  room.noMeetingUntil = now + 15000;
  placeAtSpawn(room);
  emitRoom(room, 'meeting:end', { sab: sabPayload(room) });
  broadcastState(room);
}

/* ------------------------------------------------------------------ */
/* Boucle serveur                                                      */
/* ------------------------------------------------------------------ */

function tick(room) {
  const now = Date.now();

  // Purge les joueurs déconnectés trop longtemps
  for (const p of [...room.players.values()]) {
    if (!p.connected) {
      const grace = room.phase === 'lobby' ? 0 : DISCONNECT_GRACE_MS;
      if (now - p.disconnectedAt > grace) removePlayer(room, p);
    }
  }
  if (!rooms.has(room.code)) return; // détruit pendant la purge

  // Salon abandonné (les bots ne comptent pas)
  const anyHuman = [...room.players.values()].some((p) => p.connected && !p.isBot);
  if (anyHuman) room.emptySince = now;
  else if (now - room.emptySince > ROOM_EMPTY_TTL_MS) { destroyRoom(room); return; }

  // IA des bots de développement
  bots.tickBots(room, botApi, TICK_MS);
  if (!rooms.has(room.code)) return; // partie terminée et salon détruit pendant l'IA

  if (room.phase === 'play') {
    // Sabotage critique non réparé => victoire des saboteurs
    if (room.sab && room.sab.endsAt && now >= room.sab.endsAt) {
      const name = SHARED.SABOTAGES[room.sab.type].name;
      endGame(room, 'impostors', `Sabotage non réparé à temps (${name})`);
      return;
    }
  }

  if (room.phase === 'meeting' && room.meeting && now >= room.meeting.endsAt) {
    const m = room.meeting;
    if (m.stage === 'discussion') {
      m.stage = 'voting';
      m.endsAt = now + room.settings.voteTime * 1000;
      emitRoom(room, 'meeting:stage', { stage: 'voting', endsAt: m.endsAt });
    } else if (m.stage === 'voting') {
      tallyVotes(room);
    } else if (m.stage === 'reveal') {
      endMeeting(room);
    }
  }

  // Instantané des positions
  if (room.phase === 'play' || room.phase === 'meeting') {
    emitRoom(room, 'snap', {
      t: now,
      p: [...room.players.values()].map((p) => ({
        i: p.id,
        x: Math.round(p.x),
        y: Math.round(p.y),
        d: p.dir,
        m: p.moving ? 1 : 0,
        a: p.alive ? 1 : 0
      }))
    });
  }
}

/* ------------------------------------------------------------------ */
/* Gestion des sockets                                                 */
/* ------------------------------------------------------------------ */

function getCtx(socket) {
  const d = socket.data || {};
  const room = d.code ? rooms.get(d.code) : null;
  const player = room ? room.players.get(d.pid) : null;
  return { room, player };
}

function sanitizeSettings(input) {
  const out = {};
  for (const [key, range] of Object.entries(SHARED.LIMITS)) {
    if (input[key] != null) {
      const v = Math.round(Number(input[key]));
      if (Number.isFinite(v)) out[key] = Math.max(range[0], Math.min(range[1], v));
    }
  }
  if (typeof input.confirmEjects === 'boolean') out.confirmEjects = input.confirmEjects;
  return out;
}

function attach(io, socket) {
  const safe = (fn) => (data, cb) => {
    try { fn(data || {}, typeof cb === 'function' ? cb : () => {}); }
    catch (e) { console.error('socket handler', e); }
  };

  socket.on('room:create', safe((data, cb) => {
    if (socket.data && socket.data.pid) return cb({ ok: false, error: 'Déjà dans un salon.' });
    const room = createRoom(io);
    const p = addPlayer(room, socket, data.name);
    socket.join(room.code);
    socket.data = { code: room.code, pid: p.id };
    cb({ ok: true, code: room.code, you: p.id, token: p.token });
    broadcastState(room);
  }));

  socket.on('room:join', safe((data, cb) => {
    if (socket.data && socket.data.pid) return cb({ ok: false, error: 'Déjà dans un salon.' });
    const room = rooms.get(String(data.code || '').toUpperCase().trim());
    if (!room) return cb({ ok: false, error: "Ce salon n'existe pas." });
    if (room.phase !== 'lobby') return cb({ ok: false, error: 'La partie est déjà en cours.' });
    if (room.players.size >= SHARED.MAX_PLAYERS) return cb({ ok: false, error: 'Le salon est complet (12 joueurs max).' });
    const p = addPlayer(room, socket, data.name);
    socket.join(room.code);
    socket.data = { code: room.code, pid: p.id };
    cb({ ok: true, code: room.code, you: p.id, token: p.token });
    broadcastState(room);
  }));

  socket.on('room:rejoin', safe((data, cb) => {
    const room = rooms.get(String(data.code || '').toUpperCase().trim());
    if (!room) return cb({ ok: false });
    const p = [...room.players.values()].find((q) => q.token === data.token);
    if (!p) return cb({ ok: false });
    p.socketId = socket.id;
    p.connected = true;
    socket.join(room.code);
    socket.data = { code: room.code, pid: p.id };
    cb({ ok: true, code: room.code, you: p.id, token: p.token });
    broadcastState(room);
    if (room.phase === 'play' || room.phase === 'meeting') {
      sendTo(room, p, 'game:resync', buildResync(room, p));
    }
  }));

  socket.on('room:leave', safe(() => {
    const { room, player } = getCtx(socket);
    if (!room || !player) return;
    socket.leave(room.code);
    socket.data = {};
    removePlayer(room, player);
  }));

  socket.on('disconnect', () => {
    const { room, player } = getCtx(socket);
    if (!room || !player) return;
    player.connected = false;
    player.disconnectedAt = Date.now();
    player.moving = false;
    broadcastState(room);
  });

  socket.on('room:settings', safe((data) => {
    const { room, player } = getCtx(socket);
    if (!room || !player || room.hostId !== player.id || room.phase !== 'lobby') return;
    Object.assign(room.settings, sanitizeSettings(data.settings || {}));
    broadcastState(room);
  }));

  socket.on('room:color', safe((data) => {
    const { room, player } = getCtx(socket);
    if (!room || !player || room.phase !== 'lobby') return;
    const c = Math.round(Number(data.color));
    if (!(c >= 0 && c < SHARED.COLORS.length)) return;
    const taken = [...room.players.values()].some((p) => p.id !== player.id && p.color === c);
    if (taken) return;
    player.color = c;
    broadcastState(room);
  }));

  socket.on('game:start', safe((data, cb) => {
    const { room, player } = getCtx(socket);
    if (!room || !player || room.hostId !== player.id || room.phase !== 'lobby') return;
    const n = room.players.size;
    if (n < SHARED.MIN_PLAYERS) return cb({ ok: false, error: `Il faut au moins ${SHARED.MIN_PLAYERS} joueurs.` });
    if (n > SHARED.MAX_PLAYERS) return cb({ ok: false, error: '12 joueurs maximum.' });
    startGame(room);
    cb({ ok: true });
  }));

  socket.on('game:again', safe(() => {
    const { room, player } = getCtx(socket);
    if (!room || !player || room.hostId !== player.id || room.phase !== 'end') return;
    for (const p of [...room.players.values()]) {
      if (!p.connected) { room.players.delete(p.id); continue; }
      p.alive = true;
      p.role = null;
      p.tasks = [];
      p.x = SHARED.SPAWN.x; p.y = SHARED.SPAWN.y;
    }
    if (room.players.size === 0) { destroyRoom(room); return; }
    if (!room.players.has(room.hostId)) room.hostId = [...room.players.keys()][0];
    room.phase = 'lobby';
    room.bodies = [];
    room.markers = [];
    room.meeting = null;
    room.sab = null;
    broadcastState(room);
  }));

  socket.on('p:move', safe((data) => {
    const { room, player } = getCtx(socket);
    if (!room || !player || room.phase !== 'play') return;
    const x = Number(data.x), y = Number(data.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    player.x = Math.max(0, Math.min(SHARED.WORLD.w, x));
    player.y = Math.max(0, Math.min(SHARED.WORLD.h, y));
    player.dir = data.dir === -1 ? -1 : 1;
    player.moving = !!data.moving;
  }));

  socket.on('task:done', safe((data, cb) => {
    const { room, player } = getCtx(socket);
    if (!room || !player) return cb({ ok: false });
    cb({ ok: completeTask(room, player, data.taskId) });
  }));

  socket.on('kill', safe((data) => {
    const { room, player } = getCtx(socket);
    if (!room || !player) return;
    doKill(room, player, room.players.get(data.targetId));
  }));

  socket.on('report', safe(() => {
    const { room, player } = getCtx(socket);
    if (!room || !player) return;
    tryReport(room, player);
  }));

  socket.on('emergency', safe((data, cb) => {
    const { room, player } = getCtx(socket);
    if (!room || !player || room.phase !== 'play' || !player.alive) return;
    if (dist(player, SHARED.POINTS.emergency) > 110) return;
    if (player.emergenciesLeft <= 0) return cb({ ok: false, error: 'Plus de réunion d’urgence disponible.' });
    if (Date.now() < room.noMeetingUntil) return cb({ ok: false, error: 'Le bouton est encore en recharge.' });
    if (room.sab && SHARED.SABOTAGES[room.sab.type].critical) {
      return cb({ ok: false, error: 'Impossible pendant un sabotage critique !' });
    }
    player.emergenciesLeft--;
    cb({ ok: true, left: player.emergenciesLeft });
    startMeeting(room, player, null);
  }));

  socket.on('meeting:vote', safe((data) => {
    const { room, player } = getCtx(socket);
    if (!room || !player) return;
    castVote(room, player, data.target);
  }));

  socket.on('chat', safe((data) => {
    const { room, player } = getCtx(socket);
    if (!room || !player) return;
    const text = cleanText(data.text, 200);
    if (!text) return;
    const now = Date.now();
    if (now - player.lastChat < 400) return;
    player.lastChat = now;
    const channel = data.channel === 'imp' ? 'imp' : 'global';
    const inGame = room.phase === 'play' || room.phase === 'meeting';
    if (inGame && !player.alive) return; // les éliminés ne peuvent plus écrire
    if (channel === 'imp' && player.role !== 'impostor') return;
    const msg = { channel, from: player.id, name: player.name, color: player.color, text, t: now };
    if (channel === 'imp') {
      for (const p of room.players.values()) {
        if (p.role === 'impostor') sendTo(room, p, 'chat', msg);
      }
    } else {
      emitRoom(room, 'chat', msg);
    }
  }));

  socket.on('sab:start', safe((data) => {
    const { room, player } = getCtx(socket);
    if (!room || !player) return;
    startSab(room, player, data.type);
  }));

  socket.on('sab:fix', safe((data) => {
    const { room, player } = getCtx(socket);
    if (!room || !player) return;
    fixSab(room, player, data.type);
  }));

  // Bots de développement (hôte, dans le salon uniquement)
  socket.on('room:addBot', safe(() => {
    const { room, player } = getCtx(socket);
    if (!room || !player || room.hostId !== player.id || room.phase !== 'lobby') return;
    addBot(room);
  }));

  socket.on('room:removeBot', safe(() => {
    const { room, player } = getCtx(socket);
    if (!room || !player || room.hostId !== player.id || room.phase !== 'lobby') return;
    const all = [...room.players.values()].filter((p) => p.isBot);
    if (all.length) removePlayer(room, all[all.length - 1]);
  }));

  socket.on('marker', safe((data) => {
    const { room, player } = getCtx(socket);
    if (!room || !player || room.phase !== 'play' || !player.alive) return;
    const now = Date.now();
    if (now - player.lastMarker < 2000) return;
    player.lastMarker = now;
    const x = Math.max(0, Math.min(SHARED.WORLD.w, Number(data.x)));
    const y = Math.max(0, Math.min(SHARED.WORLD.h, Number(data.y)));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const m = { id: rid(6), x, y, by: player.id, name: player.name, color: player.color, t: now };
    room.markers.push(m);
    if (room.markers.length > 20) room.markers.shift();
    emitRoom(room, 'marker', m);
  }));

  // Relais de signalisation WebRTC pour le chat vocal
  socket.on('rtc', safe((data) => {
    const { room, player } = getCtx(socket);
    if (!room || !player) return;
    const to = room.players.get(data.to);
    if (!to) return;
    sendTo(room, to, 'rtc', { from: player.id, data: data.data });
  }));
}

module.exports = { attach };
