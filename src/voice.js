// ── Config ──────────────────────────────────────────────────────────────────
const API_BASE      = (window.VOICE_API_BASE || '').replace(/\/$/, '');
const USERNAME_KEY  = 'voice_username';
const SESSION_KEY   = 'voice_session';
const POLL_MS       = 1500;
const HEARTBEAT_MS  = 15000;
const SPEAK_MS      = 100;   // speaking detector interval
const SPEAK_THRESH  = 10;    // RMS threshold (0–255)
const ICE_TIMEOUT   = 8000;  // ms to wait for ICE gathering before giving up

let turnConfig = null;

function buildIceConfig(host, username, credential) {
  return {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: `turn:${host}:3478`, username, credential },
    ],
  };
}

function stunOnlyConfig() {
  return { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
}

// ── DOM ─────────────────────────────────────────────────────────────────────
const voiceGate        = document.getElementById('voiceGate');
const voiceGateForm    = document.getElementById('voiceGateForm');
const voiceUsernameInput = document.getElementById('voiceUsernameInput');

const voiceUI          = document.getElementById('voiceUI');
const voiceDisplayName = document.getElementById('voiceDisplayName');
const voiceRenameBtn   = document.getElementById('voiceRenameBtn');
const participantGrid  = document.getElementById('participantGrid');
const muteBtn          = document.getElementById('muteBtn');
const leaveBtn         = document.getElementById('leaveBtn');
const voiceStatus      = document.getElementById('voiceStatus');
const audioUnblockBtn  = document.getElementById('audioUnblockBtn');
const voiceGateError   = document.getElementById('voiceGateError');

// ── State ────────────────────────────────────────────────────────────────────
let myClientId  = null;
let myUsername  = null;
let myStream    = null;
let muted       = false;

const peers        = {};   // clientId → { pc: RTCPeerConnection, audio: HTMLAudioElement }
const participants = new Map(); // clientId → { username }

let pollTimer      = null;
let heartbeatTimer = null;
let speakTimer     = null;
let audioCtx       = null;
let analyser       = null;

// ── Helpers ──────────────────────────────────────────────────────────────────
function getUsername()     { return localStorage.getItem(USERNAME_KEY); }
function saveUsername(name) { localStorage.setItem(USERNAME_KEY, name); }

function loadSession()      { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; } }
function saveSession(s)     { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function clearSession()     { localStorage.removeItem(SESSION_KEY); }

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setStatus(msg) {
  voiceStatus.textContent = msg;
}

function showAudioUnblockButton() {
  audioUnblockBtn.hidden = false;
  setStatus('Audio blocked by browser — click "Enable audio" to hear others');
}

function apiConfigured() {
  return API_BASE && !API_BASE.includes('TODO');
}

// ── Gate ─────────────────────────────────────────────────────────────────────
function showGate(err = '') {
  voiceUI.hidden  = true;
  voiceGate.hidden = false;
  voiceUsernameInput.value = getUsername() || '';
  if (voiceGateError) voiceGateError.textContent = err;
  voiceUsernameInput.focus();
}

async function showVoiceUI(name, previousClientId = null) {
  myUsername = name;
  voiceDisplayName.textContent = name;
  voiceGate.hidden = true;
  voiceUI.hidden   = false;
  setStatus('Joining room…');
  await joinRoom(previousClientId);
}

voiceGateForm.addEventListener('submit', async e => {
  e.preventDefault();
  const name = voiceUsernameInput.value.trim();
  if (!name) return;
  saveUsername(name);
  const session = loadSession();
  const previousClientId = (session && session.username.toLowerCase() === name.toLowerCase())
    ? session.clientId : null;
  await showVoiceUI(name, previousClientId);
});

voiceRenameBtn.addEventListener('click', () => {
  leaveRoom();
  showGate();
});

// ── Join / Leave ──────────────────────────────────────────────────────────────
async function joinRoom(previousClientId = null) {
  if (!window.isSecureContext) {
    setStatus('Voice chat requires HTTPS. Please visit https://pointfree.space/voice.html');
    return;
  }

  if (!apiConfigured()) {
    setStatus('Voice API not configured yet.');
    return;
  }

  console.log('[voice] joining room as', myUsername);
  try {
    const joinBody = { username: myUsername, roomId: 'main' };
    if (previousClientId) joinBody.previousClientId = previousClientId;
    const res  = await fetch(`${API_BASE}/voice/join`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(joinBody),
    });

    if (res.status === 409) {
      const { error } = await res.json();
      showGate(error === 'Name already taken'
        ? 'That name is already taken — pick a different one.'
        : 'Room is full (max 10).');
      return;
    }
    if (!res.ok) { setStatus('Failed to join room.'); return; }

    const data = await res.json();
    myClientId = data.clientId;
    saveSession({ clientId: myClientId, username: myUsername });
    console.log('[voice] joined, clientId=%s, existing peers=%d', myClientId, data.participants.length - 1);

    const { turn, turnReady, turnHost } = data;
    if (turn) {
      if (turnReady && turnHost) {
        turnConfig = buildIceConfig(turnHost, turn.username, turn.credential);
      } else {
        setStatus('Starting TURN server… (~30s on first join)');
        const host = await waitForTurn();
        turnConfig = buildIceConfig(host, turn.username, turn.credential);
      }
    }

    myStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('[voice] mic acquired, tracks:', myStream.getTracks().map(t => t.label));
    applyMuteState();
    startSpeakingDetector();

    // Update participant list and connect to anyone already in the room
    syncParticipants(data.participants);
    for (const p of data.participants) {
      if (p.clientId !== myClientId) {
        await createOffer(p.clientId);
      }
    }

    pollTimer      = setInterval(pollSignals,   POLL_MS);
    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);
    setStatus('Connected.');
  } catch (err) {
    console.error('[voice] joinRoom error:', err);
    setStatus('Could not access microphone or join room.');
  }
}

