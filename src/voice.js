// ── Config ──────────────────────────────────────────────────────────────────
const API_BASE      = (window.VOICE_API_BASE || '').replace(/\/$/, '');
const USERNAME_KEY  = 'voice_username';
const POLL_MS       = 1500;
const HEARTBEAT_MS  = 15000;
const SPEAK_MS      = 100;   // speaking detector interval
const SPEAK_THRESH  = 10;    // RMS threshold (0–255)
const ICE_TIMEOUT   = 8000;  // ms to wait for ICE gathering before giving up

const STUN = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

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
}

function apiConfigured() {
  return API_BASE && !API_BASE.includes('TODO');
}

// ── Gate ─────────────────────────────────────────────────────────────────────
function showGate() {
  voiceUI.hidden  = true;
  voiceGate.hidden = false;
  voiceUsernameInput.value = getUsername() || '';
  voiceUsernameInput.focus();
}

async function showVoiceUI(name) {
  myUsername = name;
  voiceDisplayName.textContent = name;
  voiceGate.hidden = true;
  voiceUI.hidden   = false;
  setStatus('Joining room…');
  await joinRoom();
}

voiceGateForm.addEventListener('submit', async e => {
  e.preventDefault();
  const name = voiceUsernameInput.value.trim();
  if (!name) return;
  saveUsername(name);
  await showVoiceUI(name);
});

voiceRenameBtn.addEventListener('click', () => {
  leaveRoom();
  showGate();
});

// ── Join / Leave ──────────────────────────────────────────────────────────────
async function joinRoom() {
  if (!window.isSecureContext) {
    setStatus('Voice chat requires HTTPS. Please visit https://pointfree.space/voice.html');
    return;
  }

  if (!apiConfigured()) {
    setStatus('Voice API not configured yet.');
    return;
  }

  try {
    const res  = await fetch(`${API_BASE}/voice/join`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username: myUsername, roomId: 'main' }),
    });

    if (res.status === 409) { setStatus('Room is full (max 10).'); return; }
    if (!res.ok)             { setStatus('Failed to join room.'); return; }

    const data = await res.json();
    myClientId = data.clientId;

    myStream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
    console.error('joinRoom:', err);
    setStatus('Could not access microphone or join room.');
  }
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
  const pc = new RTCPeerConnection(STUN);

  pc.ontrack = ({ streams }) => {
    const audio = document.createElement('audio');
    audio.srcObject = streams[0];
    document.body.appendChild(audio);
    if (peers[remoteId]) peers[remoteId].audio = audio;
    audio.play().catch(() => showAudioUnblockButton());
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed') {
      pc.close();
      delete peers[remoteId];
    }
  };

  if (myStream) {
    myStream.getTracks().forEach(t => pc.addTrack(t, myStream));
  }

  return pc;
}

function waitForIceGathering(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, ICE_TIMEOUT);
    pc.addEventListener('icegatheringstatechange', function handler() {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        pc.removeEventListener('icegatheringstatechange', handler);
        resolve();
      }
    });
  });
}

async function createOffer(remoteId) {
  if (peers[remoteId]) return;
  const audio = document.createElement('audio'); // placeholder until ontrack fires
  const pc    = makePc(remoteId);
  peers[remoteId] = { pc, audio };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGathering(pc);

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
  const audio = document.createElement('audio');
  const pc    = makePc(signal.from);
  peers[signal.from] = { pc, audio };

  await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGathering(pc);

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
  await peer.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
}

// ── Polling ───────────────────────────────────────────────────────────────────
async function pollSignals() {
  if (!myClientId || !apiConfigured()) return;
  try {
    const res = await fetch(`${API_BASE}/voice/signals?clientId=${myClientId}`);
    if (!res.ok) return;
    const signals = await res.json();
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
