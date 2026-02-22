# Voice Chat Room — Implementation Plan

## Overview

Add a peer-to-peer voice room supporting up to ~10 simultaneous participants. Audio
flows directly between browsers via WebRTC; Lambda + DynamoDB handle only the
connection-setup signaling (same polling pattern as the existing text chat).

```
Setup phase (through your server):
  Browser A → Lambda/DDB → Browser B   (SDP offer)
  Browser B → Lambda/DDB → Browser A   (SDP answer)

Audio phase (direct P2P, server not involved):
  Browser A ⟷ Browser B
  Browser A ⟷ Browser C
  Browser B ⟷ Browser C   (etc.)
```

### Design choices

| Choice | Decision | Rationale |
|---|---|---|
| Topology | Full mesh | ≤10 people, audio-only (~64 kbps/stream) — mesh is fine |
| Signaling transport | DynamoDB polling (1.5 s interval) | Matches existing chat pattern, no WebSocket infra needed |
| ICE strategy | Vanilla ICE (wait for full gathering) | Eliminates per-candidate signaling, simpler with polling |
| STUN/TURN | STUN only (Google free) | No extra infra; symmetric-NAT users may fail (acceptable) |
| Frontend deps | None (native WebRTC APIs) | Consistent with "no build step, no frontend dependencies" |
| Lambda | Same function as chat | Single SAM stack, no extra deployment |

### Known limitations

- **No TURN server** — users behind symmetric NAT or strict corporate firewalls may
  fail to establish a direct connection.
- **~1.5–4.5 s connection setup** — artifact of polling-based signaling.
- **No authentication** — anyone with the URL can join (same as text chat).

---

## New DynamoDB Table: `voice-room`

One table, two record types, keyed to avoid cross-partition scans.

| Record | PK | SK | Key attributes |
|---|---|---|---|
| Participant | `room#main` | `participant#{clientId}` | `clientId`, `username`, `ttl` |
| Signal inbox | `inbox#{toClientId}` | `{timestamp}#{randomId}` | `from`, `to`, `type`, `sdp`, `ttl` |

- **Participant TTL**: `now + 30 s`, renewed by heartbeat every 15 s.
  Expired = disconnected (handles crash/tab-close automatically).
- **Signal TTL**: `now + 60 s` (consumed and deleted on first read).

---

## New API Endpoints

All added to the existing Lambda. Route: `/voice/{proxy+}` dispatches on `rawPath`.

### POST `/voice/join`
```json
Body:    { "username": "Alice", "roomId": "main" }
Returns: { "clientId": "a1b2c3d4", "participants": [{ "clientId": "...", "username": "..." }] }
```
- Generates a random `clientId`
- Returns 409 if room already has 10 participants
- Writes participant record with 30 s TTL
- Queries all `room#main` participants and returns them

### POST `/voice/heartbeat`
```json
Body:    { "clientId": "a1b2c3d4", "roomId": "main" }
Returns: { "participants": [{ "clientId": "...", "username": "..." }] }
```
- `UpdateItem` to bump TTL to `now + 30 s`
- Returns current participant list (used to detect joins/leaves)

### POST `/voice/leave`
```json
Body: { "clientId": "a1b2c3d4", "roomId": "main" }
```
- Deletes own participant record
- Returns 200

### POST `/voice/signal`
```json
Body: { "from": "a1b2c3d4", "to": "e5f6g7h8", "type": "offer", "sdp": "v=0...", "roomId": "main" }
```
- Writes to PK `inbox#{to}` with 60 s TTL
- Returns 201

### GET `/voice/signals?clientId=a1b2c3d4`
```json
Returns: [{ "from": "e5f6g7h8", "type": "offer", "sdp": "v=0..." }, ...]
```
- Queries `inbox#{clientId}` for all pending signals
- Deletes them after read (query → sequential `DeleteItem` calls)

---

## Files to Create / Modify

### New: `voice.html`
Mirrors `chat.html` structure. Two UI states:

1. **Gate** — username input with "Join" button (identical pattern to chat gate)
2. **Voice UI**:
   - Top bar: room name + current username + "change" link
   - Participant grid: card per peer (initials avatar, name, speaking ring)
   - Controls: Mute / Leave buttons
   - Status area: connection notices

Sets `window.VOICE_API_BASE` (injected by deploy workflow using same `CHAT_API_URL`
secret — same API Gateway, same base URL).

### New: `src/voice.js`
No external dependencies. Uses native `RTCPeerConnection`, `getUserMedia`,
`AudioContext`.

**State:**
```js
let myClientId = null;
let myUsername = null;
let myStream   = null;            // MediaStream from getUserMedia
const peers    = {};              // clientId → { pc: RTCPeerConnection, audio: HTMLAudioElement }
const participants = new Map();   // clientId → { username }
```

**Connection flow after joining:**
1. `POST /voice/join` → receive `clientId` + existing participant list
2. `getUserMedia({ audio: true })` — request microphone permission
3. For each existing participant → `createOffer(theirClientId)`
4. Start `pollSignals()` on 1.5 s interval
5. Start `heartbeat()` on 15 s interval

**`createOffer(remoteId)`**
```
new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
addTrack(local stream tracks)
createOffer() → setLocalDescription()
await iceGatheringComplete()     ← wait; SDP now contains all candidates
POST /voice/signal { type: 'offer', sdp: pc.localDescription.sdp, to: remoteId }
```

