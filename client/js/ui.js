'use strict';
/* Interface : écrans, salon, chat, réunions, carte, choix de sabotage, HUD. */
window.UI = (() => {

  let chatChannel = 'global';
  let meetingTimerIv = null;
  let sabBannerIv = null;

  // Réglages numériques modifiables par l'hôte (discussTime = durée de réunion unique)
  const SETTINGS_KEYS = ['impostors', 'killCooldown', 'discussTime', 'tasksPerPlayer',
    'emergencies', 'engineers', 'scientists', 'metamorphs', 'jesters'];

  /* ---------------- Écrans ---------------- */
  function show(name) {
    for (const s of ['home', 'lobby', 'game', 'end']) {
      $('screen-' + s).classList.toggle('hidden', s !== name);
    }
  }

  /* ---------------- Lobby ---------------- */
  function refreshLobby() {
    if (!App.code) return;
    $('lobby-code').textContent = App.code;
    const ps = [...App.players.values()];
    $('lobby-count').textContent = `(${ps.length}/${SHARED.MAX_PLAYERS})`;

    const grid = $('lobby-players');
    grid.innerHTML = '';
    for (const p of ps) {
      const el = document.createElement('div');
      el.className = 'player-chip' + (p.id === App.hostId ? ' host' : '') + (p.connected ? '' : ' off');
      el.innerHTML = `<span class="dot" style="background:${SHARED.COLORS[p.color]}"></span>
        <span>${p.isBot ? '🤖 ' : ''}${escapeHtml(p.name)}${p.id === App.you ? ' (toi)' : ''}</span>`;
      grid.appendChild(el);
    }

    const picker = $('color-picker');
    picker.innerHTML = '';
    const me = App.me();
    const taken = new Set(ps.filter((p) => p.id !== App.you).map((p) => p.color));
    SHARED.COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'color-swatch' + (me && me.color === i ? ' mine' : '') + (taken.has(i) ? ' taken' : '');
      b.style.background = c;
      b.title = SHARED.COLOR_NAMES[i];
      b.onclick = () => { if (!taken.has(i)) App.socket.emit('room:color', { color: i }); };
      picker.appendChild(b);
    });

    // Paramètres
    const host = App.isHost();
    $('settings-who').textContent = host ? '(tu es l’hôte)' : '(réservé à l’hôte)';
    if (App.settings) {
      for (const key of SETTINGS_KEYS) {
        const input = $('set-' + key);
        if (document.activeElement !== input) input.value = App.settings[key];
        input.disabled = !host;
      }
      $('set-confirmEjects').checked = App.settings.confirmEjects;
      $('set-confirmEjects').disabled = !host;
    }

    $('btn-start').classList.toggle('hidden', !host);
    $('btn-addbot').classList.toggle('hidden', !host);
    $('btn-rembot').classList.toggle('hidden', !host || !ps.some((p) => p.isBot));
    const n = ps.length;
    $('btn-start').disabled = n < SHARED.MIN_PLAYERS;
    $('lobby-status').textContent = n < SHARED.MIN_PLAYERS
      ? `En attente de joueurs… (minimum ${SHARED.MIN_PLAYERS})`
      : host ? 'Prêt à lancer !' : `En attente du lancement par l'hôte…`;
  }

  function sendSettings() {
    if (!App.isHost()) return;
    const settings = { confirmEjects: $('set-confirmEjects').checked };
    for (const key of SETTINGS_KEYS) settings[key] = +$('set-' + key).value;
    App.socket.emit('room:settings', { settings });
  }

  /* ---------------- Chat ---------------- */
  function chatAdd(msg) {
    const log = $('chat-log');
    const el = document.createElement('div');
    el.className = 'msg' + (msg.channel === 'imp' ? ' imp' : '');
    const prefix = msg.channel === 'imp' ? '☠ ' : '';
    el.innerHTML = `<b style="color:${SHARED.COLORS[msg.color]}">${prefix}${escapeHtml(msg.name)}</b>${escapeHtml(msg.text)}`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    if ($('chat').classList.contains('collapsed') && msg.from !== App.you) {
      App.unread++;
      const badge = $('chat-badge');
      badge.textContent = App.unread > 9 ? '9+' : App.unread;
      badge.classList.remove('hidden');
      Sfx.chat();
    }
  }

  function chatSys(text) {
    const log = $('chat-log');
    const el = document.createElement('div');
    el.className = 'msg sys';
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }

  function setChatChannel(ch) {
    chatChannel = ch;
    document.querySelectorAll('.chat-tab').forEach((t) => t.classList.toggle('active', t.dataset.ch === ch));
    $('chat-input').placeholder = ch === 'imp' ? 'Message aux saboteurs…' : 'Message…';
  }

  function updateChatAccess() {
    const input = $('chat-input');
    const deadInGame = App.inGame() && !App.alive;
    input.disabled = deadInGame;
    input.placeholder = deadInGame ? 'Les éliminés ne peuvent plus écrire'
      : chatChannel === 'imp' ? 'Message aux saboteurs…' : 'Message…';
    $('tab-imp').classList.toggle('hidden', App.role !== 'impostor');
  }

  function toggleChat(forceOpen) {
    const c = $('chat');
    const open = forceOpen === true || c.classList.contains('collapsed');
    c.classList.toggle('collapsed', !open);
    if (open) {
      App.unread = 0;
      $('chat-badge').classList.add('hidden');
      $('chat-log').scrollTop = $('chat-log').scrollHeight;
    }
  }

  /* ---------------- HUD missions ---------------- */
  function refreshTasks() {
    const list = $('task-list');
    list.innerHTML = '';
    $('tasks-title').textContent = App.role === 'impostor' ? 'Missions (couverture)' : 'Missions';
    const commsDown = App.sab && App.sab.type === 'comms' && App.role !== 'impostor';
    if (commsDown) {
      const li = document.createElement('li');
      li.className = 'fake';
      li.textContent = '📡 Communications coupées…';
      list.appendChild(li);
      return;
    }
    for (const t of App.tasks) {
      const def = SHARED.TASKS.find((d) => d.id === t.id);
      if (!def) continue;
      const li = document.createElement('li');
      li.className = t.done ? 'done' : '';
      li.textContent = `${def.room} : ${def.name}`;
      list.appendChild(li);
    }
    if (App.role === 'impostor') {
      const li = document.createElement('li');
      li.className = 'fake';
      li.textContent = '☠ Fais semblant. Élimine. Mens.';
      list.appendChild(li);
    }
  }

  function setProgress(pct) {
    $('progress-bar').style.width = Math.round(pct * 100) + '%';
  }

  /* ---------------- Bannières ---------------- */
  const ROLE_SUB = {
    impostor: 'Élimine les équipiers sans te faire repérer. Utilise les conduits pour disparaître.',
    crew: 'Accomplis tes missions et démasque les saboteurs.',
    engineer: 'Équipier — tu peux emprunter les conduits comme un saboteur. Pratique… et suspect si on te voit.',
    scientist: 'Équipier — consulte les constantes vitales pour savoir qui est encore en vie.',
    metamorph: 'Saboteur — prends l’apparence d’un joueur pour brouiller les accusations. Tue, sabote, mens.',
    jester: 'Camp solo — ton seul but : te faire éjecter en réunion. Sois louche… mais pas trop !'
  };
  const ROLE_TITLE = {
    impostor: 'SABOTEUR', crew: 'ÉQUIPIER', engineer: 'INGÉNIEUR', scientist: 'SCIENTIFIQUE',
    metamorph: 'MÉTAMORPHE', jester: 'BOUFFON'
  };

  function roleBanner() {
    const b = $('role-banner');
    const team = SHARED.ROLES[App.role] ? SHARED.ROLES[App.role].team : 'crew';
    b.className = team === 'impostor' ? 'impostor' : (team === 'neutral' ? 'jester' : 'crew');
    let sub = ROLE_SUB[App.role] || ROLE_SUB.crew;
    if (App.isImpostor() && App.partners.length > 1) {
      const others = App.partners.filter((p) => p.id !== App.you).map((p) => p.name).join(', ');
      sub += ` Complice(s) : ${others}`;
    }
    b.innerHTML = `${ROLE_TITLE[App.role] || 'ÉQUIPIER'}<small>${escapeHtml(sub)}</small>`;
    b.classList.remove('hidden');
    b.style.opacity = '1';
    setTimeout(() => { b.style.opacity = '0'; }, 3500);
    setTimeout(() => b.classList.add('hidden'), 4500);
  }

  /* ---------------- Contrôles de rôle (conduit / constantes / métamorphose) ---------------- */
  function updateRoleControls() {
    $('b-vent').classList.toggle('hidden', !App.canVent());
    $('b-vitals').classList.toggle('hidden', !(App.isScientist() && App.alive));
    $('b-shift').classList.toggle('hidden', !(App.isMetamorph() && App.alive));
  }

  /* ---------------- Sélecteur de métamorphose ---------------- */
  function openShiftPicker() {
    if (!App.isMetamorph() || !App.alive) return;
    if (Date.now() < App.shiftReadyAt) { toast('Métamorphose en recharge'); return; }
    const list = $('shift-list');
    list.innerHTML = '';
    for (const p of App.players.values()) {
      if (p.id === App.you || !p.alive || !p.connected) continue;
      const el = document.createElement('button');
      el.className = 'btn shift-opt';
      el.innerHTML = `<span class="dot" style="background:${SHARED.COLORS[p.color]}"></span> ${escapeHtml(p.name)}`;
      el.onclick = () => {
        App.socket.emit('shift', { targetId: p.id }, (res) => { if (res && !res.ok) toast('Métamorphose impossible'); });
        closeShiftPicker();
      };
      list.appendChild(el);
    }
    App.overlayOpen = true;
    $('overlay-shift').classList.remove('hidden');
  }
  function closeShiftPicker() {
    $('overlay-shift').classList.add('hidden');
    if ($('overlay-minigame').classList.contains('hidden') &&
        $('overlay-map').classList.contains('hidden')) App.overlayOpen = false;
  }

  function showVentControls() {
    const wrap = $('vent-controls');
    const arrows = $('vent-arrows');
    arrows.innerHTML = '';
    const cur = App.ventNet.find((v) => v.id === App.inVent);
    for (const v of App.ventNet) {
      if (v.id === App.inVent) continue;
      const btn = document.createElement('button');
      btn.className = 'btn vent-arrow';
      // flèche directionnelle vers le conduit cible
      let arrow = '→';
      if (cur) {
        const dx = v.x - cur.x, dy = v.y - cur.y;
        arrow = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? '➡' : '⬅') : (dy > 0 ? '⬇' : '⬆');
      }
      const room = SHARED.roomAt(v.x, v.y);
      btn.innerHTML = `${arrow} <span>${room ? escapeHtml(room.name) : 'Conduit'}</span>`;
      btn.onclick = () => App.socket.emit('vent:move', { ventId: v.id });
      arrows.appendChild(btn);
    }
    wrap.classList.remove('hidden');
  }

  function hideVentControls() {
    $('vent-controls').classList.add('hidden');
  }

  /* ---------------- Constantes vitales (Scientifique) ---------------- */
  let vitalsIv = null;
  function openVitals() {
    if (!App.isScientist() || !App.alive) return;
    const now = Date.now();
    if (now < App.vitalsReadyAt) {
      toast(`Constantes en recharge (${Math.ceil((App.vitalsReadyAt - now) / 1000)}s)`);
      return;
    }
    App.vitalsUntil = now + SHARED.VITALS_DURATION * 1000;
    App.vitalsReadyAt = App.vitalsUntil + SHARED.VITALS_COOLDOWN * 1000;
    App.overlayOpen = true;
    $('overlay-vitals').classList.remove('hidden');
    renderVitals();
    clearInterval(vitalsIv);
    vitalsIv = setInterval(() => {
      if (Date.now() >= App.vitalsUntil) { closeVitals(); return; }
      renderVitals();
    }, 500);
  }
  function renderVitals() {
    const list = $('vitals-list');
    list.innerHTML = '';
    const remain = Math.max(0, Math.ceil((App.vitalsUntil - Date.now()) / 1000));
    for (const p of App.players.values()) {
      if (!p.connected && p.isBot !== true && App.phase === 'play') { /* garde quand même */ }
      const el = document.createElement('div');
      el.className = 'vital-row ' + (p.alive ? 'alive' : 'dead');
      el.innerHTML = `<span class="dot" style="background:${SHARED.COLORS[p.color]}"></span>
        <span class="vname">${escapeHtml(p.name)}</span>
        <span class="vstatus">${p.alive ? '💚 En vie' : '💀 Mort'}</span>`;
      list.appendChild(el);
    }
    $('overlay-vitals').querySelector('h3').textContent = `🩺 Constantes vitales (${remain}s)`;
  }
  function closeVitals() {
    clearInterval(vitalsIv);
    $('overlay-vitals').classList.add('hidden');
    if ($('overlay-minigame').classList.contains('hidden') &&
        $('overlay-map').classList.contains('hidden')) App.overlayOpen = false;
  }

  function refreshSabBanner() {
    clearInterval(sabBannerIv);
    const b = $('sab-banner');
    if (!App.sab) { b.classList.add('hidden'); return; }
    const def = SHARED.SABOTAGES[App.sab.type];
    b.classList.remove('hidden');
    const render = () => {
      let txt = `⚠️ SABOTAGE : ${def.name} — ${def.desc}`;
      if (App.sab && App.sab.endsAt) {
        const s = Math.max(0, Math.ceil((App.sab.endsAt - Date.now()) / 1000));
        txt += ` (${s}s)`;
        if (s <= 10) Sfx.alarm();
      }
      b.textContent = txt;
    };
    render();
    sabBannerIv = setInterval(() => {
      if (!App.sab || App.phase !== 'play') { clearInterval(sabBannerIv); return; }
      render();
    }, 1000);
  }

  /* ---------------- Réunion ---------------- */
  function meetingOpen(data) {
    MiniGames.close(false);
    closeMap();
    closeSabPicker();
    App.mode = 'play';
    $('cams-hud').classList.add('hidden');
    Sfx.meeting();

    App.meeting = {
      stage: data.stage || 'open',
      endsAt: data.endsAt,
      voted: new Set(data.voted || []),
      myVote: data.myVote || null,
      deadIds: new Set(data.deadIds || [])
    };
    $('overlay-meeting').classList.remove('hidden');
    // Intègre le chat au panneau de réunion (sinon l'overlay bloque la saisie)
    $('meeting-chat-slot').appendChild($('chat'));
    $('chat').classList.add('in-meeting');
    $('chat-toggle').classList.add('hidden');
    $('meeting-result').classList.add('hidden');
    $('meeting-result').innerHTML = '';
    $('meeting-title').textContent = data.bodyOf ? '🚨 Un corps a été signalé !' : '📢 Réunion d’urgence !';
    const reporterName = data.reporter ? data.reporter.name : '';
    const victim = data.bodyOf ? App.players.get(data.bodyOf) : null;
    $('meeting-sub').textContent = data.bodyOf
      ? `${reporterName} a trouvé le corps de ${victim ? victim.name : '???'}.`
      : `${reporterName} a appuyé sur le bouton d'urgence.`;
    renderMeetingPlayers();
    runMeetingTimer();
    toggleChat(true);
  }

  function renderMeetingPlayers(counts) {
    const m = App.meeting;
    if (!m) return;
    const wrap = $('meeting-players');
    wrap.innerHTML = '';
    const canVote = m.stage === 'open' && App.alive; // vote ouvert et modifiable
    for (const p of App.players.values()) {
      const dead = m.deadIds.has(p.id) || !p.alive;
      const el = document.createElement('div');
      el.className = 'vote-card' + (dead ? ' dead' : '') +
        (!dead && canVote ? ' votable' : '') +
        (m.myVote === p.id ? ' selected' : '');
      el.innerHTML = `<span class="dot" style="background:${SHARED.COLORS[p.color]}"></span>
        <span>${escapeHtml(p.name)}${p.id === App.you ? ' (toi)' : ''}</span>`;
      if (counts && counts[p.id]) {
        el.innerHTML += `<span class="count-badge">${counts[p.id]}</span>`;
      } else if (m.myVote === p.id) {
        el.innerHTML += `<span class="voted-badge">★ ton vote</span>`;
      } else if (m.voted.has(p.id) && !dead) {
        el.innerHTML += `<span class="voted-badge">✓ a voté</span>`;
      }
      if (!dead && canVote) {
        el.style.cursor = 'pointer';
        el.onclick = () => {
          m.myVote = p.id;
          App.socket.emit('meeting:vote', { target: p.id });
          renderMeetingPlayers();
        };
      }
      wrap.appendChild(el);
    }
    const skip = $('btn-skip');
    skip.disabled = !canVote;
    skip.classList.toggle('selected', m.myVote === 'skip');
    skip.textContent = m.myVote === 'skip' ? '★ Abstention choisie' : '🤐 S\'abstenir';
  }

  function runMeetingTimer() {
    clearInterval(meetingTimerIv);
    const el = $('meeting-timer');
    const tick = () => {
      const m = App.meeting;
      if (!m) { clearInterval(meetingTimerIv); return; }
      const s = Math.max(0, Math.ceil((m.endsAt - Date.now()) / 1000));
      if (m.stage === 'reveal') { el.textContent = `Résultats — ${s}s`; return; }
      el.textContent = `🗳️ Débat & vote — ${s}s`;
      el.classList.toggle('urgent', s <= 10);
    };
    tick();
    meetingTimerIv = setInterval(tick, 250);
  }

  function meetingVotes(data) {
    if (!App.meeting) return;
    App.meeting.voted = new Set(data.voted);
    renderMeetingPlayers();
  }

  function meetingResult(data) {
    if (!App.meeting) return;
    App.meeting.stage = 'reveal';
    App.meeting.endsAt = Date.now() + 6500;
    renderMeetingPlayers(data.counts);
    const r = $('meeting-result');
    r.classList.remove('hidden');
    if (data.ejected) {
      const p = App.players.get(data.ejected);
      const name = p ? p.name : '???';
      let txt = `🚀 ${name} a été éjecté·e dans l'espace.`;
      if (data.jester) txt += ' 🃏 C\'était le Bouffon… il gagne !';
      else if (data.wasImpostor === true) txt += ' C\'était un saboteur ! ☠';
      else if (data.wasImpostor === false) txt += ' Ce n\'était PAS un saboteur…';
      r.textContent = txt;
      if (p) { p.alive = false; App.meeting.deadIds.add(p.id); }
      if (data.ejected === App.you) { App.alive = false; updateChatAccess(); $('ghost-banner').classList.remove('hidden'); }
      Sfx.eject();
    } else {
      r.textContent = '🤝 Personne n\'a été éjecté (égalité ou abstention).';
    }
    runMeetingTimer();
  }

  function meetingClose() {
    clearInterval(meetingTimerIv);
    App.meeting = null;
    $('overlay-meeting').classList.add('hidden');
    // Remet le chat à sa place dans le HUD
    if ($('chat').parentElement === $('meeting-chat-slot')) {
      $('hud').appendChild($('chat'));
    }
    $('chat').classList.remove('in-meeting');
    $('chat-toggle').classList.remove('hidden');
  }

  /* ---------------- Carte ---------------- */
  function openMap() {
    App.overlayOpen = true;
    $('overlay-map').classList.remove('hidden');
    $('map-hint').textContent = (App.alive && App.phase === 'play')
      ? 'Clique pour marquer un événement suspect (visible par tous)'
      : 'Carte du vaisseau';
    drawMap();
  }
  function closeMap() {
    $('overlay-map').classList.add('hidden');
    if (!$('overlay-minigame').classList.contains('hidden')) return;
    App.overlayOpen = false;
  }

  function drawMap() {
    const cv = $('map-cv');
    const ctx = cv.getContext('2d');
    const sc = cv.width / SHARED.WORLD.w; // 960/2400 = 0.4
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#0a0e1c';
    ctx.fillRect(0, 0, cv.width, cv.height);

    for (const c of SHARED.CORRIDORS) {
      ctx.fillStyle = '#1d2540';
      ctx.fillRect(c.x * sc, c.y * sc, c.w * sc, c.h * sc);
    }
    for (const r of SHARED.ROOMS) {
      ctx.fillStyle = '#252f52';
      ctx.fillRect(r.x * sc, r.y * sc, r.w * sc, r.h * sc);
      ctx.strokeStyle = '#3a4670';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x * sc, r.y * sc, r.w * sc, r.h * sc);
      ctx.fillStyle = '#9fb4e8';
      ctx.font = 'bold 13px Segoe UI';
      ctx.textAlign = 'center';
      ctx.fillText(r.name, (r.x + r.w / 2) * sc, (r.y + 24) * sc + 6);
    }
    // Marqueurs
    for (const m of App.markers) {
      ctx.font = '22px serif';
      ctx.textAlign = 'center';
      ctx.fillText('⚠️', m.x * sc, m.y * sc + 8);
      ctx.fillStyle = SHARED.COLORS[m.color];
      ctx.font = 'bold 11px Segoe UI';
      ctx.fillText(m.name, m.x * sc, m.y * sc + 22);
    }
    // Les fantômes et la salle caméras voient tout le monde
    const seeAll = !App.alive || App.mode === 'cams';
    if (seeAll) {
      for (const p of App.players.values()) {
        if (p.id === App.you || !p.alive) continue;
        ctx.fillStyle = SHARED.COLORS[p.color];
        ctx.beginPath();
        ctx.arc(p.x * sc, p.y * sc, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Toi
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(App.pos.x * sc, App.pos.y * sc, 9, 0, Math.PI * 2);
    ctx.fill();
    const me = App.me();
    if (me) {
      ctx.fillStyle = SHARED.COLORS[me.color];
      ctx.beginPath();
      ctx.arc(App.pos.x * sc, App.pos.y * sc, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ---------------- Sabotage ---------------- */
  function openSabPicker() {
    App.overlayOpen = true;
    $('overlay-sab').classList.remove('hidden');
  }
  function closeSabPicker() {
    $('overlay-sab').classList.add('hidden');
    if (!$('overlay-minigame').classList.contains('hidden')) return;
    if (!$('overlay-map').classList.contains('hidden')) return;
    App.overlayOpen = false;
  }

  /* ---------------- Fin ---------------- */
  function endScreen(data) {
    meetingClose();
    MiniGames.close(false);
    closeMap();
    closeSabPicker();
    show('end');
    const titles = {
      crew: '🛠️ VICTOIRE DES ÉQUIPIERS',
      impostors: '☠ VICTOIRE DES SABOTEURS',
      jester: '🃏 VICTOIRE DU BOUFFON'
    };
    $('end-title').textContent = titles[data.winner] || titles.impostors;
    $('end-title').className = data.winner;
    $('end-reason').textContent = data.reason;
    const roles = $('end-roles');
    roles.innerHTML = '';
    for (const r of data.roles) {
      const def = SHARED.ROLES[r.role] || SHARED.ROLES.crew;
      const cls = def.team === 'impostor' ? 'imp' : (def.team === 'neutral' ? 'neutral' : '');
      const el = document.createElement('div');
      el.className = 'r';
      el.innerHTML = `<span class="dot" style="background:${SHARED.COLORS[r.color]}"></span>
        <span class="${cls}">${escapeHtml(r.name)} — ${def.emoji} ${def.name}</span>`;
      roles.appendChild(el);
    }
    $('btn-again').classList.toggle('hidden', !App.isHost());
    $('end-wait').classList.toggle('hidden', App.isHost());
  }

  /* ---------------- Événements DOM ---------------- */
  function initEvents() {
    // Accueil
    $('btn-create').onclick = () => {
      Sfx.unlock();
      const name = $('home-name').value.trim();
      if (!name) { toast('Choisis un pseudo !'); $('home-name').focus(); return; }
      Net.create(name);
    };
    $('btn-join').onclick = () => {
      Sfx.unlock();
      const name = $('home-name').value.trim();
      const code = $('home-code').value.trim().toUpperCase();
      if (!name) { toast('Choisis un pseudo !'); $('home-name').focus(); return; }
      if (code.length !== 4) { toast('Code de salon invalide (4 lettres)'); return; }
      Net.join(code, name);
    };
    $('home-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
    $('home-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') ($('home-code').value ? $('btn-join') : $('btn-create')).click();
    });

    // Lobby
    $('btn-copy').onclick = async () => {
      const url = `${location.origin}/?room=${App.code}`;
      try { await navigator.clipboard.writeText(url); toast('Lien copié ! Partage-le à tes amis 🚀'); }
      catch (e) { prompt('Copie ce lien :', url); }
    };
    $('btn-start').onclick = () => {
      App.socket.emit('game:start', {}, (res) => {
        if (res && !res.ok) toast(res.error || 'Impossible de lancer.');
      });
    };
    $('btn-leave').onclick = () => Net.leave();
    $('btn-lobby-mic').onclick = () => Voice.toggleMic();
    $('btn-addbot').onclick = () => App.socket.emit('room:addBot');
    $('btn-rembot').onclick = () => App.socket.emit('room:removeBot');
    for (const key of SETTINGS_KEYS) {
      $('set-' + key).addEventListener('change', sendSettings);
    }
    $('set-confirmEjects').addEventListener('change', sendSettings);

    // Chat
    $('chat-toggle').onclick = () => toggleChat();
    $('chat-min').onclick = () => toggleChat();
    document.querySelectorAll('.chat-tab').forEach((t) => {
      t.onclick = () => setChatChannel(t.dataset.ch);
    });
    $('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('chat-input');
      const text = input.value.trim();
      if (!text) return;
      App.socket.emit('chat', { text, channel: chatChannel });
      input.value = '';
    });
    // Évite que taper dans le chat fasse bouger le perso
    $('chat-input').addEventListener('keydown', (e) => e.stopPropagation());

    // Boutons d'action (gérés par game.js via Actions)
    $('b-use').onclick = () => Actions.use();
    $('b-report').onclick = () => Actions.report();
    $('b-kill').onclick = () => Actions.kill();
    $('b-sab').onclick = () => { if (!$('b-sab').disabled) openSabPicker(); };
    $('b-vent').onclick = () => Actions.vent();
    $('b-vitals').onclick = () => openVitals();
    $('b-shift').onclick = () => {
      if (App.disguises.has(App.you)) App.socket.emit('shift:revert');
      else openShiftPicker();
    };
    $('vent-exit').onclick = () => App.socket.emit('vent:exit');
    $('vitals-close').onclick = () => closeVitals();
    $('shift-cancel').onclick = () => closeShiftPicker();
    $('b-map').onclick = () => openMap();
    $('b-mic').onclick = () => Voice.toggleMic();
    $('map-close').onclick = () => closeMap();
    $('cams-close').onclick = () => { App.mode = 'play'; $('cams-hud').classList.add('hidden'); };

    $('map-cv').addEventListener('click', (e) => {
      if (!App.alive || App.phase !== 'play') return;
      const cv = $('map-cv');
      const r = cv.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * SHARED.WORLD.w;
      const y = (e.clientY - r.top) / r.height * SHARED.WORLD.h;
      App.socket.emit('marker', { x, y });
      closeMap();
      toast('Marqueur placé 📍');
    });

    // Sabotages
    document.querySelectorAll('.sab-opt').forEach((b) => {
      b.onclick = () => {
        App.socket.emit('sab:start', { type: b.dataset.sab });
        closeSabPicker();
      };
    });
    $('sab-cancel').onclick = () => closeSabPicker();

    // Réunion : s'abstenir (modifiable tant que le temps n'est pas écoulé)
    $('btn-skip').onclick = () => {
      const m = App.meeting;
      if (!m || m.stage !== 'open' || !App.alive) return;
      m.myVote = 'skip';
      App.socket.emit('meeting:vote', { target: 'skip' });
      renderMeetingPlayers();
    };

    // Fin
    $('btn-again').onclick = () => App.socket.emit('game:again');

    // Pré-remplit le code depuis l'URL (?room=XXXX)
    const urlCode = new URLSearchParams(location.search).get('room');
    if (urlCode) $('home-code').value = urlCode.toUpperCase().slice(0, 4);
    const savedName = localStorage.getItem('ss_name');
    if (savedName) $('home-name').value = savedName;
  }

  return {
    show, refreshLobby, chatAdd, chatSys, updateChatAccess, toggleChat,
    refreshTasks, setProgress, roleBanner, refreshSabBanner,
    meetingOpen, meetingVotes, meetingResult, meetingClose,
    openMap, closeMap, drawMap, openSabPicker, closeSabPicker,
    updateRoleControls, showVentControls, hideVentControls, openVitals, closeVitals,
    openShiftPicker, closeShiftPicker,
    endScreen, initEvents
  };
})();
