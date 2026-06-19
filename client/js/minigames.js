'use strict';
/*
 * Mini-jeux des missions et réparations, avec suspension/reprise.
 * MiniGames.open(type, title, sub, key) -> Promise<boolean>
 *   résout true si réussi, false si annulé OU mis en pause (« Plus tard »).
 * Une partie mise en pause est conservée par `key` : rouvrir la même clé reprend où on en était.
 * MiniGames.close(result) : réinitialisation dure (mort, réunion, fin de partie) — vide toutes les sessions.
 */
window.MiniGames = (() => {
  let activeResolve = null;
  let activeKey = null;
  const sessions = new Map(); // key -> session

  const overlay = () => $('overlay-minigame');
  const mgbox = () => $('mg-box');

  /* ---- Cycle de vie d'une session ---- */

  function open(type, title, sub, key) {
    return new Promise((resolve) => {
      if (activeResolve) suspendActive();         // un autre mini-jeu était ouvert : on le met en pause
      activeResolve = resolve;
      activeKey = key;
      App.overlayOpen = true;
      overlay().classList.remove('hidden');
      mgbox().innerHTML = '';
      let s = sessions.get(key);
      if (s) {
        mgbox().appendChild(s.frame);
        resumeSession(s);
      } else {
        s = buildSession(type, title, sub, key);
        sessions.set(key, s);
        mgbox().appendChild(s.frame);
      }
    });
  }

  function buildSession(type, title, sub, key) {
    const frame = document.createElement('div');
    frame.className = 'mg-frame';
    frame.innerHTML = `
      <div class="mg-title">${escapeHtml(title)}</div>
      <div class="mg-sub">${escapeHtml(sub || '')}</div>
      <div class="mg-area"></div>
      <div class="mg-actions">
        <button class="btn mg-later">↩ Plus tard</button>
        <button class="btn mg-cancel">✕ Abandonner</button>
      </div>`;
    const s = {
      key, frame, area: frame.querySelector('.mg-area'),
      timers: [], cleanups: [], state: {}, step: null, onResume: null, lastTick: 0
    };
    frame.querySelector('.mg-later').onclick = () => suspendActive();
    frame.querySelector('.mg-cancel').onclick = () => finish(s, false);
    s.win = () => finish(s, true);
    s.addTimer = (id) => { s.timers.push(id); return id; };
    s.startLoop = (step, ms) => { s.step = step; s.stepMs = ms || 50; runLoop(s); };
    (builders[type] || builders.download)(s);
    return s;
  }

  function runLoop(s) {
    s.lastTick = performance.now();
    const h = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - s.lastTick) / 1000);
      s.lastTick = now;
      try { s.step(dt); } catch (e) { /* ignore */ }
    }, s.stepMs || 50);
    s.timers.push(h);
  }

  function pauseSession(s) {
    s.timers.forEach((id) => { clearInterval(id); clearTimeout(id); });
    s.timers = [];
  }

  function resumeSession(s) {
    if (s.onResume) try { s.onResume(); } catch (e) { /* ignore */ }
    if (s.step) runLoop(s);
  }

  function hideOverlay() {
    overlay().classList.add('hidden');
    mgbox().innerHTML = '';
    App.overlayOpen = false;
  }

  function suspendActive() {
    const s = sessions.get(activeKey);
    const r = activeResolve;
    activeResolve = null; activeKey = null;
    if (s) {
      pauseSession(s);
      if (s.frame.parentElement) s.frame.parentElement.removeChild(s.frame); // détache, conservé dans s.frame
      toast('Tâche mise en pause — reviens-y quand tu veux');
    }
    hideOverlay();
    if (r) r(false);
  }

  function finish(s, result) {
    pauseSession(s);
    s.cleanups.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
    sessions.delete(s.key);
    if (activeKey === s.key) {
      const r = activeResolve;
      activeResolve = null; activeKey = null;
      hideOverlay();
      if (r) r(result);
    }
  }

  // Réinitialisation dure : vide toutes les sessions en pause
  function close(result) {
    for (const s of sessions.values()) {
      pauseSession(s);
      s.cleanups.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
    }
    sessions.clear();
    hideOverlay();
    if (activeResolve) { const r = activeResolve; activeResolve = null; activeKey = null; r(result); }
  }

  /* ---- Mini-jeux ---- */

  // Câbles : état entièrement dans le DOM (reprise = simple ré-attache)
  function wires(s) {
    const a = s.area;
    if (s.state.built) return; // déjà construit : le DOM conservé suffit
    s.state.built = true;
    const colors = ['#ff4757', '#2563eb', '#facc15', '#ec4899'];
    const right = colors.slice();
    for (let i = right.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [right[i], right[j]] = [right[j], right[i]]; }
    a.innerHTML = `<div class="wire-area"><svg class="wire-svg"></svg><div class="wire-col left"></div><div class="wire-col right"></div></div>`;
    const wa = a.querySelector('.wire-area'), svg = a.querySelector('.wire-svg');
    const colL = a.querySelector('.left'), colR = a.querySelector('.right');
    colors.forEach((c) => { const n = document.createElement('button'); n.className = 'wire-node'; n.style.background = c; n.dataset.c = c; colL.appendChild(n); });
    right.forEach((c) => { const n = document.createElement('button'); n.className = 'wire-node'; n.style.background = c; n.dataset.c = c; colR.appendChild(n); });
    let sel = null, done = 0;
    const center = (el) => { const r = el.getBoundingClientRect(), w = wa.getBoundingClientRect(); return { x: r.left - w.left + r.width / 2, y: r.top - w.top + r.height / 2 }; };
    colL.querySelectorAll('.wire-node').forEach((n) => {
      n.onclick = () => { if (n.classList.contains('done')) return; colL.querySelectorAll('.wire-node').forEach((m) => m.classList.remove('sel')); n.classList.add('sel'); sel = n; };
    });
    colR.querySelectorAll('.wire-node').forEach((n) => {
      n.onclick = () => {
        if (!sel || n.classList.contains('done')) return;
        if (n.dataset.c === sel.dataset.c) {
          const p = center(sel), q = center(n);
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', p.x); line.setAttribute('y1', p.y); line.setAttribute('x2', q.x); line.setAttribute('y2', q.y);
          line.setAttribute('stroke', n.dataset.c); line.setAttribute('stroke-width', '6'); line.setAttribute('stroke-linecap', 'round');
          svg.appendChild(line);
          sel.classList.add('done'); sel.classList.remove('sel'); n.classList.add('done'); sel = null;
          if (++done === colors.length) s.addTimer(setTimeout(() => s.win(), 350));
        } else { sel.classList.remove('sel'); sel = null; wa.classList.add('shake'); setTimeout(() => wa.classList.remove('shake'), 350); }
      };
    });
  }

  // Barre de progression (scan / téléchargement) — reprise via state.p
  function timed(s, secs, label) {
    if (s.state.p == null) s.state.p = 0;
    s.area.innerHTML = `<p style="text-align:center;color:#9fb4e8">${escapeHtml(label)}</p>
      <div class="mg-progress"><div></div></div><p class="simon-status">0%</p>`;
    const bar = s.area.querySelector('.mg-progress > div'), status = s.area.querySelector('.simon-status');
    const paint = () => { bar.style.width = (s.state.p * 100) + '%'; status.textContent = Math.round(s.state.p * 100) + '%'; };
    paint();
    s.onResume = paint;
    s.startLoop((dt) => {
      s.state.p = Math.min(1, s.state.p + dt / secs);
      paint();
      if (s.state.p >= 1) { pauseSession(s); s.addTimer(setTimeout(() => s.win(), 200)); }
    });
  }

  // Maintenir le bouton (réparations) — reprise via state.p
  function holdFill(s, secs, label) {
    if (s.state.p == null) s.state.p = 0;
    s.area.innerHTML = `<div class="mg-progress"><div></div></div>
      <button class="btn primary mg-hold-btn">✋ ${escapeHtml(label)}</button>`;
    const bar = s.area.querySelector('.mg-progress > div'), btn = s.area.querySelector('.mg-hold-btn');
    let holding = false;
    bar.style.width = (s.state.p * 100) + '%';
    const on = (e) => { e.preventDefault(); holding = true; };
    const off = () => { holding = false; };
    btn.addEventListener('pointerdown', on);
    window.addEventListener('pointerup', off);
    window.addEventListener('pointercancel', off);
    s.cleanups.push(() => { window.removeEventListener('pointerup', off); window.removeEventListener('pointercancel', off); });
    s.onResume = () => { holding = false; };
    s.startLoop((dt) => {
      s.state.p += holding ? dt / secs : -dt / (secs * 2);
      s.state.p = Math.max(0, Math.min(1, s.state.p));
      bar.style.width = (s.state.p * 100) + '%';
      if (s.state.p >= 1) { pauseSession(s); s.addTimer(setTimeout(() => s.win(), 200)); }
    });
  }

  // Code à recopier — état dans le DOM/closure
  function code(s) {
    if (s.state.target == null) s.state.target = String(Math.floor(10000 + Math.random() * 90000));
    const target = s.state.target;
    s.area.innerHTML = `<div class="kp-code">Code : ${target}</div><div class="kp-display"></div><div class="kp-grid"></div>`;
    const disp = s.area.querySelector('.kp-display'), grid = s.area.querySelector('.kp-grid');
    let input = '';
    disp.textContent = input;
    ['1','2','3','4','5','6','7','8','9','C','0','OK'].forEach((k) => {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = k;
      b.onclick = () => {
        if (k === 'C') input = '';
        else if (k === 'OK') {
          if (input === target) { disp.style.color = '#4ade80'; s.addTimer(setTimeout(() => s.win(), 300)); }
          else { input = ''; disp.classList.add('shake'); setTimeout(() => disp.classList.remove('shake'), 350); }
        } else if (input.length < 5) input += k;
        disp.textContent = input;
      };
      grid.appendChild(b);
    });
  }

  // Simon — séquence conservée dans state.seq, ré-affichée à la reprise
  function simon(s) {
    const cols = ['#ff4757', '#2563eb', '#22c55e', '#facc15'];
    if (!s.state.seq) s.state.seq = Array.from({ length: 4 }, () => Math.floor(Math.random() * 4));
    const seq = s.state.seq;
    s.area.innerHTML = `<div class="simon-grid"></div><div class="simon-status">Observe la séquence…</div>`;
    const grid = s.area.querySelector('.simon-grid'), status = s.area.querySelector('.simon-status');
    const btns = cols.map((c, i) => { const b = document.createElement('button'); b.className = 'simon-btn'; b.style.background = c; b.style.color = c; b.dataset.i = i; grid.appendChild(b); return b; });
    let idx = 0, accepting = false;
    const flash = (i, d) => s.addTimer(setTimeout(() => { btns[i].classList.add('lit'); setTimeout(() => btns[i].classList.remove('lit'), 380); }, d));
    function playSeq() {
      accepting = false; idx = 0; status.textContent = 'Observe la séquence…';
      seq.forEach((v, k) => flash(v, 600 + k * 600));
      s.addTimer(setTimeout(() => { accepting = true; status.textContent = 'À toi de jouer !'; }, 600 + seq.length * 600));
    }
    btns.forEach((b) => {
      b.onclick = () => {
        if (!accepting) return;
        const i = Number(b.dataset.i);
        b.classList.add('lit'); setTimeout(() => b.classList.remove('lit'), 200);
        if (i === seq[idx]) { if (++idx === seq.length) { status.textContent = '✓ Calibré !'; s.addTimer(setTimeout(() => s.win(), 400)); } }
        else { status.textContent = '✗ Erreur, on recommence'; s.addTimer(setTimeout(playSeq, 700)); }
      };
    });
    s.onResume = playSeq;  // à la reprise, on rejoue la même séquence
    playSeq();
  }

  /* ===== Astéroïdes : mini shoot'em up (atteindre le bout en 15 s) ===== */
  function asteroids(s) {
    const W = 360, H = 290, DUR = 15;
    s.area.innerHTML = `<canvas class="mg-cv" width="${W}" height="${H}"></canvas>
      <div class="mg-progress" style="margin:10px 0 0"><div></div></div>
      <p class="simon-status">Pilote — esquive et détruis les astéroïdes !</p>`;
    const cv = s.area.querySelector('.mg-cv'), ctx = cv.getContext('2d');
    const bar = s.area.querySelector('.mg-progress > div'), status = s.area.querySelector('.simon-status');
    const st = s.state;
    if (st.t == null) { st.t = 0; st.shipX = W / 2; st.rocks = []; st.shots = []; st.spawn = 0; st.fire = 0; st.inv = 0; }

    const setX = (clientX) => {
      const r = cv.getBoundingClientRect();
      st.shipX = Math.max(16, Math.min(W - 16, (clientX - r.left) * (W / r.width)));
    };
    let dragging = false;
    cv.addEventListener('pointerdown', (e) => { dragging = true; setX(e.clientX); });
    cv.addEventListener('pointermove', (e) => { if (dragging) setX(e.clientX); });
    const up = () => { dragging = false; };
    window.addEventListener('pointerup', up);
    s.cleanups.push(() => window.removeEventListener('pointerup', up));

    function draw() {
      ctx.fillStyle = '#070b18'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffffff22';
      for (let i = 0; i < 30; i++) { const y = (i * 53 + (st.t * 60) % H) % H; ctx.fillRect((i * 71) % W, y, 2, 2); }
      // ligne d'arrivée qui descend
      const finishY = -20 + (st.t / DUR) * (H + 40);
      if (finishY > -10) { ctx.fillStyle = '#22c55e'; for (let x = 0; x < W; x += 24) ctx.fillRect(x, finishY, 12, 6); }
      // tirs
      ctx.fillStyle = '#facc15';
      for (const b of st.shots) ctx.fillRect(b.x - 2, b.y, 4, 10);
      // astéroïdes
      for (const r of st.rocks) {
        ctx.fillStyle = '#9a7b5a'; ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#5c4530'; ctx.lineWidth = 2; ctx.stroke();
      }
      // vaisseau
      ctx.globalAlpha = st.inv > 0 && Math.floor(st.t * 20) % 2 ? 0.3 : 1;
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath(); ctx.moveTo(st.shipX, H - 28); ctx.lineTo(st.shipX - 13, H - 6); ctx.lineTo(st.shipX + 13, H - 6); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      bar.style.width = (st.t / DUR * 100) + '%';
    }
    draw();
    s.onResume = draw;

    s.startLoop((dt) => {
      st.t += dt;
      st.inv = Math.max(0, st.inv - dt);
      // spawn d'astéroïdes (de plus en plus fréquent)
      st.spawn -= dt;
      const rate = 0.7 - Math.min(0.45, st.t * 0.03);
      if (st.spawn <= 0) { st.spawn = rate; st.rocks.push({ x: 20 + Math.random() * (W - 40), y: -16, r: 11 + Math.random() * 9, v: 90 + Math.random() * 90 + st.t * 4 }); }
      // tir auto
      st.fire -= dt;
      if (st.fire <= 0) { st.fire = 0.22; st.shots.push({ x: st.shipX, y: H - 30 }); }
      for (const b of st.shots) b.y -= 360 * dt;
      st.shots = st.shots.filter((b) => b.y > -10);
      // déplacement + collisions
      for (const r of st.rocks) r.y += r.v * dt;
      for (const r of st.rocks) {
        for (const b of st.shots) {
          if (Math.abs(b.x - r.x) < r.r && Math.abs(b.y - r.y) < r.r) { r.dead = true; b.y = -99; }
        }
        const sy = H - 17;
        if (!r.dead && st.inv <= 0 && r.y > sy - r.r && r.y < sy + r.r && Math.abs(r.x - st.shipX) < r.r + 12) {
          r.dead = true; st.inv = 1.2; st.t = Math.max(0, st.t - DUR * 0.18); // touché : recul
          cv.classList.add('shake'); s.addTimer(setTimeout(() => cv.classList.remove('shake'), 300));
        }
      }
      st.rocks = st.rocks.filter((r) => !r.dead && r.y < H + 20);
      draw();
      if (st.t >= DUR) { pauseSession(s); status.textContent = '✓ Parcours terminé !'; s.addTimer(setTimeout(() => s.win(), 250)); }
    }, 28);
  }

  /* ===== Téléchargement : retrouver l'extrait de signal dans le grand signal ===== */
  function signal(s) {
    const W = 360, BH = 90, SH = 56, N = 140, L = 16, TOL = 3;
    const st = s.state;
    if (!st.big) {
      st.big = []; let v = 0.5;
      for (let i = 0; i < N; i++) { v += (Math.random() - 0.5) * 0.4; v = Math.max(0.05, Math.min(0.95, v)); st.big.push(v); }
      st.off = 4 + Math.floor(Math.random() * (N - L - 8));
      st.pos = Math.floor(Math.random() * (N - L)); // position de la fenêtre
      st.lock = 0;
    }
    s.area.innerHTML = `<p class="mg-mini-label">Extrait à localiser</p>
      <canvas class="mg-snip" width="${W}" height="${SH}"></canvas>
      <p class="mg-mini-label">Signal complet — glisse pour aligner</p>
      <canvas class="mg-big" width="${W}" height="${BH}"></canvas>
      <p class="simon-status">Fais coïncider l'extrait avec le signal</p>`;
    const snip = s.area.querySelector('.mg-snip').getContext('2d');
    const bigCv = s.area.querySelector('.mg-big'), big = bigCv.getContext('2d');
    const status = s.area.querySelector('.simon-status');
    const dx = W / N;

    const wave = (ctx, arr, x0, n, w, h, col) => {
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * w; const y = h - arr[x0 + i] * (h - 6) - 3; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke();
    };
    function draw() {
      snip.fillStyle = '#0a0e1c'; snip.fillRect(0, 0, W, SH);
      wave(snip, st.big, st.off, L, W, SH, '#facc15');
      big.fillStyle = '#0a0e1c'; big.fillRect(0, 0, W, BH);
      wave(big, st.big, 0, N, W, BH, '#3b82f6');
      const near = Math.abs(st.pos - st.off) <= TOL;
      big.fillStyle = near ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.12)';
      big.fillRect(st.pos * dx, 0, L * dx, BH);
      big.strokeStyle = near ? '#22c55e' : '#9aa7cc'; big.lineWidth = 2;
      big.strokeRect(st.pos * dx, 1, L * dx, BH - 2);
      status.textContent = near ? '🔒 Verrouillage…' : 'Fais coïncider l\'extrait avec le signal';
    }
    draw();
    s.onResume = draw;

    const setPos = (clientX) => {
      const r = bigCv.getBoundingClientRect();
      const c = (clientX - r.left) * (N / r.width);
      st.pos = Math.max(0, Math.min(N - L, Math.round(c - L / 2)));
      st.lock = 0; draw();
    };
    let dragging = false;
    bigCv.addEventListener('pointerdown', (e) => { dragging = true; setPos(e.clientX); });
    bigCv.addEventListener('pointermove', (e) => { if (dragging) setPos(e.clientX); });
    const up = () => { dragging = false; };
    window.addEventListener('pointerup', up);
    s.cleanups.push(() => window.removeEventListener('pointerup', up));

    s.startLoop((dt) => {
      if (Math.abs(st.pos - st.off) <= TOL) { st.lock += dt; if (st.lock >= 0.7) { pauseSession(s); status.textContent = '✓ Signal capté !'; s.addTimer(setTimeout(() => s.win(), 250)); } }
      else st.lock = 0;
    });
  }

  /* ===== Boucliers : reproduire le motif affiché ===== */
  function pattern(s) {
    const G = 5;
    const st = s.state;
    if (!st.model) {
      st.model = Array(G * G).fill(false);
      const n = 7 + Math.floor(Math.random() * 4);
      while (st.model.filter(Boolean).length < n) st.model[Math.floor(Math.random() * G * G)] = true;
      st.cur = Array(G * G).fill(false);
    }
    s.area.innerHTML = `<div class="pat-wrap">
      <div><p class="mg-mini-label">Modèle</p><div class="pat-grid model"></div></div>
      <div><p class="mg-mini-label">À reproduire</p><div class="pat-grid play"></div></div>
      </div><p class="simon-status">Recopie le motif lumineux</p>`;
    const model = s.area.querySelector('.model'), play = s.area.querySelector('.play');
    const status = s.area.querySelector('.simon-status');
    for (let i = 0; i < G * G; i++) {
      const m = document.createElement('div'); m.className = 'pat-cell' + (st.model[i] ? ' on' : ''); model.appendChild(m);
      const c = document.createElement('div'); c.className = 'pat-cell live' + (st.cur[i] ? ' on' : '');
      c.onclick = () => {
        st.cur[i] = !st.cur[i]; c.classList.toggle('on', st.cur[i]);
        if (st.model.every((v, k) => v === st.cur[k])) { status.textContent = '✓ Boucliers alignés !'; pauseSession(s); s.addTimer(setTimeout(() => s.win(), 300)); }
      };
      play.appendChild(c);
    }
  }

  /* ===== Carburant : stopper la jauge dans la zone verte (3 fois) ===== */
  function fuelGauge(s) {
    const st = s.state;
    if (st.notch == null) { st.notch = 0; st.zone = 0.4 + Math.random() * 0.3; st.speed = 0.5; st.phase = Math.random(); }
    const NEED = 3, ZH = 0.16;
    s.area.innerHTML = `<div class="gauge"><div class="gauge-zone"></div><div class="gauge-needle"></div></div>
      <div class="gauge-side"><div class="gauge-pips"></div><button class="btn primary gauge-stop">⏹ STOP</button></div>`;
    s.area.classList.add('gauge-area');
    const zoneEl = s.area.querySelector('.gauge-zone'), needle = s.area.querySelector('.gauge-needle');
    const pips = s.area.querySelector('.gauge-pips'), stop = s.area.querySelector('.gauge-stop');
    const paintZone = () => { zoneEl.style.bottom = (st.zone * 100) + '%'; zoneEl.style.height = (ZH * 100) + '%'; };
    const paintPips = () => { pips.innerHTML = ''; for (let i = 0; i < NEED; i++) { const d = document.createElement('span'); d.className = 'gpip' + (i < st.notch ? ' on' : ''); pips.appendChild(d); } };
    let y = 0;
    const paintNeedle = () => { needle.style.bottom = (y * 100) + '%'; };
    paintZone(); paintPips();
    s.startLoop((dt) => {
      st.phase += dt * st.speed;
      y = 0.5 + 0.5 * Math.sin(st.phase * Math.PI * 2);
      paintNeedle();
    }, 25);
    stop.onclick = () => {
      if (y >= st.zone && y <= st.zone + ZH) {
        st.notch++; paintPips();
        if (st.notch >= NEED) { pauseSession(s); needle.classList.add('ok'); s.addTimer(setTimeout(() => s.win(), 300)); }
        else { st.zone = 0.12 + Math.random() * 0.62; st.speed += 0.12; paintZone(); needle.classList.add('ok'); s.addTimer(setTimeout(() => needle.classList.remove('ok'), 200)); }
      } else { needle.classList.add('bad'); s.addTimer(setTimeout(() => needle.classList.remove('bad'), 250)); }
    };
  }

  /* ===== Tuyauterie (Navigation/O2) : relier l'entrée à la sortie ===== */
  const PIPES = { // ouvertures par type/rotation : N=1 E=2 S=4 W=8
    I: [[2, 8], [1, 4], [2, 8], [1, 4]],
    L: [[1, 2], [2, 4], [4, 8], [8, 1]],
    T: [[2, 4, 8], [1, 4, 8], [1, 2, 8], [1, 2, 4]]
  };
  const DIRS = { 1: [0, -1], 2: [1, 0], 4: [0, 1], 8: [-1, 0] };
  const OPP = { 1: 4, 2: 8, 4: 1, 8: 2 };
  function pipes(s) {
    const COLS = 5, ROWS = 4, CELL = 62;
    const st = s.state;
    if (!st.grid) {
      st.rin = Math.floor(Math.random() * ROWS); st.rout = Math.floor(Math.random() * ROWS);
      st.grid = []; for (let i = 0; i < COLS * ROWS; i++) st.grid.push({ type: ['I', 'L', 'T'][Math.floor(Math.random() * 3)], rot: Math.floor(Math.random() * 4) });
      // chemin garanti : entrée -> coude -> sortie (en L de Manhattan)
      const path = [];
      let c = 0, r = st.rin;
      const midCol = 1 + Math.floor(Math.random() * (COLS - 2));
      while (c < midCol) { path.push([c, r]); c++; }
      while (r !== st.rout) { path.push([c, r]); r += r < st.rout ? 1 : -1; }
      while (c < COLS) { path.push([c, r]); c++; }
      // pose des pièces le long du chemin
      for (let k = 0; k < path.length; k++) {
        const [cx, cy] = path[k];
        const need = (k > 0 ? OPP[dirBetween(path[k - 1], path[k])] : 8) | (k < path.length - 1 ? dirBetween(path[k], path[k + 1]) : 2);
        st.grid[cy * COLS + cx] = pieceFor(need);
      }
      // brouille les rotations
      for (const g of st.grid) g.rot = Math.floor(Math.random() * 4);
    }
    function dirBetween(a, b) { const dx = b[0] - a[0], dy = b[1] - a[1]; if (dx === 1) return 2; if (dx === -1) return 8; if (dy === 1) return 4; return 1; }
    function pieceFor(mask) { // trouve type/rot dont les ouvertures == mask
      for (const type of ['I', 'L', 'T']) for (let rot = 0; rot < 4; rot++) { const o = PIPES[type][rot].reduce((a, d) => a | d, 0); if (o === mask) return { type, rot }; }
      return { type: 'L', rot: 0 };
    }
    const W = COLS * CELL, H = ROWS * CELL;
    s.area.innerHTML = `<canvas class="pipe-cv" width="${W}" height="${H}"></canvas><p class="simon-status">Tourne les tuyaux : relie ⮕ l'entrée à la sortie</p>`;
    const cv = s.area.querySelector('.pipe-cv'), ctx = cv.getContext('2d'), status = s.area.querySelector('.simon-status');
    const openings = (g) => PIPES[g.type][g.rot];

    function connected() {
      // flood depuis l'entrée (ouest de (0,rin))
      const seen = new Set(); const stack = [];
      const startG = st.grid[st.rin * COLS + 0];
      if (openings(startG).includes(8)) stack.push([0, st.rin]);
      while (stack.length) {
        const [c, r] = stack.pop(); const key = c + ',' + r; if (seen.has(key)) continue; seen.add(key);
        const g = st.grid[r * COLS + c];
        for (const d of openings(g)) {
          const [dx, dy] = DIRS[d]; const nc = c + dx, nr = r + dy;
          if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
          const ng = st.grid[nr * COLS + nc];
          if (openings(ng).includes(OPP[d])) stack.push([nc, nr]);
        }
      }
      return seen;
    }
    function draw() {
      ctx.fillStyle = '#0a0e1c'; ctx.fillRect(0, 0, W, H);
      const live = connected();
      const ok = live.has((COLS - 1) + ',' + st.rout) && openings(st.grid[st.rout * COLS + COLS - 1]).includes(2);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const g = st.grid[r * COLS + c], cx = c * CELL + CELL / 2, cy = r * CELL + CELL / 2;
        ctx.strokeStyle = '#1f2740'; ctx.lineWidth = 1; ctx.strokeRect(c * CELL, r * CELL, CELL, CELL);
        ctx.strokeStyle = live.has(c + ',' + r) ? '#22c55e' : '#6b779c';
        ctx.lineWidth = 9; ctx.lineCap = 'round';
        for (const d of openings(g)) { const [dx, dy] = DIRS[d]; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + dx * CELL / 2, cy + dy * CELL / 2); ctx.stroke(); }
        ctx.fillStyle = '#11162b'; ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
      }
      // marqueurs entrée/sortie
      ctx.fillStyle = '#38bdf8'; ctx.font = 'bold 18px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText('⮕', 10, st.rin * CELL + CELL / 2 + 6);
      ctx.fillStyle = ok ? '#22c55e' : '#38bdf8';
      ctx.fillText('⬛', W - 10, st.rout * CELL + CELL / 2 + 6);
      status.textContent = ok ? '✓ Circuit rétabli !' : 'Tourne les tuyaux pour relier l\'entrée à la sortie';
      if (ok && !st.won) { st.won = true; s.addTimer(setTimeout(() => s.win(), 450)); }
    }
    cv.onclick = (e) => {
      const r = cv.getBoundingClientRect();
      const c = Math.floor((e.clientX - r.left) * (W / r.width) / CELL);
      const row = Math.floor((e.clientY - r.top) * (H / r.height) / CELL);
      if (c < 0 || row < 0 || c >= COLS || row >= ROWS) return;
      const g = st.grid[row * COLS + c]; g.rot = (g.rot + 1) % 4; draw();
    };
    draw();
    s.onResume = draw;
  }

  /* ===== Interrupteurs : trouver la bonne combinaison (déduction) ===== */
  function combo(s) {
    const N = 4;
    const st = s.state;
    if (!st.target) {
      st.target = Array.from({ length: N }, () => Math.random() < 0.5);
      st.cur = Array(N).fill(false);
      st.tries = 0; st.last = -1;
    }
    s.area.innerHTML = `<p class="simon-status" style="margin-bottom:8px">Trouve la seule combinaison qui fonctionne</p>
      <div class="combo-row"></div>
      <button class="btn primary combo-test">⚡ Tester</button>
      <p class="combo-fb"></p>`;
    const row = s.area.querySelector('.combo-row'), test = s.area.querySelector('.combo-test'), fb = s.area.querySelector('.combo-fb');
    function paint() {
      row.innerHTML = '';
      for (let i = 0; i < N; i++) {
        const sw = document.createElement('div'); sw.className = 'switch' + (st.cur[i] ? ' on' : '');
        sw.onclick = () => { st.cur[i] = !st.cur[i]; paint(); };
        const lab = document.createElement('div'); lab.className = 'combo-lab'; lab.textContent = (i + 1);
        const cell = document.createElement('div'); cell.className = 'combo-cell'; cell.appendChild(sw); cell.appendChild(lab);
        row.appendChild(cell);
      }
      fb.textContent = st.last < 0 ? '' : (st.last === N ? '✓ Correct !' : `${st.last}/${N} interrupteurs bien placés — essai ${st.tries}`);
    }
    test.onclick = () => {
      st.tries++;
      st.last = st.cur.reduce((a, v, i) => a + (v === st.target[i] ? 1 : 0), 0);
      paint();
      if (st.last === N) { pauseSession(s); s.addTimer(setTimeout(() => s.win(), 400)); }
    };
    paint();
    s.onResume = paint;
  }

  const builders = {
    wires: (s) => wires(s),
    download: (s) => signal(s),
    scan: (s) => timed(s, 5, 'Analyse en cours…'),
    hold: (s) => fuelGauge(s),
    code: (s) => code(s),
    simon: (s) => simon(s),
    target: (s) => asteroids(s),
    toggle: (s) => pattern(s),
    pipes: (s) => pipes(s),
    switches: (s) => combo(s),
    holdfix: (s) => holdFill(s, 3, 'Maintenir pour réparer')
  };

  return { open, close };
})();
