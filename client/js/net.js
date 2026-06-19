'use strict';
/* Couche réseau : Socket.io + reconnexion automatique. */
window.Net = (() => {

  function saveSession() {
    if (App.code && App.token) {
      localStorage.setItem('ss_session', JSON.stringify({ code: App.code, token: App.token }));
    }
    if (App.name) localStorage.setItem('ss_name', App.name);
  }
  function clearSession() {
    localStorage.removeItem('ss_session');
  }

  function onJoined(res) {
    App.code = res.code;
    App.you = res.you;
    App.token = res.token;
    saveSession();
  }

  function resetGameState() {
    App.role = null;
    App.partners = [];
    App.tasks = [];
    App.taskPct = 0;
    App.bodies = [];
    App.markers = [];
    App.sab = null;
    App.meeting = null;
    App.alive = true;
    App.mode = 'play';
    App.killAt = 0;
    App.inVent = null;
    App.ventNet = [];
    App.scanning = false;
    App.scans = new Map();
    App.vitalsReadyAt = 0;
    App.vitalsUntil = 0;
    App.disguises = new Map();
    App.shiftReadyAt = 0;
    UI.refreshSabBanner();
  }

  function applyRoomState(d) {
    const prevPhase = App.phase;
    App.code = d.code;
    App.hostId = d.hostId;
    App.phase = d.phase;
    App.settings = d.settings;

    const seen = new Set();
    for (const p of d.players) {
      seen.add(p.id);
      const cur = App.players.get(p.id);
      if (cur) {
        Object.assign(cur, { name: p.name, color: p.color, connected: p.connected, alive: p.alive });
      } else {
        App.players.set(p.id, {
          ...p,
          x: SHARED.SPAWN.x, y: SHARED.SPAWN.y,
          tx: SHARED.SPAWN.x, ty: SHARED.SPAWN.y,
          dir: 1, moving: false
        });
      }
    }
    for (const id of [...App.players.keys()]) {
      if (!seen.has(id)) App.players.delete(id);
    }
    const me = App.players.get(App.you);
    if (me) App.alive = me.alive;

    if (d.phase === 'lobby') {
      if (prevPhase !== 'lobby') resetGameState();
      UI.show('lobby');
      UI.refreshLobby();
    } else if (d.phase !== 'end') {
      // partie en cours : garde la liste de joueurs à jour
      UI.refreshLobby();
    } // l'écran de fin est géré par game:over
    UI.updateChatAccess();
    Voice.sync();
  }

  function connect() {
    const socket = io();
    App.socket = socket;

    socket.on('connect', () => {
      // Tentative de reprise de session (rafraîchissement / déconnexion)
      if (App.code && App.token) {
        socket.emit('room:rejoin', { code: App.code, token: App.token }, (res) => {
          if (!res || !res.ok) {
            clearSession();
            App.code = null;
            UI.show('home');
            toast('La session a expiré.');
          } else {
            toast('Reconnecté ✓');
          }
        });
        return;
      }
      const saved = localStorage.getItem('ss_session');
      if (saved) {
        try {
          const s = JSON.parse(saved);
          socket.emit('room:rejoin', { code: s.code, token: s.token }, (res) => {
            if (res && res.ok) {
              App.code = res.code; App.you = res.you; App.token = res.token;
              toast('Session restaurée ✓');
            } else {
              clearSession();
            }
          });
        } catch (e) { clearSession(); }
      }
    });

    socket.on('disconnect', () => {
      if (App.code) toast('Connexion perdue… reconnexion en cours');
    });

    socket.on('room:state', applyRoomState);

    socket.on('game:start', (d) => {
      resetGameState();
      App.role = d.role;
      App.partners = d.partners || [];
      App.tasks = d.tasks;
      App.settings = d.settings;
      App.killAt = d.killAt || 0;
      App.shiftReadyAt = d.shiftReadyAt || 0;
      App.emergenciesLeft = d.emergenciesLeft;
      App.alive = true;
      App.pos.x = d.x; App.pos.y = d.y;
      App.phase = 'play';
      for (const p of App.players.values()) { p.alive = true; p.x = p.tx = d.x; p.y = p.ty = d.y; }
      $('ghost-banner').classList.add('hidden');
      $('chat-log').innerHTML = '';
      UI.show('game');
      UI.refreshTasks();
      UI.setProgress(0);
      UI.updateChatAccess();
      UI.updateRoleControls();
      UI.roleBanner();
      UI.chatSys('La partie commence. Bonne chance !');
      Game.onGameStart();
      Voice.sync();
    });

    socket.on('game:resync', (d) => {
      resetGameState();
      App.phase = d.phase;
      App.role = d.role;
      App.partners = d.partners || [];
      App.tasks = d.tasks || [];
      App.taskPct = d.taskPct || 0;
      App.alive = d.alive;
      App.killAt = d.killAt || 0;
      App.emergenciesLeft = d.emergenciesLeft;
      App.sab = d.sab;
      App.bodies = d.bodies || [];
      App.markers = d.markers || [];
      App.pos.x = d.x; App.pos.y = d.y;
      App.inVent = d.inVent || null;
      App.ventNet = d.ventNet || [];
      App.shiftReadyAt = d.shiftReadyAt || 0;
      App.scans = new Map((d.scans || []).map((s) => [s.playerId, { x: s.x, y: s.y, endsAt: s.endsAt }]));
      App.scanning = App.scans.has(App.you);
      App.disguises = new Map((d.shifts || []).map((s) => [s.playerId, { name: s.name, color: s.color, endsAt: s.endsAt }]));
      UI.show('game');
      UI.refreshTasks();
      UI.setProgress(App.taskPct);
      UI.updateChatAccess();
      UI.updateRoleControls();
      UI.refreshSabBanner();
      if (App.inVent) UI.showVentControls();
      $('ghost-banner').classList.toggle('hidden', App.alive);
      if (d.meeting) {
        UI.meetingOpen({
          stage: d.meeting.stage,
          endsAt: d.meeting.endsAt,
          reporter: App.players.get(d.meeting.reporter) || { name: '???' },
          bodyOf: d.meeting.bodyOf,
          deadIds: d.meeting.deadIds,
          voted: d.meeting.voted,
          myVote: d.meeting.myVote
        });
      }
      Game.onGameStart();
      Voice.sync();
    });

    socket.on('snap', (d) => {
      for (const s of d.p) {
        const p = App.players.get(s.i);
        if (!p) continue;
        p.alive = !!s.a;
        p.dir = s.d;
        p.moving = !!s.m;
        p.vent = !!s.v;
        if (s.i === App.you) {
          // En conduit / scan ou téléportation serveur (réunions, début de partie)
          if (App.inVent || App.scanning || distXY(App.pos.x, App.pos.y, s.x, s.y) > 200) {
            App.pos.x = s.x; App.pos.y = s.y;
          }
          App.alive = !!s.a;
        } else {
          p.tx = s.x; p.ty = s.y;
          if (distXY(p.x, p.y, s.x, s.y) > 250) { p.x = s.x; p.y = s.y; }
        }
      }
    });

    socket.on('task:progress', (d) => {
      App.taskPct = d.pct;
      UI.setProgress(d.pct);
    });

    socket.on('body', (b) => {
      App.bodies.push(b);
      if (!App.alive || App.isImpostor()) return;
      // L'équipage proche entend un bruit sourd
      const me = App.pos;
      if (distXY(me.x, me.y, b.x, b.y) < 500) Sfx.kill();
    });

    socket.on('died', () => {
      App.alive = false;
      App.inVent = null;
      App.scanning = false;
      App.disguises.delete(App.you);
      UI.hideVentControls();
      MiniGames.close(false);
      $('ghost-banner').classList.remove('hidden');
      UI.updateChatAccess();
      UI.updateRoleControls();
      toast('☠ Tu as été éliminé ! Tu peux observer tout le vaisseau en spectateur.', 5000);
      Sfx.kill();
      Voice.stop();
    });

    socket.on('kill:ok', (d) => { App.killAt = d.killAt; });

    // Conduits
    socket.on('vent:in', (d) => {
      App.inVent = d.ventId;
      App.ventNet = d.net || [];
      UI.showVentControls();
    });
    socket.on('vent:moved', (d) => { App.inVent = d.ventId; UI.showVentControls(); });
    socket.on('vent:out', (d) => {
      App.inVent = null;
      if (d) { App.pos.x = d.x; App.pos.y = d.y; }
      UI.hideVentControls();
    });

    // Scan médical visuel
    socket.on('scan:on', (d) => {
      App.scans.set(d.playerId, { x: d.x, y: d.y, endsAt: d.endsAt });
      if (d.playerId === App.you) {
        App.scanning = true;
        App.pos.x = d.x; App.pos.y = d.y;
        toast('🩺 Scan en cours… reste immobile, les autres te voient innocenté');
      }
    });
    socket.on('scan:off', (d) => {
      App.scans.delete(d.playerId);
      if (d.playerId === App.you) App.scanning = false;
    });
    socket.on('scan:complete', (d) => {
      const t = App.tasks.find((x) => x.id === d.taskId);
      if (t) { t.done = true; UI.refreshTasks(); Sfx.task(); }
    });

    // Métamorphose
    socket.on('shift', (d) => {
      App.disguises.set(d.playerId, { name: d.name, color: d.color, endsAt: d.endsAt });
      if (d.playerId === App.you) { App.shiftReadyAt = d.endsAt + SHARED.SHIFT_COOLDOWN * 1000; toast('🎭 Tu as pris l’apparence de ' + d.name); }
    });
    socket.on('shift:off', (d) => { App.disguises.delete(d.playerId); });

    socket.on('meeting:start', (d) => {
      App.phase = 'meeting';
      App.bodies = [];
      App.markers = [];
      App.inVent = null;
      App.scanning = false;
      App.scans.clear();
      UI.hideVentControls();
      UI.meetingOpen(d);
      UI.refreshSabBanner();
    });
    socket.on('meeting:votes', (d) => UI.meetingVotes(d));
    socket.on('meeting:result', (d) => UI.meetingResult(d));
    socket.on('meeting:end', (d) => {
      App.phase = 'play';
      App.sab = d.sab;
      UI.meetingClose();
      UI.refreshSabBanner();
      UI.updateChatAccess();
      Voice.sync();
    });

    socket.on('chat', (d) => UI.chatAdd(d));

    socket.on('sab', (d) => {
      App.sab = d;
      UI.refreshSabBanner();
      UI.refreshTasks();
      if (App.mode === 'cams' && d && d.type === 'comms') {
        App.mode = 'play';
        $('cams-hud').classList.add('hidden');
        toast('📡 Les caméras sont hors service !');
      }
      Sfx.alarm();
    });
    socket.on('sab:off', () => {
      App.sab = null;
      UI.refreshSabBanner();
      UI.refreshTasks();
      UI.chatSys('Sabotage réparé ✓');
    });

    socket.on('marker', (m) => {
      App.markers.push(m);
      UI.chatSys(`📍 ${m.name} a marqué un événement suspect sur la carte.`);
      if (!$('overlay-map').classList.contains('hidden')) UI.drawMap();
    });

    socket.on('game:over', (d) => {
      App.phase = 'end';
      UI.endScreen(d);
      Voice.sync();
    });

    socket.on('rtc', (d) => Voice.onSignal(d.from, d.data));
  }

  /* ---- Émissions ---- */
  function create(name) {
    App.name = name;
    App.socket.emit('room:create', { name }, (res) => {
      if (res && res.ok) { onJoined(res); }
      else toast((res && res.error) || 'Erreur lors de la création.');
    });
  }

  function join(code, name) {
    App.name = name;
    App.socket.emit('room:join', { code, name }, (res) => {
      if (res && res.ok) { onJoined(res); }
      else toast((res && res.error) || 'Impossible de rejoindre ce salon.');
    });
  }

  function leave() {
    App.socket.emit('room:leave');
    clearSession();
    Voice.stop();
    App.code = null;
    App.you = null;
    App.token = null;
    App.players.clear();
    App.phase = 'home';
    UI.show('home');
  }

  let lastMoveSent = 0;
  function sendMove() {
    const now = performance.now();
    if (now - lastMoveSent < 80) return;
    lastMoveSent = now;
    App.socket.emit('p:move', {
      x: App.pos.x, y: App.pos.y,
      dir: App.pos.dir, moving: App.pos.moving
    });
  }

  return { connect, create, join, leave, sendMove };
})();
