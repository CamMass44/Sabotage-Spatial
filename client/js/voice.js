'use strict';
/*
 * Chat vocal en mesh WebRTC, signalisation relayée par Socket.io ('rtc').
 * Actif pour les joueurs vivants (et tout le monde dans le salon / à la fin).
 * Les joueurs éliminés perdent l'accès au vocal (micro coupé, connexions fermées).
 */
window.Voice = (() => {
  const peers = new Map(); // id -> { pc, audio }
  let stream = null;
  let wantOn = false;

  const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  function canTalk() {
    if (!App.code) return false;
    if (App.inGame()) return App.alive;
    return true; // lobby / fin de partie
  }

  function eligiblePeers() {
    const out = [];
    if (!canTalk()) return out;
    for (const p of App.players.values()) {
      if (p.id === App.you || !p.connected || p.isBot) continue;
      if (App.inGame() && !p.alive) continue;
      out.push(p.id);
    }
    return out;
  }

  async function start() {
    if (stream) { wantOn = true; sync(); updateUi(); return true; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (e) {
      toast('Micro indisponible (autorise le micro, HTTPS requis hors localhost)');
      return false;
    }
    wantOn = true;
    sync();
    updateUi();
    return true;
  }

  function stop() {
    wantOn = false;
    for (const id of [...peers.keys()]) closePeer(id);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    updateUi();
  }

  function closePeer(id) {
    const p = peers.get(id);
    if (!p) return;
    try { p.pc.close(); } catch (e) { /* ignore */ }
    if (p.audio) p.audio.remove();
    peers.delete(id);
  }

  function newPeer(id, initiator) {
    if (peers.has(id)) return peers.get(id);
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const entry = { pc, audio: null, pendingCands: [] };
    peers.set(id, entry);

    if (stream) stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    pc.onicecandidate = (e) => {
      if (e.candidate) App.socket.emit('rtc', { to: id, data: { cand: e.candidate } });
    };
    pc.ontrack = (e) => {
      if (!entry.audio) {
        entry.audio = document.createElement('audio');
        entry.audio.autoplay = true;
        entry.audio.style.display = 'none';
        document.body.appendChild(entry.audio);
      }
      entry.audio.srcObject = e.streams[0];
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) closePeer(id);
    };
    if (initiator) {
      pc.onnegotiationneeded = async () => {
        try {
          await pc.setLocalDescription(await pc.createOffer());
          App.socket.emit('rtc', { to: id, data: { sdp: pc.localDescription } });
        } catch (e) { /* ignore */ }
      };
    }
    return entry;
  }

  // Aligne les connexions sur la liste des pairs éligibles
  function sync() {
    if (!wantOn || !stream) {
      for (const id of [...peers.keys()]) closePeer(id);
      updateUi();
      return;
    }
    const want = new Set(eligiblePeers());
    for (const id of [...peers.keys()]) {
      if (!want.has(id)) closePeer(id);
    }
    for (const id of want) {
      if (!peers.has(id) && App.you < id) newPeer(id, true); // le plus petit id initie
    }
    updateUi();
  }

  async function onSignal(from, data) {
    if (!wantOn || !stream) return;
    if (App.inGame() && !App.alive) return;
    const entry = peers.get(from) || newPeer(from, false);
    const pc = entry.pc;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          App.socket.emit('rtc', { to: from, data: { sdp: pc.localDescription } });
        }
        for (const c of entry.pendingCands) await pc.addIceCandidate(c).catch(() => {});
        entry.pendingCands = [];
      } else if (data.cand) {
        if (pc.remoteDescription) await pc.addIceCandidate(data.cand).catch(() => {});
        else entry.pendingCands.push(data.cand);
      }
    } catch (e) { /* signalisation concurrente : on ignore */ }
  }

  function updateUi() {
    const on = wantOn && !!stream;
    const b = $('b-mic');
    if (b) {
      b.classList.toggle('on', on);
      b.title = on ? `Micro activé (${peers.size} connecté·s)` : 'Activer le chat vocal';
      b.textContent = on ? '🎙️' : '🔇';
    }
    const lb = $('btn-lobby-mic');
    if (lb) lb.textContent = on ? '🎙️ Micro activé' : '🎙️ Activer le micro';
  }

  async function toggleMic() {
    if (wantOn && stream) stop();
    else await start();
  }

  return { toggleMic, stop, sync, onSignal, isOn: () => wantOn && !!stream };
})();
