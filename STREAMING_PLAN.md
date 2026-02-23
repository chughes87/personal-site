# Screen Sharing Feature

## Context

Add screen sharing to the existing voice room (`voice.html`). One person shares at a time; viewers are the same small group already in the voice room. Designed for gaming streams at lower resolution. No new AWS services — the existing Lambda + DynamoDB signaling infrastructure is sufficient.

**AWS cost impact: ~$0 additional.** Uses the same DynamoDB table and Lambda, just a few extra ephemeral signal items per session.

---

## Architecture

- **Pure P2P WebRTC** — sharer creates one *additional* video-only `RTCPeerConnection` per viewer (separate from the audio PCs; no renegotiation complexity)
- **Signal-based state** — three new signal types (`screen-offer`, `screen-answer`, `screen-stop`) routed through the existing `/voice/signal` endpoint. No DynamoDB schema changes.
- **One-at-a-time enforcement** — frontend only; `shareBtn` is disabled when `currentSharerClientId` is set by an incoming `screen-offer`
- **Browser stop button** — handled via `track.addEventListener('ended', stopSharing)`

---

## Files to Change

| File | Change |
|---|---|
| `api/handler.js` | Extend `voiceSignal` type allowlist; make `sdp` optional for `screen-stop` |
| `src/voice.js` | New state, new functions, extend `pollSignals`/`sendHeartbeat`/`leaveRoom` |
| `voice.html` | Add `#screenContainer`, `#screenVideo`, `#shareBtn`, `#stopShareBtn` |
| `src/style.css` | Add `.screen-container`, `.screen-video`, `.btn-screen-share`, `.btn-screen-stop` |
| `tests/api/handler.test.js` | New tests for screen signal types |
| `tests/src/voice.test.js` | Extend HTML fixture + mocks; new describe blocks |

---

## Checklist

- [ ] `api/handler.js` — extend `voiceSignal` type allowlist
- [ ] `voice.html` — add screen container + share/stop buttons
- [ ] `src/style.css` — screen container + button styles
- [ ] `src/voice.js` — all new state, functions, and modifications
- [ ] `tests/api/handler.test.js` — screen signal type tests
- [ ] `tests/src/voice.test.js` — screen share tests
- [ ] Open PR, CI green

---

## 1. `api/handler.js` — `voiceSignal`

Replace the current two-line type + sdp guard:

```js
// OLD:
if (!from || !to || !type || !sdp) return resp(400, ...);
if (type !== 'offer' && type !== 'answer') return resp(400, ...);

// NEW:
const SDP_REQUIRED = ['offer', 'answer', 'screen-offer', 'screen-answer'];
const ALL_TYPES    = [...SDP_REQUIRED, 'screen-stop'];

if (!from || !to || !type)                return resp(400, { error: 'from, to, and type are required' });
if (!ALL_TYPES.includes(type))            return resp(400, { error: 'invalid signal type' });
if (SDP_REQUIRED.includes(type) && !sdp) return resp(400, { error: 'sdp is required for this signal type' });
```

Then conditionally include `sdp` in the DynamoDB item:
```js
const item = { pk: `inbox#${to}`, sk: `${ts}#${id}`, from, to, type, ttl: ttl(60) };
if (sdp) item.sdp = sdp;
await ddb.send(new PutCommand({ TableName: VOICE_TABLE, Item: item }));
```

---

## 2. `voice.html`

**Add inside `.voice-ui`, between `#participantGrid` and `.voice-controls`:**

```html
<div class="screen-container" id="screenContainer" hidden>
  <video class="screen-video" id="screenVideo" autoplay muted playsinline></video>
</div>
```

**Add to `.voice-controls` (between `leaveBtn` and `audioUnblockBtn`):**

```html
<button type="button" class="btn btn-screen-share" id="shareBtn">Share screen</button>
<button type="button" class="btn btn-screen-stop" id="stopShareBtn" hidden>Stop sharing</button>
```

---

## 3. `src/style.css`

Append after the existing voice styles:

