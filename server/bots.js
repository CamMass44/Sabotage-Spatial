'use strict';
/*
 * Bots de test pour le développement : navigation sur la carte, missions,
 * réparations, signalements, votes — et meurtres/sabotages pour les saboteurs.
 * Appelé à chaque tick serveur via tickBots(room, api, dtMs).
 * `api` est fourni par game.js (completeTask, doKill, castVote, …).
 */
const SHARED = require('../shared/shared');

const SPEED = 190;

const CHAT_LINES = [
  'Je faisais mes missions…',
  "C'est louche tout ça 🤔",
  'Quelqu’un a vu quelque chose ?',
  "J'étais aux moteurs, je le jure !",
  'Je dis ça, je dis rien…',
  'Pas de preuve, votez passer',
  "C'était pas moi !",
  'Suivez-moi à la prochaine mission'
];

/* ---- Graphe de navigation : rectangles praticables reliés par leurs chevauchements ---- */
const RECTS = SHARED.WALKABLE;
const graph = RECTS.map(() => []);
for (let i = 0; i < RECTS.length; i++) {
  for (let j = i + 1; j < RECTS.length; j++) {
    const a = RECTS[i], b = RECTS[j];
    const x1 = Math.max(a.x, b.x), x2 = Math.min(a.x + a.w, b.x + b.w);
    const y1 = Math.max(a.y, b.y), y2 = Math.min(a.y + a.h, b.y + b.h);
    if (x2 > x1 && y2 > y1) {
      const gate = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
      graph[i].push({ to: j, gate });
      graph[j].push({ to: i, gate });
    }
  }
}