async function waitForTurn() {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const res  = await fetch(`${API_BASE}/voice/turn/status`);
    const data = await res.json();
    if (data.ready && data.host) return data.host;
  }
  throw new Error('TURN server did not start in time');
}

function leaveRoom() {
  clearInterval(pollTimer);
  clearInterval(heartbeatTimer);
  clearInterval(speakTimer);
  pollTimer = heartbeatTimer = speakTimer = null;

  // Close all peer connections
  for (const [id, peer] of Object.entries(peers)) {
    peer.pc.close();
    peer.audio.remove();
    delete peers[id];
  }
  participants.clear();
  participantGrid.innerHTML = '';

  if (myStream) {
    myStream.getTracks().forEach(t => t.stop());
    myStream = null;
  }
  if (audioCtx) {
    audioCtx.close();
    audioCtx = analyser = null;
  }

  if (myClientId && apiConfigured()) {
    fetch(`${API_BASE}/voice/leave`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ clientId: myClientId, roomId: 'main' }),
    }).catch(() => {});
  }

  clearSession();
  myClientId = null;
}

leaveBtn.addEventListener('click', () => {
  leaveRoom();
  showGate();
});

audioUnblockBtn.addEventListener('click', () => {
  for (const peer of Object.values(peers)) {
    if (peer.audio) peer.audio.play().catch(() => {});
  }
  audioUnblockBtn.hidden = true;
  setStatus('Audio enabled');
  setTimeout(() => setStatus('Connected.'), 2000);
});

// ── Mute ──────────────────────────────────────────────────────────────────────
function applyMuteState() {
  if (!myStream) return;
  myStream.getAudioTracks().forEach(t => { t.enabled = !muted; });
  muteBtn.textContent   = muted ? 'Unmute' : 'Mute';
  muteBtn.setAttribute('aria-pressed', String(muted));
  updateMyCard();
}

muteBtn.addEventListener('click', () => {
  muted = !muted;
  applyMuteState();
});

// ── Participant cards ─────────────────────────────────────────────────────────
function cardId(clientId) { return `card-${clientId}`; }

function upsertCard(clientId, username) {
  let card = document.getElementById(cardId(clientId));
  if (!card) {
    card = document.createElement('div');
    card.id = cardId(clientId);
    card.className = 'participant-card';
    card.innerHTML = `
      <div class="participant-avatar">${esc(username.charAt(0).toUpperCase())}</div>
      <span class="participant-name">${esc(username)}</span>
    `;
    participantGrid.appendChild(card);
  }
  return card;
}

function removeCard(clientId) {
  document.getElementById(cardId(clientId))?.remove();
}

function updateMyCard() {
  const card = document.getElementById(cardId(myClientId));
  if (!card) return;
  card.classList.toggle('participant-card--muted', muted);
}

function setSpeaking(clientId, speaking) {
  const card = document.getElementById(cardId(clientId));
  if (card) card.classList.toggle('participant-card--speaking', speaking);
}

function syncParticipants(list) {
  const incoming = new Map(list.map(p => [p.clientId, p]));

  // Add/keep present participants
  for (const [id, p] of incoming) {
    if (!participants.has(id)) {
      participants.set(id, p);
      upsertCard(id, p.username);
    }
  }

  // Remove departed participants
  for (const id of participants.keys()) {
    if (!incoming.has(id)) {
      participants.delete(id);
      removeCard(id);
      if (peers[id]) {
        peers[id].pc.close();
        peers[id].audio.remove();
        delete peers[id];
      }
    }
  }
}