```css
/* -- Screen share -- */
.screen-container {
  flex-shrink: 0;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  max-height: 60vh;
  overflow: hidden;
  border-bottom: 1px solid var(--color-border);
}
.screen-container[hidden] { display: none; }
.screen-video {
  width: 100%;
  max-height: 60vh;
  object-fit: contain;
  display: block;
}
.btn-screen-share {
  background: var(--color-surface);
  color: var(--color-accent);
  border: 1px solid var(--color-accent);
}
.btn-screen-share:hover {
  background: color-mix(in srgb, var(--color-accent) 10%, transparent);
}
.btn-screen-stop {
  background: #9a6700;
  color: #fff;
  border: 1px solid transparent;
}
[data-theme="dark"] .btn-screen-stop { background: #e3b341; color: #1f2328; }
```

---

## 4. `src/voice.js`

### New DOM refs (add after existing refs)
```js
const shareBtn        = document.getElementById('shareBtn');
const stopShareBtn    = document.getElementById('stopShareBtn');
const screenContainer = document.getElementById('screenContainer');
const screenVideo     = document.getElementById('screenVideo');
```

### New state (add after `const participants`)
```js
const screenPeers         = {};    // clientId → { pc: RTCPeerConnection }
let   screenStream        = null;  // local MediaStream from getDisplayMedia
let   currentSharerClientId = null;  // clientId of whoever is sharing (null = nobody)
```

### New functions

**`makeScreenPc(remoteId)`** — video-only PC; `ontrack` shows container:
```js
function makeScreenPc(remoteId) {
  const pc = new RTCPeerConnection(STUN);
  pc.ontrack = ({ streams }) => {
    screenVideo.srcObject = streams[0];
    screenContainer.hidden = false;
    screenVideo.play().catch(() => {});
  };
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed') { pc.close(); delete screenPeers[remoteId]; }
  };
  if (screenStream) screenStream.getTracks().forEach(t => pc.addTrack(t, screenStream));
  return pc;
}
```

**`createScreenOffer(remoteId)`**:
```js
async function createScreenOffer(remoteId) {
  if (screenPeers[remoteId]) return;
  const pc = makeScreenPc(remoteId);
  screenPeers[remoteId] = { pc };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGathering(pc);
  await fetch(`${API_BASE}/voice/signal`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: myClientId, to: remoteId, type: 'screen-offer', sdp: pc.localDescription.sdp, roomId: 'main' }),
  });
}
```

**`handleScreenOffer(signal)`** — disables `shareBtn` on viewers:
```js
async function handleScreenOffer(signal) {
  currentSharerClientId = signal.from;
  shareBtn.disabled = true;
  if (screenPeers[signal.from]) { screenPeers[signal.from].pc.close(); delete screenPeers[signal.from]; }
  const pc = makeScreenPc(signal.from);
  screenPeers[signal.from] = { pc };
  await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitForIceGathering(pc);
  await fetch(`${API_BASE}/voice/signal`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: myClientId, to: signal.from, type: 'screen-answer', sdp: pc.localDescription.sdp, roomId: 'main' }),
  });
}
```

**`handleScreenAnswer(signal)`**:
```js
async function handleScreenAnswer(signal) {
  const peer = screenPeers[signal.from];
  if (!peer) return;
  await peer.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
}
```

**`handleScreenStop(signal)`** — re-enables `shareBtn`:
```js
function handleScreenStop(signal) {
  if (currentSharerClientId === signal.from) currentSharerClientId = null;
  if (screenPeers[signal.from]) { screenPeers[signal.from].pc.close(); delete screenPeers[signal.from]; }
  screenVideo.srcObject = null;
  screenContainer.hidden = true;
  shareBtn.disabled = false;
}
```

**`shareScreen()`**:
```js
async function shareScreen() {
  if (screenStream) return;
  try { screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true }); }
  catch { return; }
  screenVideo.srcObject = screenStream;
  screenContainer.hidden = false;
  screenVideo.play().catch(() => {});
  shareBtn.hidden     = true;
  stopShareBtn.hidden = false;
  screenStream.getVideoTracks()[0].addEventListener('ended', stopSharing);
  for (const remoteId of Object.keys(peers)) await createScreenOffer(remoteId);
}
```

