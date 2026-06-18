'use strict';
/*
 * Mini-jeux des missions et des réparations.
 * MiniGames.open(type, title, sub) -> Promise<boolean> (true = réussi, false = annulé)
 */
window.MiniGames = (() => {
  let activeResolve = null;
  let timers = [];
  let cleanups = [];

  function overlay() { return $('overlay-minigame'); }
  function box() { return $('mg-box'); }

  function close(result) {
    timers.forEach(clearInterval);
    timers = [];
    cleanups.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
    cleanups = [];
    overlay().classList.add('hidden');
    box().innerHTML = '';
    App.overlayOpen = false;
    if (activeResolve) { const r = activeResolve; activeResolve = null; r(result); }
  }

  function frame(title, sub) {
    box().innerHTML = `
      <div class="mg-title">${escapeHtml(title)}</div>
      <div class="mg-sub">${escapeHtml(sub || '')}</div>
      <div class="mg-area"></div>
      <button class="btn mg-cancel">Annuler</button>`;
    box().querySelector('.mg-cancel').onclick = () => close(false);
    return box().querySelector('.mg-area');
  }

  /* ---- Câbles ---- */
  function wires(area) {
    const colors = ['#ff4757', '#2563eb', '#facc15', '#ec4899'];
    const right = colors.slice();
    for (let i = right.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [right[i], right[j]] = [right[j], right[i]];
    }
    area.innerHTML = `
      <div class="wire-area">
        <svg class="wire-svg"></svg>
        <div class="wire-col left"></div>
        <div class="wire-col right"></div>
      </div>`;
    const wa = area.querySelector('.wire-area');
    const svg = area.querySelector('.wire-svg');
    const colL = area.querySelector('.left');
    const colR = area.querySelector('.right');
    colors.forEach((c) => {
      const n = document.createElement('button');
      n.className = 'wire-node'; n.style.background = c; n.dataset.c = c;
      colL.appendChild(n);
    });
    right.forEach((c) => {
      const n = document.createElement('button');
      n.className = 'wire-node'; n.style.background = c; n.dataset.c = c;
      colR.appendChild(n);
    });
    let sel = null, done = 0;
    function center(el) {
      const r = el.getBoundingClientRect(), w = wa.getBoundingClientRect();
      return { x: r.left - w.left + r.width / 2, y: r.top - w.top + r.height / 2 };
    }
    colL.querySelectorAll('.wire-node').forEach((n) => {
      n.onclick = () => {
        if (n.classList.contains('done')) return;
        colL.querySelectorAll('.wire-node').forEach((m) => m.classList.remove('sel'));
        n.classList.add('sel'); sel = n;
      };
    });
    colR.querySelectorAll('.wire-node').forEach((n) => {
      n.onclick = () => {
        if (!sel || n.classList.contains('done')) return;
        if (n.dataset.c === sel.dataset.c) {
          const a = center(sel), b = center(n);
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
          line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
          line.setAttribute('stroke', n.dataset.c); line.setAttribute('stroke-width', '6');
          line.setAttribute('stroke-linecap', 'round');
          svg.appendChild(line);
          sel.classList.add('done'); sel.classList.remove('sel');
          n.classList.add('done'); sel = null;
          if (++done === colors.length) setTimeout(() => close(true), 350);
        } else {
          sel.classList.remove('sel'); sel = null;
          wa.classList.add('shake'); setTimeout(() => wa.classList.remove('shake'), 350);
        }
      };
    });
  }

  /* ---- Barre de progression automatique (scan / téléchargement) ---- */
  function timed(area, secs, label) {
    area.innerHTML = `<p style="text-align:center;color:#9fb4e8">${escapeHtml(label)}</p>
      <div class="mg-progress"><div></div></div>
      <p class="simon-status">0%</p>`;
    const bar = area.querySelector('.mg-progress > div');
    const status = area.querySelector('.simon-status');
    const t0 = performance.now();
    const iv = setInterval(() => {
      const pct = Math.min(1, (performance.now() - t0) / (secs * 1000));
      bar.style.width = (pct * 100) + '%';
      status.textContent = Math.round(pct * 100) + '%';
      if (pct >= 1) { clearInterval(iv); setTimeout(() => close(true), 250); }
    }, 80);
    timers.push(iv);
  }

  /* ---- Maintenir un bouton ---- */
  function hold(area, secs, label) {
    area.innerHTML = `<div class="mg-progress"><div></div></div>
      <button class="btn primary mg-hold-btn">✋ ${escapeHtml(label)}</button>`;
    const bar = area.querySelector('.mg-progress > div');
    const btn = area.querySelector('.mg-hold-btn');
    let p = 0, holding = false, lastT = performance.now();
    const iv = setInterval(() => {
      const now = performance.now(), dt = (now - lastT) / 1000; lastT = now;
      p += holding ? dt / secs : -dt / (secs * 2);
      p = Math.max(0, Math.min(1, p));
      bar.style.width = (p * 100) + '%';
      if (p >= 1) { clearInterval(iv); setTimeout(() => close(true), 200); }
    }, 60);
    timers.push(iv);
    const on = (e) => { e.preventDefault(); holding = true; };
    const off = () => { holding = false; };
    btn.addEventListener('pointerdown', on);
    window.addEventListener('pointerup', off);
    window.addEventListener('pointercancel', off);
    cleanups.push(() => {
      window.removeEventListener('pointerup', off);
      window.removeEventListener('pointercancel', off);
    });
  }

  /* ---- Code à recopier ---- */
  function code(area) {
    const target = String(Math.floor(10000 + Math.random() * 90000));
    area.innerHTML = `
      <div class="kp-code">Code : ${target}</div>
      <div class="kp-display"></div>
      <div class="kp-grid"></div>`;
    const disp = area.querySelector('.kp-display');
    const grid = area.querySelector('.kp-grid');
    let input = '';
    const keys = ['1','2','3','4','5','6','7','8','9','C','0','OK'];
    keys.forEach((k) => {
      const b = document.createElement('button');
      b.className = 'btn'; b.textContent = k;
      b.onclick = () => {
        if (k === 'C') input = '';
        else if (k === 'OK') {
          if (input === target) { disp.style.color = '#4ade80'; setTimeout(() => close(true), 300); }
          else { input = ''; disp.classList.add('shake'); setTimeout(() => disp.classList.remove('shake'), 350); }
        } else if (input.length < 5) input += k;
        disp.textContent = input;
      };
      grid.appendChild(b);
    });
  }

  /* ---- Simon ---- */
  function simon(area) {
    const cols = ['#ff4757', '#2563eb', '#22c55e', '#facc15'];
    area.innerHTML = `<div class="simon-grid"></div><div class="simon-status">Observe la séquence…</div>`;
    const grid = area.querySelector('.simon-grid');
    const status = area.querySelector('.simon-status');
    const btns = cols.map((c, i) => {
      const b = document.createElement('button');
      b.className = 'simon-btn'; b.style.background = c; b.style.color = c;
      b.dataset.i = i; grid.appendChild(b);
      return b;
    });
    const seq = Array.from({ length: 4 }, () => Math.floor(Math.random() * 4));
    let idx = 0, accepting = false;
    function flash(i, d) {
      setTimeout(() => {
        btns[i].classList.add('lit');
        setTimeout(() => btns[i].classList.remove('lit'), 380);
      }, d);
    }
    function playSeq() {
      accepting = false; idx = 0;
      status.textContent = 'Observe la séquence…';
      seq.forEach((s, k) => flash(s, 600 + k * 600));
      setTimeout(() => { accepting = true; status.textContent = 'À toi de jouer !'; }, 600 + seq.length * 600);
    }
    btns.forEach((b) => {
      b.onclick = () => {
        if (!accepting) return;
        const i = Number(b.dataset.i);
        b.classList.add('lit'); setTimeout(() => b.classList.remove('lit'), 200);
        if (i === seq[idx]) {
          if (++idx === seq.length) { status.textContent = '✓ Calibré !'; setTimeout(() => close(true), 400); }
        } else { status.textContent = '✗ Erreur, on recommence'; setTimeout(playSeq, 700); }
      };
    });
    playSeq();
  }

  /* ---- Astéroïdes (cibles) ---- */
  function target(area) {
    area.innerHTML = `<div class="target-area"></div><div class="simon-status">Astéroïdes restants : 8</div>`;
    const ta = area.querySelector('.target-area');
    const status = area.querySelector('.simon-status');
    let left = 8;
    function spawn() {
      const d = document.createElement('button');
      d.className = 'target-dot';
      d.style.left = (10 + Math.random() * 75) + '%';
      d.style.top = (5 + Math.random() * 75) + '%';
      d.onclick = () => {
        d.remove();
        if (--left <= 0) { status.textContent = '✓ Zone dégagée !'; setTimeout(() => close(true), 350); }
        else { status.textContent = 'Astéroïdes restants : ' + left; spawn(); }
      };
      ta.appendChild(d);
    }
    spawn();
  }

  /* ---- Hexagones (boucliers) ---- */
  function toggle(area) {
    area.innerHTML = `<div class="hex-grid"></div>`;
    const grid = area.querySelector('.hex-grid');
    let on = 0;
    for (let i = 0; i < 6; i++) {
      const b = document.createElement('button');
      b.className = 'hex-btn'; b.textContent = '⬡';
      b.onclick = () => {
        if (b.classList.contains('on')) return;
        b.classList.add('on');
        if (++on === 6) setTimeout(() => close(true), 350);
      };
      grid.appendChild(b);
    }
  }

  /* ---- Interrupteurs (réparation lumières) ---- */
  function switches(area) {
    area.innerHTML = `<div class="switch-row"></div>`;
    const row = area.querySelector('.switch-row');
    let onCount = 0;
    for (let i = 0; i < 5; i++) {
      const s = document.createElement('div');
      s.className = 'switch';
      s.onclick = () => {
        if (s.classList.contains('on')) return;
        s.classList.add('on');
        if (++onCount === 5) setTimeout(() => close(true), 350);
      };
      row.appendChild(s);
    }
  }

  const builders = {
    wires: (a) => wires(a),
    download: (a) => timed(a, 4, 'Transfert des données en cours…'),
    scan: (a) => timed(a, 5, 'Analyse biométrique en cours…'),
    hold: (a) => hold(a, 3.5, 'Maintenir pour remplir'),
    code: (a) => code(a),
    simon: (a) => simon(a),
    target: (a) => target(a),
    toggle: (a) => toggle(a),
    switches: (a) => switches(a),
    holdfix: (a) => hold(a, 3, 'Maintenir pour réparer')
  };

  function open(type, title, sub) {
    return new Promise((resolve) => {
      if (activeResolve) { resolve(false); return; }
      activeResolve = resolve;
      App.overlayOpen = true;
      overlay().classList.remove('hidden');
      const area = frame(title, sub);
      (builders[type] || builders.download)(area);
    });
  }

  return { open, close };
})();
