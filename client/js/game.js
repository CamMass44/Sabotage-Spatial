'use strict';
/*
 * Moteur de jeu : rendu canvas, déplacements + collisions, champ de vision,
 * mode caméras de surveillance, actions contextuelles, démarrage.
 */

/* ================= Entrées ================= */
const Input = (() => {
  const keys = new Set();
  const joy = { active: false, dx: 0, dy: 0, pointerId: null };

  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    keys.add(e.code);
    if (App.phase === 'play' && !App.meeting && $('screen-game') && !$('screen-game').classList.contains('hidden')) {
      if (e.code === 'KeyE' || e.code === 'Space') { e.preventDefault(); Actions.use(); }
      else if (e.code === 'KeyR') Actions.report();
      else if (e.code === 'KeyT') Actions.kill();
      else if (e.code === 'KeyV') Actions.vent();
      else if (e.code === 'KeyF') { if (App.isScientist() && App.alive) UI.openVitals(); }
      else if (e.code === 'KeyG') { if (App.isMetamorph() && App.alive) UI.openShiftPicker(); }
      else if (e.code === 'KeyC') {
        if ($('overlay-map').classList.contains('hidden')) UI.openMap(); else UI.closeMap();
      }
      else if (e.code === 'KeyB') { if (!$('b-sab').classList.contains('hidden') && !$('b-sab').disabled) UI.openSabPicker(); }
    }
    if (e.code === 'Escape') {
      UI.closeMap(); UI.closeSabPicker(); MiniGames.close(false);
      if (App.mode === 'cams') { App.mode = 'play'; $('cams-hud').classList.add('hidden'); }
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  // Joystick mobile
  const jEl = document.getElementById('joystick');
  const stick = document.getElementById('stick');
  if (jEl) {
    jEl.addEventListener('pointerdown', (e) => {
      joy.active = true; joy.pointerId = e.pointerId;
      jEl.setPointerCapture(e.pointerId);
      moveStick(e);
    });
    jEl.addEventListener('pointermove', (e) => { if (joy.active && e.pointerId === joy.pointerId) moveStick(e); });
    const end = (e) => {
      if (e.pointerId !== joy.pointerId) return;
      joy.active = false; joy.dx = 0; joy.dy = 0;
      stick.style.transform = 'translate(-50%,-50%)';
    };
    jEl.addEventListener('pointerup', end);
    jEl.addEventListener('pointercancel', end);
  }
  function moveStick(e) {
    const r = jEl.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const len = Math.hypot(dx, dy), max = r.width / 2 - 10;
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const dead = 8;
    joy.dx = Math.abs(dx) > dead ? dx / max : 0;
    joy.dy = Math.abs(dy) > dead ? dy / max : 0;
  }

  function vector() {
    let dx = 0, dy = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) dy -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) dy += 1;
    if (joy.active && (joy.dx || joy.dy)) { dx = joy.dx; dy = joy.dy; }
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    return { dx, dy };
  }

  return { vector };
})();

