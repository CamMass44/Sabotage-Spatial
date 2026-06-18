'use strict';
/* Interface : écrans, salon, chat, réunions, carte, choix de sabotage, HUD. */
window.UI = (() => {

  let chatChannel = 'global';
  let meetingTimerIv = null;
  let sabBannerIv = null;

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
      for (const key of ['impostors', 'killCooldown', 'discussTime', 'voteTime', 'tasksPerPlayer', 'emergencies']) {
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
    App.socket.emit('room:settings', {
      settings: {
        impostors: +$('set-impostors').value,
        killCooldown: +$('set-killCooldown').value,
        discussTime: +$('set-discussTime').value,
        voteTime: +$('set-voteTime').value,
        tasksPerPlayer: +$('set-tasksPerPlayer').value,
        emergencies: +$('set-emergencies').value,
        confirmEjects: $('set-confirmEjects').checked
      }
    });
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
  function roleBanner() {
    const b = $('role-banner');
    const imp = App.role === 'impostor';
    b.className = imp ? 'impostor' : 'crew';
    let sub = imp
      ? 'Élimine les équipiers sans te faire repérer.'
      : 'Accomplis tes missions et démasque les saboteurs.';
    if (imp && App.partners.length > 1) {
      const others = App.partners.filter((p) => p.id !== App.you).map((p) => p.name).join(', ');
      sub += ` Complice(s) : ${others}`;
    }
    b.innerHTML = `${imp ? 'SABOTEUR' : 'ÉQUIPIER'}<small>${escapeHtml(sub)}</small>`;
    b.classList.remove('hidden');
    b.style.opacity = '1';
    setTimeout(() => { b.style.opacity = '0'; }, 3500);
    setTimeout(() => b.classList.add('hidden'), 4500);
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
      stage: data.stage,
      endsAt: data.endsAt,
      voted: new Set(data.voted || []),
      myVote: null,
      deadIds: new Set(data.deadIds || []),
      selected: null
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
    const canVote = m.stage === 'voting' && App.alive && !m.myVote;
    for (const p of App.players.values()) {
      const dead = m.deadIds.has(p.id) || !p.alive;
      const el = document.createElement('div');
      el.className = 'vote-card' + (dead ? ' dead' : '') +
        (!dead && canVote ? ' votable' : '') +
        (m.selected === p.id ? ' selected' : '');
      el.innerHTML = `<span class="dot" style="background:${SHARED.COLORS[p.color]}"></span>
        <span>${escapeHtml(p.name)}${p.id === App.you ? ' (toi)' : ''}</span>`;
      if (counts && counts[p.id]) {
        el.innerHTML += `<span class="count-badge">${counts[p.id]}</span>`;
      } else if (m.voted.has(p.id) && !dead) {
        el.innerHTML += `<span class="voted-badge">✓ a voté</span>`;
      }
      if (!dead && canVote) {
        el.style.cursor = 'pointer';
        el.onclick = () => {
          if (m.selected === p.id) {
            m.myVote = p.id;
            App.socket.emit('meeting:vote', { target: p.id });
            chatSys(`Tu as voté contre ${p.name}.`);
            m.selected = null;
            renderMeetingPlayers();
          } else {
            m.selected = p.id;
            renderMeetingPlayers();
            toast('Re-clique pour confirmer ton vote contre ' + p.name, 2000);
          }
        };
      }
      wrap.appendChild(el);
    }
    $('btn-skip').disabled = !canVote;
    $('btn-skip').textContent = m.myVote ? '✓ Vote enregistré' : '🤐 S\'abstenir';
  }

  function runMeetingTimer() {
    clearInterval(meetingTimerIv);
    const el = $('meeting-timer');
    const tick = () => {
      const m = App.meeting;
      if (!m) { clearInterval(meetingTimerIv); return; }
      const s = Math.max(0, Math.ceil((m.endsAt - Date.now()) / 1000));
      const label = m.stage === 'discussion' ? '💬 Discussion' : m.stage === 'voting' ? '🗳️ Vote' : 'Résultats';
      el.textContent = `${label} — ${s}s`;
    };
    tick();
    meetingTimerIv = setInterval(tick, 250);
  }

  function meetingStage(data) {
    if (!App.meeting) return;
    App.meeting.stage = data.stage;
    App.meeting.endsAt = data.endsAt;
    if (data.stage === 'voting') chatSys('Le vote est ouvert !');
    renderMeetingPlayers();
    runMeetingTimer();
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
      if (data.wasImpostor === true) txt += ' C\'était un saboteur ! ☠';
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
    const crew = data.winner === 'crew';
    $('end-title').textContent = crew ? '🛠️ VICTOIRE DES ÉQUIPIERS' : '☠ VICTOIRE DES SABOTEURS';
    $('end-title').className = data.winner;
    $('end-reason').textContent = data.reason;
    const roles = $('end-roles');
    roles.innerHTML = '';
    for (const r of data.roles) {
      const el = document.createElement('div');
      el.className = 'r';
      el.innerHTML = `<span class="dot" style="background:${SHARED.COLORS[r.color]}"></span>
        <span class="${r.role === 'impostor' ? 'imp' : ''}">${escapeHtml(r.name)} — ${r.role === 'impostor' ? 'Saboteur ☠' : 'Équipier'}</span>`;
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
    for (const key of ['impostors', 'killCooldown', 'discussTime', 'voteTime', 'tasksPerPlayer', 'emergencies']) {
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

    // Réunion
    $('btn-skip').onclick = () => {
      const m = App.meeting;
      if (!m || m.stage !== 'voting' || !App.alive || m.myVote) return;
      m.myVote = 'skip';
      App.socket.emit('meeting:vote', { target: 'skip' });
      chatSys('Tu t\'es abstenu.');
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
    meetingOpen, meetingStage, meetingVotes, meetingResult, meetingClose,
    openMap, closeMap, drawMap, openSabPicker, closeSabPicker,
    endScreen, initEvents
  };
})();