**`stopSharing()`**:
```js
async function stopSharing() {
  if (!screenStream) return;
  screenStream.getTracks().forEach(t => t.stop());
  screenStream = null;
  screenVideo.srcObject = null;
  screenContainer.hidden = true;
  for (const [id, peer] of Object.entries(screenPeers)) { peer.pc.close(); delete screenPeers[id]; }
  stopShareBtn.hidden = true;
  shareBtn.hidden     = false;
  for (const remoteId of Object.keys(peers)) {
    fetch(`${API_BASE}/voice/signal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: myClientId, to: remoteId, type: 'screen-stop', roomId: 'main' }),
    }).catch(() => {});
  }
}
```

### Event listeners (add near `muteBtn` / `leaveBtn` listeners)
```js
shareBtn.addEventListener('click', shareScreen);
stopShareBtn.addEventListener('click', stopSharing);
```

### Modify `pollSignals` — add three new branches:
```js
if (signal.type === 'screen-offer')  await handleScreenOffer(signal);
if (signal.type === 'screen-answer') await handleScreenAnswer(signal);
if (signal.type === 'screen-stop')   handleScreenStop(signal);
```

### Modify `sendHeartbeat` — offer screen to late joiners:
```js
// After: for (const p of newComers) { await createOffer(p.clientId); }
if (screenStream) {
  for (const p of newComers) await createScreenOffer(p.clientId);
}
```

### Modify `leaveRoom` — clean up screen state (add before `clearSession()`):
```js
if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
for (const [id, peer] of Object.entries(screenPeers)) { peer.pc.close(); delete screenPeers[id]; }
screenVideo.srcObject = null;
screenContainer.hidden = true;
stopShareBtn.hidden = true;
shareBtn.hidden     = false;
currentSharerClientId = null;
```

---

## 5. Tests

### `tests/api/handler.test.js` — new signal type tests
- `screen-offer` with sdp → 201
- `screen-answer` with sdp → 201
- `screen-stop` without sdp → 201
- `screen-offer` without sdp → 400
- unknown type → 400 (regression)
- existing `offer`/`answer` still → 201 (regression)

### `tests/src/voice.test.js`
- Extend HTML fixture with `#screenContainer`, `#screenVideo`, `#shareBtn`, `#stopShareBtn`
- Add `getDisplayMedia` mock to `navigator.mediaDevices`
- New tests:
  - `shareScreen` calls `getDisplayMedia` and sends `screen-offer` to each peer
  - `shareScreen` swaps shareBtn ↔ stopShareBtn
  - `stopSharing` sends `screen-stop` to each peer and resets UI
  - `pollSignals` handles `screen-stop` → hides `screenContainer`
  - `leaveRoom` while sharing → stops tracks, hides container

---

## Signal Flow

```
SHARER                                        VIEWER
------                                        ------
shareScreen()
  getDisplayMedia()
  createScreenOffer(viewerId)
    makeScreenPc() [adds screen track]
    createOffer / waitForIce
    POST /voice/signal { type: 'screen-offer', sdp, from, to }

                          pollSignals() → handleScreenOffer()
                            makeScreenPc() [no track]
                            setRemoteDescription(offer)
                            createAnswer / waitForIce
                            POST /voice/signal { type: 'screen-answer', sdp, from, to }
                            [ontrack → screenVideo plays]

pollSignals() → handleScreenAnswer()
  setRemoteDescription(answer)
  [P2P video flows]

-- Stop --

stopSharing()
  track.stop()
  POST /voice/signal { type: 'screen-stop', from, to }  (no sdp)

                          pollSignals() → handleScreenStop()
                            close screen PC
                            hide screenContainer
```

---

## Verification

CI is the only test runner (no local Node.js). Push branch → open PR → GitHub Actions runs Jest. Check:
1. All existing voice tests still pass
2. New handler signal-type tests pass
3. New voice.js screen tests pass
4. Deploy to S3 → open `https://pointfree.space/voice.html` in two tabs → join both → click "Share screen" in one → confirm video appears in the other