/* ================= Actions contextuelles ================= */
const Actions = (() => {
  let ctx = { use: null, reportable: false, killTarget: null };

  const FIX_GAMES = { lights: 'switches', reactor: 'holdfix', o2: 'code', comms: 'holdfix' };
  const FIX_TITLES = {
    lights: 'Réenclencher les disjoncteurs',
    reactor: 'Stabiliser le réacteur',
    o2: 'Réinitialiser le système O2',
    comms: 'Réaligner l’antenne'
  };

  function near(pt, range) {
    return distXY(App.pos.x, App.pos.y, pt.x, pt.y) <= range;
  }

  function compute() {
    ctx = { use: null, reportable: false, killTarget: null, ventNear: null };
    if (App.phase !== 'play' || App.meeting || App.mode === 'cams') return ctx;
    if (App.inVent || App.scanning) return ctx; // immobilisé : aucune action contextuelle

    // Réparation de sabotage (prioritaire, vivants uniquement)
    if (App.alive && App.sab) {
      const def = SHARED.SABOTAGES[App.sab.type];
      const pt = SHARED.POINTS[def.fix];
      if (near(pt, 110)) ctx.use = { kind: 'fix', type: App.sab.type };
    }
    // Mission à portée (les fantômes peuvent encore aider)
    if (!ctx.use && !(App.sab && App.sab.type === 'comms' && !App.isImpostor())) {
      for (const t of App.tasks) {
        if (t.done) continue;
        const def = SHARED.TASKS.find((d) => d.id === t.id);
        if (def && near(def, 100)) { ctx.use = { kind: 'task', task: t, def }; break; }
      }
    }
    // Console de surveillance
    if (!ctx.use && near(SHARED.POINTS.camera, 100)) ctx.use = { kind: 'cams' };
    // Bouton d'urgence
    if (!ctx.use && App.alive && near(SHARED.POINTS.emergency, 100)) ctx.use = { kind: 'emergency' };

    // Conduit à portée (saboteurs + ingénieurs)
    if (App.canVent()) {
      for (const v of SHARED.VENTS) { if (near(v, 70)) { ctx.ventNear = v; break; } }
    }

    // Signalement de corps
    if (App.alive) {
      ctx.reportable = App.bodies.some((b) => near(b, 140));
    }
    // Cible d'élimination (pas les complices, ni les joueurs en conduit)
    if (App.alive && App.role === 'impostor') {
      let best = null, bestD = 110;
      for (const p of App.players.values()) {
        if (p.id === App.you || !p.alive || !p.connected || p.vent) continue;
        if (App.partners.some((q) => q.id === p.id)) continue;
        const d = distXY(App.pos.x, App.pos.y, p.x, p.y);
        if (d < bestD) { bestD = d; best = p; }
      }
      ctx.killTarget = best;
    }
    return ctx;
  }

  function updateButtons() {
    const inGameScreen = !$('screen-game').classList.contains('hidden');
    if (!inGameScreen) return;
    compute();
    const bUse = $('b-use'), bReport = $('b-report'), bKill = $('b-kill'),
          bSab = $('b-sab'), bVent = $('b-vent'), bVitals = $('b-vitals'), bShift = $('b-shift');

    // En conduit : seuls les contrôles de conduit sont visibles
    $('btns').classList.toggle('btns-hidden', !!App.inVent);
    if (App.inVent) return;

    let useLabel = 'UTILISER';
    if (ctx.use) {
      if (ctx.use.kind === 'fix') useLabel = 'RÉPARER';
      else if (ctx.use.kind === 'cams') useLabel = 'CAMÉRAS';
      else if (ctx.use.kind === 'emergency') useLabel = 'URGENCE';
      else if (ctx.use.kind === 'task' && ctx.use.def.type === 'medscan') useLabel = 'SCANNER';
    }
    bUse.firstChild.textContent = useLabel;
    bUse.disabled = !ctx.use || App.scanning;
    bReport.disabled = !ctx.reportable;

    const imp = App.isImpostor() && App.alive;
    bKill.classList.toggle('hidden', !imp);
    bSab.classList.toggle('hidden', !imp);
    if (imp) {
      const cd = Math.ceil((App.killAt - Date.now()) / 1000);
      if (cd > 0) {
        bKill.disabled = true;
        bKill.firstChild.textContent = `TUER (${cd})`;
      } else {
        bKill.firstChild.textContent = 'TUER';
        bKill.disabled = !ctx.killTarget;
      }
      bSab.disabled = !!App.sab || App.phase !== 'play' || !!App.meeting;
    }

    // Métamorphose (Métamorphe)
    const meta = App.isMetamorph() && App.alive;
    bShift.classList.toggle('hidden', !meta);
    if (meta) {
      const disguised = App.disguises.has(App.you);
      const cd = Math.ceil((App.shiftReadyAt - Date.now()) / 1000);
      if (disguised) { bShift.disabled = false; bShift.firstChild.textContent = 'REVENIR'; }
      else if (cd > 0) { bShift.disabled = true; bShift.firstChild.textContent = `MORPH (${cd})`; }
      else { bShift.disabled = false; bShift.firstChild.textContent = 'MÉTAMORPHE'; }
    }

    // Conduit
    bVent.classList.toggle('hidden', !App.canVent());
    if (App.canVent()) bVent.disabled = !ctx.ventNear;

    // Constantes (Scientifique)
    const sci = App.isScientist() && App.alive;
    bVitals.classList.toggle('hidden', !sci);
    if (sci) {
      const cd = Math.ceil((App.vitalsReadyAt - Date.now()) / 1000);
      bVitals.disabled = cd > 0;
      bVitals.firstChild.textContent = cd > 0 ? `CONST. (${cd})` : 'CONSTANTES';
    }
  }

  async function use() {
    compute();
    if (!ctx.use || App.overlayOpen) return;
    const u = ctx.use;
    if (u.kind === 'task') {
      if (u.def.type === 'medscan') {
        App.socket.emit('scan:begin', { taskId: u.task.id }, (res) => {
          if (res && !res.ok) toast('Impossible de lancer le scan ici.');
        });
        return;
      }
      const ok = await MiniGames.open(u.def.type, u.def.name, u.def.room, 'task_' + u.task.id);
      if (ok) {
        App.socket.emit('task:done', { taskId: u.task.id }, (res) => {
          if (res && res.ok) {
            u.task.done = true;
            UI.refreshTasks();
            Sfx.task();
            if (App.isImpostor()) UI.chatSys('Mission simulée — les autres t’ont vu « travailler ».');
          }
        });
      }
    } else if (u.kind === 'fix') {
      const ok = await MiniGames.open(FIX_GAMES[u.type], FIX_TITLES[u.type], 'Réparation d’urgence', 'fix_' + u.type);
      if (ok) App.socket.emit('sab:fix', { type: u.type });
    } else if (u.kind === 'cams') {
      if (App.sab && App.sab.type === 'comms') { toast('📡 Caméras hors service (sabotage en cours)'); return; }
      App.mode = 'cams';
      $('cams-hud').classList.remove('hidden');
    } else if (u.kind === 'emergency') {
      App.socket.emit('emergency', {}, (res) => {
        if (res && !res.ok) toast(res.error || 'Impossible pour le moment.');
      });
    }
  }

  function report() {
    compute();
    if (ctx.reportable) App.socket.emit('report');
  }

  function kill() {
    compute();
    if (ctx.killTarget && Date.now() >= App.killAt) {
      App.socket.emit('kill', { targetId: ctx.killTarget.id });
    }
  }

  function vent() {
    if (App.inVent) { App.socket.emit('vent:exit'); return; }
    if (!App.canVent()) return;
    compute();
    if (ctx.ventNear) App.socket.emit('vent:enter', { ventId: ctx.ventNear.id });
  }

  return { use, report, kill, vent, updateButtons, compute };
})();