**`handleOffer(signal)`**
```
new RTCPeerConnection(...)        ← or reuse if exists
addTrack(local stream tracks)
setRemoteDescription(offer)
createAnswer() → setLocalDescription()
await iceGatheringComplete()
POST /voice/signal { type: 'answer', sdp: pc.localDescription.sdp, to: signal.from }
```

**`handleAnswer(signal)`**
```
peers[signal.from].pc.setRemoteDescription(answer SDP)
```

**`pc.ontrack`** → create `<audio autoplay>` element, set `srcObject`, append to DOM
(audio elements are hidden; sound plays automatically).

**`heartbeat()`** → POST heartbeat → diff participant list → call `createOffer` for
newcomers, remove cards for participants no longer present.

**Speaking indicator** — `AudioContext` + `AnalyserNode` on local stream; toggle
`participant-card--speaking` CSS class when volume exceeds threshold. Runs on 100 ms
interval while in room.

**Leave** — POST `/voice/leave`, close all `RTCPeerConnection`s, stop all media
tracks, clear intervals.

### New: `tests/src/voice.test.js`
jsdom environment. Mocks: `RTCPeerConnection`, `navigator.mediaDevices.getUserMedia`,
`AudioContext`, `fetch`.

Tests cover:
- Gate → room flow (username save/restore)
- `createOffer` sends correct signal payload
- `handleOffer` / `handleAnswer` set remote descriptions
- Heartbeat diffs trigger new offers for newcomers
- Leave closes peer connections and stops tracks
- XSS prevention on participant usernames rendered in cards

### Modified: `api/handler.js`
- Add `DeleteCommand`, `BatchWriteCommand` imports
- Add `VOICE_TABLE = process.env.VOICE_TABLE`
- Add top-level route: `if (path.startsWith('/voice/')) return handleVoice(...)`
- Implement the 5 voice handler functions
- Add `DELETE` to OPTIONS allowed methods

### Modified: `api/template.yaml`
```yaml
# New table
VoiceRoomTable:
  Type: AWS::DynamoDB::Table
  Properties:
    TableName: voice-room
    BillingMode: PAY_PER_REQUEST
    KeySchema:
      - { AttributeName: pk, KeyType: HASH }
      - { AttributeName: sk, KeyType: RANGE }
    AttributeDefinitions:
      - { AttributeName: pk, AttributeType: S }
      - { AttributeName: sk, AttributeType: S }
    TimeToLiveSpecification:
      AttributeName: ttl
      Enabled: true

# Additions to ChatFunction
Environment:
  Variables:
    VOICE_TABLE: !Ref VoiceRoomTable

Policies:
  - DynamoDBCrudPolicy:
      TableName: !Ref VoiceRoomTable

Events:
  VoiceApi:
    Type: HttpApi
    Properties:
      ApiId: !Ref ChatApi
      Path: /voice/{proxy+}
      Method: ANY
```

### Modified: `src/style.css`
Append voice-specific styles (no changes to existing rules):

- `.voice-page`, `.voice-layout` — full-height page container
- `.voice-gate`, `.voice-gate-form` — identical pattern to `.chat-gate`
- `.voice-ui`, `.voice-topbar` — room header
- `.participant-grid` — `display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))`
- `.participant-card` — card with initials avatar circle, name label
- `.participant-card--speaking` — animated pulsing ring (`@keyframes voice-pulse`)
- `.participant-card--muted` — visual indicator (mic-off icon or muted label)
- `.voice-controls` — flex row with mute + leave buttons
- `.voice-status` — small status/notice text area

### Modified: `index.html` + `chat.html`
Add to `<ul class="nav-links">`:
```html
<li><a href="/voice.html">Voice</a></li>
```

### Modified: `.github/workflows/deploy.yml`
Add sed step to inject the API URL into `voice.html` (reuses existing
`CHAT_API_URL` secret — same API Gateway base URL):
```yaml
- name: Inject voice API URL
  run: sed -i "s|https://TODO.execute-api|${{ secrets.CHAT_API_URL }}|g" voice.html
```

### Modified: `tests/api/handler.test.js`
Add test cases for all 5 voice endpoints, following existing mock patterns
(AWS SDK v3 fully mocked).

---

## Implementation Order

1. [x] `api/template.yaml` — add `VoiceRoomTable` + new route
2. [x] `api/handler.js` — implement 5 voice endpoints
3. [x] `voice.html` — HTML structure
4. [x] `src/style.css` — voice styles (append)
5. [x] `src/voice.js` — WebRTC client
6. [x] `index.html` + `chat.html` — add nav link
7. [x] `.github/workflows/deploy.yml` — URL injection step
8. `tests/api/handler.test.js` — voice endpoint tests
9. `tests/src/voice.test.js` — client logic tests
10. `npm test` — all tests must pass

---

## Manual Smoke Test

1. Open `voice.html` in two browser tabs (same machine, different names)
2. Both tabs should show each other as a participant card within ~15 s
3. Speak into mic in tab A → hear audio in tab B
4. Click mute in tab A → tab B hears silence (no error)
5. Close tab A → tab B removes the card within ≤30 s (heartbeat TTL expiry)
   or immediately if the leave event fires