// ── WebRTC ────────────────────────────────────────────────────────────────────
function makePc(remoteId) {
  const pc = new RTCPeerConnection(turnConfig ?? stunOnlyConfig());
  console.log('[voice] created PeerConnection for', remoteId);

  pc.ontrack = ({ streams }) => {
    console.log('[voice] ontrack from', remoteId, '— streams:', streams.length);
    const audio = document.createElement('audio');
    audio.srcObject = streams[0];
    document.body.appendChild(audio);
    if (peers[remoteId]) peers[remoteId].audio = audio;
    audio.play().catch(err => {
      console.warn('[voice] autoplay blocked for', remoteId, err.name);
      showAudioUnblockButton();
    });
  };

  pc.oniceconnectionstatechange = () => {
    console.log('[voice] ICE', remoteId, '→', pc.iceConnectionState);
    if (pc.iceConnectionState === 'failed') {
      console.warn('[voice] ICE failed for', remoteId, '— closing');
      pc.close();
      delete peers[remoteId];
    }
  };

  pc.onsignalingstatechange = () => {
    console.log('[voice] signaling', remoteId, '→', pc.signalingState);
  };

  if (myStream) {
    myStream.getTracks().forEach(t => pc.addTrack(t, myStream));
    console.log('[voice] added local tracks for', remoteId);
  } else {
    console.warn('[voice] no local stream when creating PC for', remoteId);
  }

  return pc;
}

function waitForIceGathering(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      console.warn('[voice] ICE gathering timed out after %dms — sending SDP anyway', ICE_TIMEOUT);
      resolve();
    }, ICE_TIMEOUT);
    pc.addEventListener('icegatheringstatechange', function handler() {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        pc.removeEventListener('icegatheringstatechange', handler);
        console.log('[voice] ICE gathering complete');
        resolve();
      }
    });
  });
}

async function createOffer(remoteId) {
  if (peers[remoteId]) return;
  console.log('[voice] createOffer →', remoteId);
  const audio = document.createElement('audio'); // placeholder until ontrack fires
  const pc    = makePc(remoteId);
  peers[remoteId] = { pc, audio };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGathering(pc);

  console.log('[voice] sending offer →', remoteId);
  await fetch(`${API_BASE}/voice/signal`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      from:   myClientId,
      to:     remoteId,
      type:   'offer',
      sdp:    pc.localDescription.sdp,
      roomId: 'main',
    }),
  });
}

async function handleOffer(signal) {
  if (peers[signal.from]) return;
  console.log('[voice] received offer from', signal.from);
  const audio = document.createElement('audio');
  const pc    = makePc(signal.from);
  peers[signal.from] = { pc, audio };

  await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGathering(pc);

  console.log('[voice] sending answer →', signal.from);
  await fetch(`${API_BASE}/voice/signal`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      from:   myClientId,
      to:     signal.from,
      type:   'answer',
      sdp:    pc.localDescription.sdp,
      roomId: 'main',
    }),
  });
}

async function handleAnswer(signal) {
  const peer = peers[signal.from];
  if (!peer) return;
  console.log('[voice] received answer from', signal.from);
  await peer.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
}

// ── Polling ───────────────────────────────────────────────────────────────────
async function pollSignals() {
  if (!myClientId || !apiConfigured()) return;
  try {
    const res = await fetch(`${API_BASE}/voice/signals?clientId=${myClientId}`);
    if (!res.ok) return;
    const signals = await res.json();
    if (signals.length) console.log('[voice] poll received %d signal(s)', signals.length);
    for (const signal of signals) {
      if (signal.type === 'offer')  await handleOffer(signal);
      if (signal.type === 'answer') await handleAnswer(signal);
    }
  } catch (_) { /* retry next tick */ }
}

async function sendHeartbeat() {
  if (!myClientId || !apiConfigured()) return;
  try {
    const res  = await fetch(`${API_BASE}/voice/heartbeat`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ clientId: myClientId, roomId: 'main' }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const newComers = data.participants.filter(
      p => p.clientId !== myClientId && !participants.has(p.clientId)
    );
    if (newComers.length) console.log('[voice] heartbeat found new peer(s):', newComers.map(p => p.username));
    syncParticipants(data.participants);
    for (const p of newComers) {
      await createOffer(p.clientId);
    }
  } catch (_) { /* retry next tick */ }
}

// ── Speaking detector ─────────────────────────────────────────────────────────
function startSpeakingDetector() {
  if (!myStream) return;
  audioCtx = new AudioContext();
  const src = audioCtx.createMediaStreamSource(myStream);
  analyser  = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  src.connect(analyser);

  const buf = new Uint8Array(analyser.frequencyBinCount);
  speakTimer = setInterval(() => {
    if (!analyser || muted) { setSpeaking(myClientId, false); return; }
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += Math.abs(buf[i] - 128);
    setSpeaking(myClientId, (sum / buf.length) > SPEAK_THRESH);
  }, SPEAK_MS);
}

// ── Init ──────────────────────────────────────────────────────────────────────
showGate();
