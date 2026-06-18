'use strict';
/* État global du client + petits utilitaires. */

window.App = {
  socket: null,
  code: null,
  you: null,
  token: null,
  name: '',
  phase: 'home',     // reflète room:state
  hostId: null,
  players: new Map(), // id -> {id,name,color,connected,alive,x,y,tx,ty,dir,moving}
  settings: null,

  // état de partie (privé)
  role: null,
  partners: [],
  tasks: [],
  taskPct: 0,
  bodies: [],
  markers: [],
  sab: null,          // { type, endsAt|null }
  meeting: null,      // { stage, endsAt, voted:Set, myVote, deadIds }
  emergenciesLeft: 0,
  killAt: 0,

  // état local
  pos: { x: 0, y: 0, dir: 1, moving: false },
  alive: true,
  mode: 'play',       // 'play' | 'cams'
  overlayOpen: false, // mini-jeu / carte / sabotage ouverts
  unread: 0
};

App.me = () => App.players.get(App.you) || null;
App.isHost = () => App.you === App.hostId;
App.inGame = () => App.phase === 'play' || App.phase === 'meeting';

const $ = (id) => document.getElementById(id);
const distXY = (x1, y1, x2, y2) => Math.hypot(x1 - x2, y1 - y2);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, ms = 3000) {
  const box = $('toast');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast-msg';
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/* Petits sons synthétiques (pas d'assets) */
const Sfx = (() => {
  let ctx = null;
  function ac() {
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* pas d'audio */ } }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type = 'sine', vol = 0.08, when = 0) {
    const c = ac();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, c.currentTime + when);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + when + dur);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime + when);
    o.stop(c.currentTime + when + dur + 0.05);
  }
  return {
    unlock: ac,
    task: () => { tone(660, 0.12); tone(880, 0.18, 'sine', 0.08, 0.1); },
    kill: () => { tone(110, 0.4, 'sawtooth', 0.12); },
    meeting: () => { tone(523, 0.18, 'square', 0.07); tone(523, 0.18, 'square', 0.07, 0.25); tone(659, 0.3, 'square', 0.07, 0.5); },
    alarm: () => { tone(880, 0.15, 'square', 0.05); tone(660, 0.15, 'square', 0.05, 0.18); },
    chat: () => { tone(990, 0.06, 'sine', 0.04); },
    eject: () => { tone(330, 0.5, 'triangle', 0.08); }
  };
})();
