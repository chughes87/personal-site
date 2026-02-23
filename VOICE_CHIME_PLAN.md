# Plan: Voice Channel Join/Leave Notification Sounds

## Context

The voice channel (`src/voice.js`) currently gives no audio feedback when participants enter or leave the room. Adding short synthesized chimes makes the channel feel more alive and lets users know about arrivals/departures without watching the screen. The site is vanilla JS with no build step, so sounds are synthesized via Web Audio API (no audio files needed).

## Approach

Add a `playChime(ascending)` helper that uses the existing `audioCtx` (created in `startSpeakingDetector`) to play a two-tone sine wave chime. An ascending chime plays on join; descending on leave. A boolean flag `initialSyncDone` prevents sounds from firing on the very first `syncParticipants` call (which populates the initial participant list when you join).

## Critical Files

- `src/voice.js` — all logic changes
- `tests/src/voice.test.js` — extend AudioContext mock + add tests

---

## Checklist

- [x] Add `initialSyncDone` flag to State block in `src/voice.js`
- [x] Add `playChime(ascending)` helper in `src/voice.js`
- [x] Modify `syncParticipants` to call `playChime` on arrivals/departures
- [x] Set `initialSyncDone = true` in `joinRoom` after initial sync
- [x] Reset `initialSyncDone = false` in `leaveRoom`
- [x] Extend `AudioContext` mock in `tests/src/voice.test.js`
- [x] Add `describe('notification sounds', ...)` test block

---

## Changes to `src/voice.js`

### 1. Add `initialSyncDone` flag to State block (after `let analyser = null;`)

```js
let initialSyncDone = false;
```

### 2. Add `playChime(ascending)` helper (in Helpers section, after `setStatus`)

```js
function playChime(ascending) {
  if (!audioCtx) return;
  const now   = audioCtx.currentTime;
  const notes = ascending ? [880, 1320] : [1320, 880];
  const dur   = 0.12;  // seconds per tone
  notes.forEach((freq, i) => {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + i * dur);
    gain.gain.setValueAtTime(0.25, now + i * dur);
    gain.gain.linearRampToValueAtTime(0, now + i * dur + dur);
    osc.start(now + i * dur);
    osc.stop(now + i * dur + dur + 0.01);
  });
}
```

### 3. Modify `syncParticipants` to call `playChime`

```js
function syncParticipants(list) {
  const incoming = new Map(list.map(p => [p.clientId, p]));

  for (const [id, p] of incoming) {
    if (!participants.has(id)) {
      participants.set(id, p);
      upsertCard(id, p.username);
      if (initialSyncDone && id !== myClientId) playChime(true);
    }
  }

  for (const id of participants.keys()) {
    if (!incoming.has(id)) {
      participants.delete(id);
      removeCard(id);
      if (peers[id]) { peers[id].pc.close(); peers[id].audio.remove(); delete peers[id]; }
      if (initialSyncDone) playChime(false);
    }
  }
}
```

### 4. Set `initialSyncDone = true` in `joinRoom` (immediately after the initial `syncParticipants` call)

```js
syncParticipants(data.participants);
initialSyncDone = true;          // ← add this line
for (const p of data.participants) {
```

### 5. Reset `initialSyncDone = false` in `leaveRoom` (after the `clearInterval` calls)

```js
initialSyncDone = false;
```

---

## Changes to `tests/src/voice.test.js`

### 1. Extend AudioContext mock in `beforeEach`

Replace the existing `global.AudioContext = ...` block with one that also mocks
`createOscillator`, `createGain`, `destination`, and `currentTime`:

```js
global.AudioContext = jest.fn().mockReturnValue({
  createMediaStreamSource: jest.fn().mockReturnValue(mockSrc),
  createAnalyser: jest.fn().mockReturnValue(mockAnalyser),
  createOscillator: jest.fn().mockImplementation(() => ({
    type: 'sine',
    frequency: { setValueAtTime: jest.fn(), linearRampToValueAtTime: jest.fn() },
    connect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  })),
  createGain: jest.fn().mockImplementation(() => ({
    gain: { setValueAtTime: jest.fn(), linearRampToValueAtTime: jest.fn() },
    connect: jest.fn(),
  })),
  destination: {},
  currentTime: 0,
  close: jest.fn(),
});
```

### 2. Add `describe('notification sounds', ...)` test block

Four test cases:
1. **No sound on initial sync** — join room alone; assert `createOscillator` not called
2. **Join chime plays** — after initial sync, heartbeat returns a new participant; assert `createOscillator` called twice (two tones)
3. **Leave chime plays** — alice joins with bob present; heartbeat then returns only alice; assert `createOscillator` called twice
4. **No sound for self** — heartbeat returns only `myClientId`; assert `createOscillator` not called

---

## Verification

```bash
npm test
```