/* ================= Moteur ================= */
const Game = (() => {
  const cv = document.getElementById('cv');
  const g = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1;

  /* ---- Pré-rendu de la carte statique ---- */
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = SHARED.WORLD.w;
  mapCanvas.height = SHARED.WORLD.h;
  (function buildMap() {
    const m = mapCanvas.getContext('2d');
    m.fillStyle = '#060912';
    m.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
    // Étoiles (PRNG déterministe)
    let seed = 1337;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // Nébuleuses colorées en arrière-plan
    for (const [nx, ny, nr, col] of [
      [400, 1200, 420, 'rgba(124,58,237,0.10)'],
      [2100, 300, 380, 'rgba(14,165,233,0.09)'],
      [1300, 800, 500, 'rgba(236,72,153,0.05)']
    ]) {
      const ng = m.createRadialGradient(nx, ny, 0, nx, ny, nr);
      ng.addColorStop(0, col);
      ng.addColorStop(1, 'transparent');
      m.fillStyle = ng;
      m.fillRect(nx - nr, ny - nr, nr * 2, nr * 2);
    }
    for (let i = 0; i < 260; i++) {
      m.fillStyle = `rgba(255,255,255,${0.15 + rand() * 0.5})`;
      const s = rand() < 0.85 ? 1.2 : 2.2;
      m.fillRect(rand() * mapCanvas.width, rand() * mapCanvas.height, s, s);
    }
    // Murs : contour épais autour de chaque zone praticable…
    for (const r of SHARED.WALKABLE) {
      m.fillStyle = '#4a5680';
      m.fillRect(r.x - 9, r.y - 9, r.w + 18, r.h + 18);
    }
    // …puis sols par-dessus (les chevauchements créent les ouvertures)
    for (const c of SHARED.CORRIDORS) {
      m.fillStyle = '#1f2740';
      m.fillRect(c.x, c.y, c.w, c.h);
    }
    const palette = ['#2a3354', '#2d3a5e', '#293657', '#2b3150'];
    SHARED.ROOMS.forEach((r, i) => {
      m.fillStyle = palette[i % palette.length];
      m.fillRect(r.x, r.y, r.w, r.h);
      // léger quadrillage
      m.strokeStyle = '#ffffff08';
      m.lineWidth = 1;
      for (let x = r.x + 50; x < r.x + r.w; x += 50) {
        m.beginPath(); m.moveTo(x, r.y); m.lineTo(x, r.y + r.h); m.stroke();
      }
      for (let y = r.y + 50; y < r.y + r.h; y += 50) {
        m.beginPath(); m.moveTo(r.x, y); m.lineTo(r.x + r.w, y); m.stroke();
      }
      // ombrage intérieur (profondeur)
      m.strokeStyle = 'rgba(0,0,0,0.28)';
      m.lineWidth = 14;
      m.strokeRect(r.x + 7, r.y + 7, r.w - 14, r.h - 14);
    });

    /* ---- Détails du décor ---- */
    const box = (x, y, w, h, fill, stroke) => {
      m.fillStyle = fill; m.fillRect(x, y, w, h);
      if (stroke) { m.strokeStyle = stroke; m.lineWidth = 3; m.strokeRect(x, y, w, h); }
    };
    const circle = (x, y, r2, fill, stroke, lw) => {
      m.beginPath(); m.arc(x, y, r2, 0, Math.PI * 2);
      if (fill) { m.fillStyle = fill; m.fill(); }
      if (stroke) { m.strokeStyle = stroke; m.lineWidth = lw || 3; m.stroke(); }
    };
    const glowSpot = (x, y, r2, col) => {
      const g2 = m.createRadialGradient(x, y, 0, x, y, r2);
      g2.addColorStop(0, col); g2.addColorStop(1, 'transparent');
      m.fillStyle = g2; m.fillRect(x - r2, y - r2, r2 * 2, r2 * 2);
    };
    const hazard = (x, y, w, h) => {
      m.save();
      m.beginPath(); m.rect(x, y, w, h); m.clip();
      m.fillStyle = '#d8b021'; m.fillRect(x, y, w, h);
      m.fillStyle = '#16161c';
      for (let i = -h; i < w; i += 18) {
        m.beginPath();
        m.moveTo(x + i, y + h); m.lineTo(x + i + h, y);
        m.lineTo(x + i + h + 9, y); m.lineTo(x + i + 9, y + h);
        m.fill();
      }
      m.restore();
    };
    const consoleUnit = (x, y, w, h, screen) => {
      box(x, y, w, h, '#222b4c', '#11162b');
      box(x + 5, y + 4, w - 10, h * 0.45, screen || '#1d4ed8');
      m.fillStyle = '#ffffff2e'; m.fillRect(x + 7, y + 6, (w - 14) * 0.6, 3);
      m.fillStyle = '#facc15'; m.fillRect(x + 6, y + h - 9, 8, 5);
      m.fillStyle = '#ef4444'; m.fillRect(x + 17, y + h - 9, 8, 5);
      m.fillStyle = '#22c55e'; m.fillRect(x + 28, y + h - 9, 8, 5);
    };
    const crate = (x, y, s, col) => {
      box(x, y, s, s, col || '#8a6a3c', '#00000066');
      m.strokeStyle = '#c9a868'; m.lineWidth = 4;
      m.beginPath(); m.moveTo(x, y); m.lineTo(x + s, y + s);
      m.moveTo(x + s, y); m.lineTo(x, y + s); m.stroke();
    };
    const table = (x, y, r2) => {
      m.fillStyle = 'rgba(0,0,0,0.25)';
      m.beginPath(); m.ellipse(x, y + r2 * 0.5, r2, r2 * 0.4, 0, 0, Math.PI * 2); m.fill();
      circle(x, y, r2, '#3d4a78', '#2a3354', 5);
      circle(x, y, r2 * 0.55, '#48568c');
    };
    const bed = (x, y) => {
      box(x, y, 46, 86, '#cfd8ea', '#8a96b5');
      box(x, y, 46, 24, '#eef2fa');
      box(x, y + 30, 46, 56, '#3d7dc8', '#2a5a96');
    };
    const plant = (x, y) => {
      box(x - 11, y, 22, 15, '#7a5c33', '#00000066');
      circle(x - 8, y - 8, 9, '#3fae5a');
      circle(x + 8, y - 8, 9, '#33984d');
      circle(x, y - 16, 11, '#46c168');
    };
    const tank = (x, y, col) => {
      box(x - 11, y - 26, 22, 52, col, '#00000066');
      circle(x, y - 26, 11, col, '#00000066');
      box(x - 4, y - 40, 8, 14, '#9aa7cc');
    };
    const pipes = (x, y, w, n) => {
      for (let i = 0; i < n; i++) {
        m.fillStyle = i % 2 ? '#39466e' : '#46538a';
        m.fillRect(x, y + i * 12, w, 8);
        m.fillStyle = '#2a3354';
        for (let j = x + 30; j < x + w; j += 70) m.fillRect(j, y + i * 12 - 2, 8, 12);
      }
    };
    const vent2 = (x, y) => {
      circle(x, y, 20, '#1b2236', '#39466e', 4);
      m.strokeStyle = '#39466e'; m.lineWidth = 4;
      for (const a of [-7, 0, 7]) {
        m.beginPath(); m.moveTo(x - 12, y + a); m.lineTo(x + 12, y + a); m.stroke();
      }
    };
    const screenWall = (x, y, cols, rows) => {
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          box(x + i * 36, y + j * 28, 30, 22, (i + j) % 2 ? '#14352a' : '#122c44', '#000000aa');
          m.fillStyle = (i + j) % 2 ? '#4ade8077' : '#60a5fa77';
          m.fillRect(x + i * 36 + 3, y + j * 28 + 3, 12, 4);
          m.fillRect(x + i * 36 + 3, y + j * 28 + 10, 20, 2);
        }
      }
    };
    const hexa = (x, y, r2, col) => {
      m.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 3 * i - Math.PI / 6;
        const px = x + Math.cos(a) * r2, py = y + Math.sin(a) * r2;
        if (i) m.lineTo(px, py); else m.moveTo(px, py);
      }
      m.closePath();
      m.strokeStyle = col; m.lineWidth = 3; m.stroke();
    };

    // — Couloirs : tuyauterie, grilles, chevrons
    m.fillStyle = '#39466e';
    m.fillRect(1146, 500, 5, 450);                  // conduite Cafétéria→Stockage
    m.fillRect(190, 400, 5, 150);                   // Moteur sup→Réacteur
    m.fillRect(190, 900, 5, 150);                   // Réacteur→Moteur inf
    vent2(1200, 720);
    vent2(840, 1130);
    vent2(1550, 380);
    m.strokeStyle = '#ffffff10'; m.lineWidth = 4;
    for (const [cx, cy] of [[2110, 450], [2110, 920], [1370, 1200]]) {
      for (let k = 0; k < 3; k++) {
        m.beginPath();
        m.moveTo(cx - 10, cy + k * 16 - 16); m.lineTo(cx + 10, cy + k * 16 - 8); m.lineTo(cx - 10, cy + k * 16);
        m.stroke();
      }
    }

    // — Cafétéria : table d'urgence, tables rondes, distributeur, console données
    const e = SHARED.POINTS.emergency;
    glowSpot(e.x, e.y, 70, 'rgba(217,38,56,0.12)');
    m.fillStyle = 'rgba(0,0,0,0.25)';
    m.beginPath(); m.ellipse(e.x, e.y + 26, 50, 18, 0, 0, Math.PI * 2); m.fill();
    circle(e.x, e.y, 46, '#3d4a78', '#2a3354', 6);
    circle(e.x, e.y, 18, '#d92638', '#7a1622', 4);
    circle(e.x, e.y, 8, '#ff6b78');
    table(1010, 430, 32);
    table(1390, 430, 32);
    box(918, 118, 44, 70, '#5b3fa8', '#3b2575');    // distributeur
    box(924, 126, 32, 26, '#8d6fd6');
    m.fillStyle = '#facc15'; m.fillRect(924, 158, 32, 5);
    consoleUnit(1352, 178, 56, 42);                  // mission données

    // — Infirmerie : lits, scanner, croix médicale, plante
    bed(468, 238);
    bed(528, 238);
    circle(600, 320, 28, 'rgba(34,211,238,0.12)', '#22d3ee55', 3); // zone de scan
    circle(600, 320, 18, null, '#22d3ee33', 2);
    box(700, 222, 36, 36, '#e8edf7', '#b6c1d8');     // croix médicale
    m.fillStyle = '#d92638';
    m.fillRect(713, 228, 10, 24); m.fillRect(706, 235, 24, 10);
    plant(722, 422);

    // — Réacteur : cœur lumineux, console, danger, tuyaux
    glowSpot(250, 715, 90, 'rgba(56,254,220,0.16)');
    circle(250, 715, 52, '#173a3c', '#2dd4bf', 5);
    circle(250, 715, 34, '#0e2a2c', '#22a899', 3);
    circle(250, 715, 16, '#38fedc');
    consoleUnit(222, 612, 56, 40, '#0e7490');        // console de stabilisation
    hazard(120, 866, 260, 14);
    pipes(112, 562, 130, 2);

    // — Électricité : armoires électriques, câbles au sol
    for (let i = 0; i < 3; i++) {
      box(572 + i * 62, 614, 50, 66, '#39466e', '#222b4c');
      m.fillStyle = i === 0 ? '#facc15' : '#22c55e';
      m.fillRect(580 + i * 62, 622, 10, 6);
      m.fillStyle = '#0d1226';
      m.fillRect(580 + i * 62, 636, 34, 36);
      m.strokeStyle = '#4a5680'; m.lineWidth = 2;
      for (let s = 0; s < 3; s++) m.strokeRect(584 + i * 62 + s * 11, 642, 7, 22);
    }
    m.strokeStyle = '#d97706'; m.lineWidth = 4;
    m.beginPath(); m.moveTo(700, 750); m.bezierCurveTo(740, 790, 660, 810, 700, 845); m.stroke();
    m.strokeStyle = '#2563eb';
    m.beginPath(); m.moveTo(690, 745); m.bezierCurveTo(630, 790, 720, 815, 670, 850); m.stroke();

    // — Moteurs : bloc moteur, turbine, bidon de carburant
    for (const my of [200, 1100]) {
      box(120, my, 110, 160, '#39466e', '#222b4c');
      circle(175, my + 80, 38, '#222b4c', '#4a5680', 5);
      circle(175, my + 80, 22, '#11162b', '#39466e', 3);
      m.strokeStyle = '#4a5680'; m.lineWidth = 4;
      for (let a = 0; a < 4; a++) {
        m.beginPath();
        m.moveTo(175, my + 80);
        m.lineTo(175 + Math.cos(a * Math.PI / 2 + 0.6) * 20, my + 80 + Math.sin(a * Math.PI / 2 + 0.6) * 20);
        m.stroke();
      }
      for (let f = 0; f < 3; f++) box(230, my + 30 + f * 46, 38, 16, '#46538a', '#2a3354');
      glowSpot(280, my + 130, 36, 'rgba(249,115,22,0.18)'); // lueur d'échappement
      tank(330, my + 154, '#d97706');
      pipes(112, my - 36, 240, 2);
    }

    // — Salle caméras : mur d'écrans + console de surveillance
    screenWall(522, 1022, 6, 2);
    const c = SHARED.POINTS.camera;
    glowSpot(c.x, c.y, 60, 'rgba(34,197,94,0.12)');
    box(c.x - 38, c.y - 26, 76, 52, '#10241a', '#22c55e');
    box(c.x - 30, c.y - 18, 60, 24, '#0b3322');
    m.fillStyle = '#4ade80';
    m.fillRect(c.x - 26, c.y - 14, 16, 6); m.fillRect(c.x - 6, c.y - 14, 22, 3);
    m.fillRect(c.x - 26, c.y - 4, 30, 3);
    vent2(742, 1212);

    // — Stockage : caisses, barils, zone de chargement
    crate(928, 988, 54);
    crate(988, 988, 54);
    crate(958, 1046, 54);
    crate(1226, 1278, 50, '#6e7a3a');
    crate(1172, 1284, 46);
    circle(1258, 1010, 22, '#9a4444', '#5e2727', 4);
    circle(1258, 1062, 22, '#94843c', '#5c5226', 4);
    circle(1258, 1010, 10, '#7a3434');
    hazard(1062, 1330, 180, 14);

    // — Communications : baies serveurs, antenne, console d'envoi
    for (let i = 0; i < 3; i++) {
      box(1468 + i * 44, 1122, 36, 88, '#222b4c', '#11162b');
      for (let j = 0; j < 4; j++) {
        m.fillStyle = (i + j) % 3 === 0 ? '#4ade80' : (i + j) % 3 === 1 ? '#facc15' : '#3b82f6';
        m.fillRect(1474 + i * 44, 1130 + j * 18, 6, 6);
        m.fillStyle = '#39466e';
        m.fillRect(1484 + i * 44, 1130 + j * 18, 14, 6);
      }
    }
    const ant = SHARED.POINTS.commsFix;
    circle(ant.x, ant.y, 30, '#39466e', '#222b4c', 4);     // parabole
    circle(ant.x, ant.y, 30, null, '#9aa7cc44', 2);
    m.strokeStyle = '#9aa7cc'; m.lineWidth = 4;
    m.beginPath(); m.moveTo(ant.x, ant.y); m.lineTo(ant.x + 22, ant.y - 22); m.stroke();
    circle(ant.x + 22, ant.y - 22, 5, '#d92638');
    consoleUnit(1572, 1208, 56, 42, '#7c3aed');

    // — Navigation : baie vitrée sur l'espace, console de pilotage
    box(2252, 590, 34, 220, '#0a0e1c', '#38bdf8');
    m.fillStyle = '#ffffffaa';
    for (let i = 0; i < 9; i++) m.fillRect(2258 + rand() * 22, 600 + rand() * 200, 2, 2);
    consoleUnit(2122, 678, 56, 42, '#0ea5e9');
    circle(2150, 760, 24, null, '#38bdf855', 3);            // décal au sol
    circle(2150, 760, 14, null, '#38bdf833', 2);
    m.strokeStyle = '#38bdf833'; m.lineWidth = 2;
    m.beginPath(); m.moveTo(2110, 760); m.lineTo(2190, 760);
    m.moveTo(2150, 720); m.lineTo(2150, 800); m.stroke();

    // — O2 : cuves, filtre, végétation
    tank(1632, 366, '#2dd4bf');
    tank(1662, 366, '#14b8a6');
    circle(1730, 380, 24, '#1b2236', '#2dd4bf', 4);         // filtre à air
    m.strokeStyle = '#2dd4bf'; m.lineWidth = 3;
    for (const a of [-8, 0, 8]) {
      m.beginPath(); m.moveTo(1716, 380 + a); m.lineTo(1744, 380 + a); m.stroke();
    }
    consoleUnit(1652, 440, 56, 40, '#16a34a');
    plant(1822, 488);
    plant(1626, 492);

    // — Armement : cible de visée, caisses de munitions
    glowSpot(2040, 240, 70, 'rgba(217,38,56,0.10)');
    circle(2040, 240, 40, null, '#d9263855', 4);
    circle(2040, 240, 26, null, '#d9263844', 3);
    circle(2040, 240, 10, null, '#d9263866', 3);
    m.strokeStyle = '#d9263855'; m.lineWidth = 3;
    m.beginPath(); m.moveTo(1992, 240); m.lineTo(2088, 240);
    m.moveTo(2040, 192); m.lineTo(2040, 288); m.stroke();
    crate(1918, 140, 42, '#5c6b33');
    crate(1964, 140, 42, '#5c6b33');
    consoleUnit(2104, 300, 56, 40, '#dc2626');

    // — Boucliers : motif hexagonal au sol, émetteurs
    glowSpot(2040, 1120, 80, 'rgba(56,189,248,0.10)');
    hexa(2040, 1120, 34, '#38bdf866');
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i;
      hexa(2040 + Math.cos(a) * 59, 1120 + Math.sin(a) * 59, 34, '#38bdf833');
    }
    box(1916, 1014, 40, 40, '#222b4c', '#38bdf8');
    box(2124, 1186, 40, 40, '#222b4c', '#38bdf8');
    circle(1936, 1034, 8, '#38bdf8');
    circle(2144, 1206, 8, '#38bdf8');

    // — Couvercles de conduits (grilles métalliques au sol)
    for (const v of SHARED.VENTS) {
      m.save();
      m.translate(v.x, v.y);
      m.fillStyle = 'rgba(0,0,0,0.3)';
      m.beginPath(); m.ellipse(0, 7, 22, 9, 0, 0, Math.PI * 2); m.fill();
      box(-20, -16, 40, 30, '#3a4358', '#11151f');
      m.strokeStyle = '#586079'; m.lineWidth = 3;
      for (let k = -10; k <= 10; k += 6) { m.beginPath(); m.moveTo(k, -13); m.lineTo(k, 11); m.stroke(); }
      m.restore();
    }

    // — Noms des pièces (par-dessus le décor)
    m.textAlign = 'center';
    m.font = 'bold 24px Segoe UI';
    for (const r of SHARED.ROOMS) {
      m.fillStyle = 'rgba(10,14,28,0.45)';
      m.fillRect(r.x + r.w / 2 - r.name.length * 8 - 10, r.y + 14, r.name.length * 16 + 20, 28);
      m.fillStyle = 'rgba(190,205,240,0.75)';
      m.fillText(r.name.toUpperCase(), r.x + r.w / 2, r.y + 35);
    }
  })();

  /* ---- Minimap persistante (fond statique pré-rendu) ---- */
  const MM_SCALE = 0.072;                          // 2400*0.072 ≈ 173 px de large
  const MM_W = Math.round(SHARED.WORLD.w * MM_SCALE);
  const MM_H = Math.round(SHARED.WORLD.h * MM_SCALE);
  const mmBg = document.createElement('canvas');
  mmBg.width = MM_W; mmBg.height = MM_H;
  (function buildMinimap() {
    const c = mmBg.getContext('2d');
    c.scale(MM_SCALE, MM_SCALE);
    for (const r of SHARED.CORRIDORS) { c.fillStyle = '#243054'; c.fillRect(r.x, r.y, r.w, r.h); }
    for (const r of SHARED.ROOMS) {
      c.fillStyle = '#33406e'; c.fillRect(r.x, r.y, r.w, r.h);
      c.strokeStyle = '#4a5680'; c.lineWidth = 6; c.strokeRect(r.x, r.y, r.w, r.h);
    }
  })();

  const mmCanvas = document.getElementById('minimap');
  const mm = mmCanvas.getContext('2d');
  mmCanvas.width = MM_W; mmCanvas.height = MM_H;
  mmCanvas.style.width = MM_W + 'px';
  mmCanvas.style.height = MM_H + 'px';

  function drawMinimap() {
    if ($('screen-game').classList.contains('hidden')) { return; }
    mm.clearRect(0, 0, MM_W, MM_H);
    mm.drawImage(mmBg, 0, 0);
    const t = performance.now() / 1000;
    const pulse = 0.5 + Math.sin(t * 5) * 0.5;
    const sx = (x) => x * MM_SCALE, sy = (y) => y * MM_SCALE;

    // Missions à faire (les miennes)
    const commsDown = App.sab && App.sab.type === 'comms' && !App.isImpostor();
    if (!commsDown) {
      for (const task of App.tasks) {
        if (task.done) continue;
        const def = SHARED.TASKS.find((d) => d.id === task.id);
        if (!def) continue;
        mm.fillStyle = `rgba(250,204,21,${0.55 + pulse * 0.45})`;
        mm.beginPath(); mm.arc(sx(def.x), sy(def.y), 3.5, 0, Math.PI * 2); mm.fill();
      }
    }
    // Sabotage actif
    if (App.sab) {
      const pt = SHARED.POINTS[SHARED.SABOTAGES[App.sab.type].fix];
      mm.fillStyle = `rgba(217,38,56,${0.5 + pulse * 0.5})`;
      mm.beginPath(); mm.arc(sx(pt.x), sy(pt.y), 4, 0, Math.PI * 2); mm.fill();
    }
    // Bouton d'urgence
    mm.fillStyle = '#7a1622';
    mm.beginPath(); mm.arc(sx(SHARED.POINTS.emergency.x), sy(SHARED.POINTS.emergency.y), 2.5, 0, Math.PI * 2); mm.fill();

    // Spectateurs / caméras : toutes les positions
    if (!App.alive || App.mode === 'cams') {
      for (const p of App.players.values()) {
        if (p.id === App.you || !p.alive || p.vent) continue;
        mm.fillStyle = SHARED.COLORS[p.color];
        mm.beginPath(); mm.arc(sx(p.x), sy(p.y), 2.5, 0, Math.PI * 2); mm.fill();
      }
    }
    // Ma position
    const me = App.me();
    mm.fillStyle = '#fff';
    mm.beginPath(); mm.arc(sx(App.pos.x), sy(App.pos.y), 4.5, 0, Math.PI * 2); mm.fill();
    if (me) {
      mm.fillStyle = SHARED.COLORS[me.color];
      mm.beginPath(); mm.arc(sx(App.pos.x), sy(App.pos.y), 3, 0, Math.PI * 2); mm.fill();
    }
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W * DPR; cv.height = H * DPR;
  }
  window.addEventListener('resize', resize);
  resize();

  /* ---- Personnage ---- */
  function drawDude(c, x, y, colorIdx, dir, opts = {}) {
    const col = SHARED.COLORS[colorIdx] || '#888';
    const t = performance.now() / 1000;
    const bob = opts.moving ? Math.sin(t * 14) * 2.5 : 0;
    c.save();
    c.globalAlpha = opts.alpha != null ? opts.alpha : 1;
    if (!opts.ghost) {
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.beginPath(); c.ellipse(x, y + 14, 16, 6, 0, 0, Math.PI * 2); c.fill();
    }
    const fy = opts.ghost ? y + Math.sin(t * 3) * 4 : y + bob * 0.3;
    // sac à dos
    c.fillStyle = shade(col, -25);
    rr(c, x - dir * 20, fy - 18, 11, 22, 5); c.fill();
    // corps
    c.fillStyle = col;
    rr(c, x - 15, fy - 32, 30, 42, 14); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 2.5;
    rr(c, x - 15, fy - 32, 30, 42, 14); c.stroke();
    // jambes
    if (!opts.ghost) {
      c.fillStyle = col;
      const lift = opts.moving ? Math.sin(t * 14) * 4 : 0;
      rr(c, x - 12, fy + 4, 10, 9 - lift * 0.5, 4); c.fill();
      rr(c, x + 2, fy + 4, 10, 9 + lift * 0.5, 4); c.fill();
    }
    // visière
    c.fillStyle = '#bfe6f5';
    c.beginPath();
    c.ellipse(x + dir * 7, fy - 18, 9.5, 6.5, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 2; c.stroke();
    c.restore();
  }

  function drawBody(c, b) {
    const col = SHARED.COLORS[b.color] || '#888';
    c.save();
    c.translate(b.x, b.y);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath(); c.ellipse(0, 10, 22, 7, 0, 0, Math.PI * 2); c.fill();
    c.rotate(Math.PI / 2.3);
    c.fillStyle = col;
    rr(c, -14, -26, 28, 36, 12); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 2.5;
    rr(c, -14, -26, 28, 36, 12); c.stroke();
    c.restore();
    // croix rouge
    c.save();
    c.strokeStyle = '#ff4757'; c.lineWidth = 3.5; c.lineCap = 'round';
    c.beginPath();
    c.moveTo(b.x - 8, b.y - 34); c.lineTo(b.x + 8, b.y - 20);
    c.moveTo(b.x + 8, b.y - 34); c.lineTo(b.x - 8, b.y - 20);
    c.stroke();
    c.restore();
  }

  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, v + amt));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  /* ---- Boucle ---- */
  let lastT = performance.now();
  let lastSent = { x: 0, y: 0, moving: false };

  function update(dt) {
    if (App.phase !== 'play' || App.meeting) return;
    if (App.overlayOpen || App.mode === 'cams' || App.inVent || App.scanning) {
      if (App.pos.moving) { App.pos.moving = false; Net.sendMove(); }
      interpolate(dt);
      return;
    }
    const v = Input.vector();
    const speed = App.alive ? 235 : 330;
    if (v.dx || v.dy) {
      let nx = App.pos.x + v.dx * speed * dt;
      let ny = App.pos.y + v.dy * speed * dt;
      nx = Math.max(20, Math.min(SHARED.WORLD.w - 20, nx));
      ny = Math.max(20, Math.min(SHARED.WORLD.h - 20, ny));
      if (App.alive) {
        // glisse le long des murs : essaie x puis y séparément
        if (SHARED.canStand(nx, App.pos.y)) App.pos.x = nx;
        if (SHARED.canStand(App.pos.x, ny)) App.pos.y = ny;
      } else {
        App.pos.x = nx; App.pos.y = ny; // les fantômes traversent les murs
      }
      if (v.dx !== 0) App.pos.dir = v.dx > 0 ? 1 : -1;
      App.pos.moving = true;
    } else {
      App.pos.moving = false;
    }
    const moved = distXY(App.pos.x, App.pos.y, lastSent.x, lastSent.y) > 1;
    if (moved || App.pos.moving !== lastSent.moving) {
      Net.sendMove();
      lastSent = { x: App.pos.x, y: App.pos.y, moving: App.pos.moving };
    }
    interpolate(dt);
  }

  function interpolate(dt) {
    const k = Math.min(1, dt * 12);
    for (const p of App.players.values()) {
      if (p.id === App.you) continue;
      if (p.tx == null) { p.tx = p.x; p.ty = p.y; }
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
    }
  }

  function render() {
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.fillStyle = '#060912';
    g.fillRect(0, 0, W, H);
    if ($('screen-game').classList.contains('hidden')) return;

    const cams = App.mode === 'cams';
    const fullVision = cams || !App.alive;
    let z, camX, camY;
    if (cams) {
      z = Math.min(W / SHARED.WORLD.w, H / SHARED.WORLD.h) * 0.96;
      camX = SHARED.WORLD.w / 2; camY = SHARED.WORLD.h / 2;
    } else {
      z = Math.min(1.15, Math.max(0.72, Math.min(W, H) / 760));
      camX = App.pos.x; camY = App.pos.y;
    }
    g.setTransform(z * DPR, 0, 0, z * DPR, (W / 2 - camX * z) * DPR, (H / 2 - camY * z) * DPR);

    g.drawImage(mapCanvas, 0, 0);

    const t = performance.now() / 1000;
    const pulse = 0.6 + Math.sin(t * 5) * 0.4;

    // Objectifs de mission (les miens, non terminés)
    const commsDown = App.sab && App.sab.type === 'comms' && !App.isImpostor();
    if (App.phase === 'play' && !commsDown) {
      for (const task of App.tasks) {
        if (task.done) continue;
        const def = SHARED.TASKS.find((d) => d.id === task.id);
        if (!def) continue;
        g.fillStyle = `rgba(250,204,21,${0.5 + pulse * 0.4})`;
        g.beginPath(); g.arc(def.x, def.y, 14 + pulse * 4, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#1a1a05';
        g.font = 'bold 20px Segoe UI'; g.textAlign = 'center';
        g.fillText('!', def.x, def.y + 7);
      }
    }
    // Point de réparation du sabotage actif
    if (App.sab) {
      const def = SHARED.SABOTAGES[App.sab.type];
      const pt = SHARED.POINTS[def.fix];
      g.fillStyle = `rgba(217,38,56,${0.5 + pulse * 0.5})`;
      g.beginPath(); g.arc(pt.x, pt.y, 18 + pulse * 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 22px Segoe UI'; g.textAlign = 'center';
      g.fillText('🔧', pt.x, pt.y + 8);
    }
    // Marqueurs d'événements suspects
    for (const mk of App.markers) {
      g.globalAlpha = 0.7 + pulse * 0.3;
      g.font = '30px serif'; g.textAlign = 'center';
      g.fillText('⚠️', mk.x, mk.y + 10);
      g.globalAlpha = 1;
      g.fillStyle = SHARED.COLORS[mk.color];
      g.font = 'bold 13px Segoe UI';
      g.fillText(mk.name, mk.x, mk.y + 28);
    }
    // Conduits : surbrillance pour ceux qui peuvent les emprunter
    if (App.canVent()) {
      for (const v of SHARED.VENTS) {
        const here = distXY(App.pos.x, App.pos.y, v.x, v.y) <= 70;
        g.strokeStyle = here ? `rgba(96,165,250,${0.7 + pulse * 0.3})` : 'rgba(96,165,250,0.35)';
        g.lineWidth = here ? 4 : 2.5;
        g.beginPath(); g.arc(v.x, v.y, 22 + (here ? pulse * 4 : 0), 0, Math.PI * 2); g.stroke();
        if (here) {
          g.fillStyle = '#cfe0ff'; g.font = 'bold 12px Segoe UI'; g.textAlign = 'center';
          g.fillText('CONDUIT', v.x, v.y - 28);
        }
      }
    }

    // Scans médicaux en cours (anneaux montants, visibles par tous)
    for (const [, s] of App.scans) {
      const prog = 1 - Math.max(0, (s.endsAt - Date.now()) / (SHARED.SCAN_DURATION * 1000));
      g.save();
      g.strokeStyle = '#22d3ee';
      for (let r = 0; r < 3; r++) {
        const phase = (prog * 2 + r / 3) % 1;
        g.globalAlpha = 0.5 * (1 - phase);
        g.lineWidth = 3;
        g.beginPath(); g.ellipse(s.x, s.y, 30, 12, 0, 0, Math.PI * 2);
        g.stroke();
        g.translate(0, 0);
      }
      g.globalAlpha = 0.8;
      g.fillStyle = '#22d3ee'; g.font = '16px Segoe UI'; g.textAlign = 'center';
      g.fillText('🩺', s.x, s.y - 50);
      g.restore();
      // barre de scan qui monte le long du corps
      g.save();
      g.globalAlpha = 0.6;
      g.strokeStyle = '#7defff'; g.lineWidth = 3;
      const sy = s.y + 12 - prog * 60;
      g.beginPath(); g.moveTo(s.x - 26, sy); g.lineTo(s.x + 26, sy); g.stroke();
      g.restore();
    }

    // Corps
    for (const b of App.bodies) drawBody(g, b);

    // Joueurs (triés par y pour la profondeur)
    const viewerDead = !App.alive;
    const drawList = [];
    for (const p of App.players.values()) {
      if (!p.connected && App.phase === 'play') continue;
      if (p.vent) continue;                                  // joueurs en conduit : invisibles
      const isMe = p.id === App.you;
      const x = isMe ? App.pos.x : p.x;
      const y = isMe ? App.pos.y : p.y;
      if (!p.alive && !isMe && !viewerDead) continue;        // fantômes invisibles aux vivants
      if (!p.alive && cams) continue;                        // les caméras ne voient pas les fantômes
      drawList.push({ p, x, y, isMe });
    }
    drawList.sort((a, b) => a.y - b.y);
    for (const d of drawList) {
      const ghost = !d.p.alive;
      // Métamorphose : apparence (couleur + pseudo) empruntée
      const disg = App.disguises.get(d.p.id);
      const color = disg ? disg.color : d.p.color;
      const dispName = disg ? disg.name : d.p.name;
      drawDude(g, d.x, d.y, color, d.isMe ? App.pos.dir : d.p.dir, {
        moving: d.isMe ? App.pos.moving : d.p.moving,
        ghost,
        alpha: ghost ? 0.45 : 1
      });
      // pseudo
      const impVision = App.isImpostor() && App.partners.some((q) => q.id === d.p.id);
      g.font = 'bold 14px Segoe UI';
      g.textAlign = 'center';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.strokeText(dispName, d.x, d.y - 44);
      g.fillStyle = impVision ? '#ff4757' : (ghost ? '#9aa7cc' : '#fff');
      g.fillText(dispName, d.x, d.y - 44);
    }

    // Champ de vision
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (!fullVision) {
      let vis = App.isImpostor() ? 430 : 330;
      if (App.sab && App.sab.type === 'lights' && !App.isImpostor()) vis = 130;
      const r = vis * z;
      const grad = g.createRadialGradient(W / 2, H / 2, r * 0.55, W / 2, H / 2, r);
      grad.addColorStop(0, 'rgba(4,6,12,0)');
      grad.addColorStop(1, 'rgba(4,6,12,0.97)');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    }
    if (cams) {
      // habillage "caméras"
      g.strokeStyle = '#22c55e';
      g.lineWidth = 4;
      g.strokeRect(6, 6, W - 12, H - 12);
      g.fillStyle = Math.floor(t * 2) % 2 ? '#ff4757' : '#7a1622';
      g.beginPath(); g.arc(28, H - 28, 8, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#4ade80';
      g.font = 'bold 13px monospace';
      g.textAlign = 'left';
      g.fillText('● REC — SURVEILLANCE DU VAISSEAU', 44, H - 23);
    }
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    try {
      update(dt);
      render();
      drawMinimap();
    } catch (e) { /* ne casse pas la boucle */ }
    requestAnimationFrame(loop);
  }

  function onGameStart() {
    App.mode = 'play';
    $('cams-hud').classList.add('hidden');
    lastSent = { x: 0, y: 0, moving: false };
  }

  function start() {
    requestAnimationFrame(loop);
    setInterval(() => {
      try { Actions.updateButtons(); } catch (e) { /* DOM pas prêt */ }
    }, 150);
  }

  return { start, onGameStart };
})();

/* ================= Démarrage ================= */
window.addEventListener('DOMContentLoaded', () => {
  UI.initEvents();
  Net.connect();
  Game.start();
});