function rectAt(x, y) {
  for (let i = 0; i < RECTS.length; i++) {
    const r = RECTS[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

// BFS -> liste des points de passage (les segments restent dans les rectangles : pas de murs traversés)
function findPath(from, to) {
  if (from < 0 || to < 0) return null;
  if (from === to) return [];
  const prev = new Map([[from, null]]);
  const q = [from];
  while (q.length) {
    const cur = q.shift();
    for (const e of graph[cur]) {
      if (prev.has(e.to)) continue;
      prev.set(e.to, { from: cur, gate: e.gate });
      if (e.to === to) {
        const gates = [];
        let n = to;
        while (n !== from) { const p = prev.get(n); gates.unshift({ x: p.gate.x, y: p.gate.y }); n = p.from; }
        return gates;
      }
      q.push(e.to);
    }
  }
  return null;
}

/* ---- Comportements ---- */

function impostorAI(room, p, api, now) {
  if (p.role !== 'impostor' || !p.alive) return;
  // sabotage occasionnel
  if (!room.sab && now >= room.sabCooldownUntil && Math.random() < 0.005) {
    const types = Object.keys(SHARED.SABOTAGES);
    api.startSab(room, p, types[Math.floor(Math.random() * types.length)]);
  }
  // élimination opportuniste
  if (now >= p.killAt && Math.random() < 0.08) {
    for (const q of room.players.values()) {
      if (q.id === p.id || !q.alive || q.role !== 'crew') continue;
      if (Math.hypot(q.x - p.x, q.y - p.y) < 90) { api.doKill(room, p, q); break; }
    }
  }
}

function meetingAI(room, p, b, api, now) {
  p.moving = false;
  const m = room.meeting;
  if (!m) return;
  if (b.meetingSeq !== room.meetingSeq) {
    b.meetingSeq = room.meetingSeq;
    b.voteAt = 0;
    b.chatted = false;
    b.chatAt = Math.random() < 0.7 ? now + 2000 + Math.random() * 10000 : 0;
  }
  if (m.stage === 'discussion' && b.chatAt && !b.chatted && now >= b.chatAt && p.alive) {
    b.chatted = true;
    api.botChat(room, p, CHAT_LINES[Math.floor(Math.random() * CHAT_LINES.length)]);
  }
  if (m.stage === 'voting' && p.alive && !m.votes[p.id]) {
    if (!b.voteAt) b.voteAt = now + 2000 + Math.random() * 9000;
    if (now >= b.voteAt) {
      let target = 'skip';
      if (Math.random() < 0.35) {
        const alive = [...room.players.values()].filter((q) => q.alive && q.id !== p.id);
        if (alive.length) target = alive[Math.floor(Math.random() * alive.length)].id;
      }
      api.castVote(room, p, target);
    }
  }
}

function chooseGoal(room, p, b, now) {
  // réparer un sabotage (équipiers vivants ; critique = prioritaire)
  if (p.alive && p.role === 'crew' && room.sab) {
    const critical = SHARED.SABOTAGES[room.sab.type].critical;
    if (critical || !b.goal || b.goal.kind === 'wander' || b.goal.kind === 'idle') {
      if (!b.goal || b.goal.kind !== 'fix') {
        const pt = SHARED.POINTS[SHARED.SABOTAGES[room.sab.type].fix];
        b.goal = { kind: 'fix', type: room.sab.type, x: pt.x, y: pt.y };
        b.path = null;
      }
      return;
    }
  }
  if (b.goal && b.goal.kind === 'fix' && (!room.sab || room.sab.type !== b.goal.type)) {
    b.goal = null; b.path = null;
  }
  if (b.goal && b.goal.kind !== 'idle') return;

  // mission suivante (les équipiers fantômes continuent ; les saboteurs font semblant)
  const t = p.tasks.find((x) => !x.done);
  if (t && (p.role === 'crew' || p.alive)) {
    const def = SHARED.TASKS.find((d) => d.id === t.id);
    if (def) {
      b.goal = { kind: 'task', id: t.id, x: def.x, y: def.y };
      b.path = null;
      return;
    }
  }
  // errance entre les pièces
  const r = SHARED.ROOMS[Math.floor(Math.random() * SHARED.ROOMS.length)];
  b.goal = { kind: 'wander', x: r.x + r.w / 2, y: r.y + r.h / 2 };
  b.path = null;
}

function arrive(room, p, b, now) {
  p.moving = false;
  const g = b.goal;
  if (!g) return;
  if (g.kind === 'task') {
    b.busyUntil = now + 2500 + Math.random() * 2500; // « fait » la mission
  } else if (g.kind === 'fix') {
    if (room.sab && room.sab.type === g.type) b.busyUntil = now + 2500;
    else { b.goal = null; b.path = null; }
  } else {
    b.goal = { kind: 'idle' };
    b.busyUntil = now + 1500 + Math.random() * 3500; // petite pause
  }
}

function moveAlong(room, p, b, api, dt, now) {
  const g = b.goal;
  if (!g) { p.moving = false; return; }
  if (!b.path) {
    if (!p.alive) {
      b.path = [{ x: g.x, y: g.y }]; // fantôme : tout droit à travers les murs
    } else {
      const gates = findPath(rectAt(p.x, p.y), rectAt(g.x, g.y));
      b.path = (gates || []).concat([{ x: g.x, y: g.y }]);
    }
    b.stuckAt = now;
    b.lastDist = Infinity;
  }
  const wp = b.path[0];
  if (!wp) { arrive(room, p, b, now); return; }
  const d = Math.hypot(wp.x - p.x, wp.y - p.y);
  if (d < 14) {
    b.path.shift();
    if (!b.path.length) arrive(room, p, b, now);
    return;
  }
  const step = Math.min(d, SPEED * dt);
  p.x += (wp.x - p.x) / d * step;
  p.y += (wp.y - p.y) / d * step;
  p.dir = wp.x >= p.x ? 1 : -1;
  p.moving = true;
  // anti-blocage : si aucun progrès en 3 s, saute au point de passage
  if (d < b.lastDist - 1) { b.lastDist = d; b.stuckAt = now; }
  else if (now - b.stuckAt > 3000) { p.x = wp.x; p.y = wp.y; b.stuckAt = now; b.lastDist = Infinity; }
}

function tickBots(room, api, dtMs) {
  const now = Date.now();
  const dt = dtMs / 1000;
  for (const p of room.players.values()) {
    if (!p.isBot) continue;
    const b = p.bot || (p.bot = {});

    if (room.phase === 'meeting') { meetingAI(room, p, b, api, now); continue; }
    if (room.phase !== 'play') { b.goal = null; b.path = null; b.busyUntil = 0; continue; }
    if (!p.alive && p.role === 'impostor') { p.moving = false; continue; }

    // occupé (mission / réparation en cours)
    if (b.busyUntil) {
      p.moving = false;
      if (now >= b.busyUntil) {
        b.busyUntil = 0;
        const g = b.goal;
        b.goal = null;
        b.path = null;
        if (g && g.kind === 'task') api.completeTask(room, p, g.id);
        else if (g && g.kind === 'fix') api.fixSab(room, p, g.type);
      }
      continue;
    }

    // signale un corps croisé (les saboteurs s'auto-signalent très rarement)
    if (p.alive && room.bodies.length) {
      const near = room.bodies.some((bd) => Math.hypot(bd.x - p.x, bd.y - p.y) < 120);
      const prob = p.role === 'impostor' ? 0.004 : 0.04;
      if (near && Math.random() < prob) {
        api.tryReport(room, p);
        continue;
      }
    }

    impostorAI(room, p, api, now);
    if (room.phase !== 'play') continue; // un kill peut terminer la partie

    chooseGoal(room, p, b, now);
    moveAlong(room, p, b, api, dt, now);
  }
}

module.exports = { tickBots };
