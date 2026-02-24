/**
 * @jest-environment jsdom
 */

const HTML = `
  <div id="voiceGate" hidden>
    <form id="voiceGateForm">
      <input id="voiceUsernameInput" />
      <button type="submit">Join</button>
      <p id="voiceGateError"></p>
    </form>
  </div>
  <div id="voiceUI" hidden>
    <span id="voiceDisplayName"></span>
    <button id="voiceRenameBtn">change</button>
    <div id="participantGrid"></div>
    <button id="muteBtn" aria-pressed="false">Mute</button>
    <button id="leaveBtn">Leave</button>
    <button id="audioUnblockBtn" hidden>Enable audio</button>
    <p id="voiceStatus"></p>
    <details id="voiceLogs">
      <summary>Connection logs</summary>
      <div id="voiceLogsBody"></div>
    </details>
  </div>
`;

async function flushPromises(n = 5) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  document.body.innerHTML = HTML;
  localStorage.clear();

  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});

  // RTCPeerConnection — iceGatheringState='complete' so waitForIceGathering resolves immediately
  global.RTCPeerConnection = jest.fn().mockImplementation(() => ({
    iceGatheringState: 'complete',
    localDescription: { sdp: 'mock-sdp' },
    addTrack: jest.fn(),
    createOffer: jest.fn().mockResolvedValue({}),
    setLocalDescription: jest.fn().mockResolvedValue(),
    setRemoteDescription: jest.fn().mockResolvedValue(),
    createAnswer: jest.fn().mockResolvedValue({}),
    close: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));

  // navigator.mediaDevices
  const mockTrack = { enabled: true, stop: jest.fn() };
  const mockStream = {
    getTracks: jest.fn().mockReturnValue([mockTrack]),
    getAudioTracks: jest.fn().mockReturnValue([mockTrack]),
  };
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: jest.fn().mockResolvedValue(mockStream) },
    configurable: true,
  });

  // AudioContext
  const mockSrc = { connect: jest.fn() };
  const mockAnalyser = { fftSize: 0, frequencyBinCount: 128, getByteTimeDomainData: jest.fn() };
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

  // fetch — default: join returns { clientId: 'c1', participants: [] }
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: jest.fn().mockResolvedValue({ clientId: 'c1', participants: [] }),
  });

  // HTMLMediaElement.play — not implemented in jsdom; provide a no-op mock
  Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
    configurable: true,
    writable: true,
    value: jest.fn().mockResolvedValue(undefined),
  });

  // isSecureContext — jsdom defaults to false (http://localhost); voice.js requires HTTPS
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function loadVoice(apiBase = '') {
  window.VOICE_API_BASE = apiBase;
  require('../../src/voice');
}

const API = 'https://api.example.com';

// ── Initial display ──────────────────────────────────────────────────────────

describe('initial display', () => {
  test('shows gate and hides voiceUI when no saved username', () => {
    loadVoice();
    expect(document.getElementById('voiceGate').hidden).toBe(false);
    expect(document.getElementById('voiceUI').hidden).toBe(true);
  });

  test('pre-fills username input and shows gate when username is saved', () => {
    localStorage.setItem('voice_username', 'alice');
    loadVoice(API);
    expect(document.getElementById('voiceGate').hidden).toBe(false);
    expect(document.getElementById('voiceUI').hidden).toBe(true);
    expect(document.getElementById('voiceUsernameInput').value).toBe('alice');
  });
});

// ── Gate form ────────────────────────────────────────────────────────────────

describe('gate form', () => {
  test('saves username and transitions to voiceUI on submit', () => {
    loadVoice(API);
    document.getElementById('voiceUsernameInput').value = 'bob';
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    expect(localStorage.getItem('voice_username')).toBe('bob');
    expect(document.getElementById('voiceUI').hidden).toBe(false);
    expect(document.getElementById('voiceDisplayName').textContent).toBe('bob');
  });

  test('does nothing when submitted username is empty', () => {
    loadVoice();
    document.getElementById('voiceUsernameInput').value = '';
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    expect(document.getElementById('voiceUI').hidden).toBe(true);
    expect(localStorage.getItem('voice_username')).toBeNull();
  });
});

// ── Insecure context ─────────────────────────────────────────────────────────

describe('insecure context', () => {
  test('shows HTTPS error and does not call fetch when not in secure context', async () => {
    localStorage.setItem('voice_username', 'alice');
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    loadVoice(API);
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises();
    expect(fetch).not.toHaveBeenCalled();
    expect(document.getElementById('voiceStatus').textContent).toMatch(/https/i);
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
  });
});

// ── API not configured ───────────────────────────────────────────────────────

describe('API not configured', () => {
  test('shows not-configured status and does not call fetch', async () => {
    localStorage.setItem('voice_username', 'alice');
    loadVoice(''); // empty = not configured
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises();
    expect(fetch).not.toHaveBeenCalled();
    expect(document.getElementById('voiceStatus').textContent).toMatch(/not configured/i);
  });
});

// ── Name conflict ────────────────────────────────────────────────────────────

describe('name conflict', () => {
  test('shows name-taken error in gate when join returns 409 with Name already taken', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: jest.fn().mockResolvedValue({ error: 'Name already taken' }),
    });

    loadVoice(API);
    document.getElementById('voiceUsernameInput').value = 'alice';
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(5);

    expect(document.getElementById('voiceGate').hidden).toBe(false);
    expect(document.getElementById('voiceUI').hidden).toBe(true);
    expect(document.getElementById('voiceGateError').textContent).toMatch(/different/i);
  });

  test('shows room-full error in gate when join returns 409 with Room is full', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: jest.fn().mockResolvedValue({ error: 'Room is full' }),
    });

    loadVoice(API);
    document.getElementById('voiceUsernameInput').value = 'alice';
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(5);

    expect(document.getElementById('voiceGate').hidden).toBe(false);
    expect(document.getElementById('voiceUI').hidden).toBe(true);
    expect(document.getElementById('voiceGateError').textContent).toMatch(/full/i);
  });
});

// ── Mute button ──────────────────────────────────────────────────────────────

describe('mute button', () => {
  test('toggles aria-pressed and button text on click', async () => {
    localStorage.setItem('voice_username', 'alice');
    loadVoice(API);
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(5);

    const btn = document.getElementById('muteBtn');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.textContent.trim()).toBe('Mute');

    btn.click();
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.textContent.trim()).toBe('Unmute');

    btn.click();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.textContent.trim()).toBe('Mute');
  });
});

// ── Leave button ─────────────────────────────────────────────────────────────

describe('leave button', () => {
  test('returns to gate on click', async () => {
    localStorage.setItem('voice_username', 'alice');
    loadVoice(API);
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(5);

    expect(document.getElementById('voiceUI').hidden).toBe(false);
    document.getElementById('leaveBtn').click();
    expect(document.getElementById('voiceGate').hidden).toBe(false);
    expect(document.getElementById('voiceUI').hidden).toBe(true);
  });
});

// ── XSS prevention ───────────────────────────────────────────────────────────

describe('XSS prevention', () => {
  test('participant usernames are HTML-escaped in participant cards', async () => {
    localStorage.setItem('voice_username', 'alice');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        clientId: 'c1',
        participants: [
          { clientId: 'c1', username: 'alice' },
          { clientId: 'c2', username: '<script>alert(1)</script>' },
        ],
      }),
    });

    loadVoice(API);
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(5);

    const html = document.getElementById('participantGrid').innerHTML;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ── joinRoom ─────────────────────────────────────────────────────────────────

describe('joinRoom', () => {
  test('POSTs to /voice/join with correct body', async () => {
    localStorage.setItem('voice_username', 'alice');
    loadVoice(API);
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(3);

    expect(fetch).toHaveBeenCalledWith(
      `${API}/voice/join`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'alice', roomId: 'main' }),
      })
    );
  });

  test('calls getUserMedia after successful join', async () => {
    localStorage.setItem('voice_username', 'alice');
    loadVoice(API);
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(5);

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
  });
});

// ── Connection status ─────────────────────────────────────────────────────────

describe('connection status', () => {
  test('status bar shows "In room." after joining (not "Connected.")', async () => {
    localStorage.setItem('voice_username', 'alice');
    loadVoice(API);
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(5);

    expect(document.getElementById('voiceStatus').textContent).toBe('In room.');
  });

  test('remote participant card shows "connecting…" status initially', async () => {
    localStorage.setItem('voice_username', 'alice');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        clientId: 'c1',
        participants: [
          { clientId: 'c1', username: 'alice' },
          { clientId: 'c2', username: 'bob' },
        ],
      }),
    });

    loadVoice(API);
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(10);

    const connEl = document.getElementById('conn-c2');
    expect(connEl).not.toBeNull();
    expect(connEl.textContent).toBe('connecting…');
  });

  test('own card does not show a connection status element', async () => {
    localStorage.setItem('voice_username', 'alice');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        clientId: 'c1',
        participants: [{ clientId: 'c1', username: 'alice' }],
      }),
    });

    loadVoice(API);
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(5);

    expect(document.getElementById('conn-c1')).toBeNull();
  });

  test('ICE "connected" state updates card status to "connected"', async () => {
    let capturedPc;
    global.RTCPeerConnection = jest.fn().mockImplementation(() => {
      capturedPc = {
        iceGatheringState:          'complete',
        iceConnectionState:         'new',
        localDescription:           { sdp: 'mock-sdp' },
        addTrack:                   jest.fn(),
        createOffer:                jest.fn().mockResolvedValue({}),
        setLocalDescription:        jest.fn().mockResolvedValue(),
        setRemoteDescription:       jest.fn().mockResolvedValue(),
        createAnswer:               jest.fn().mockResolvedValue({}),
        close:                      jest.fn(),
        addEventListener:           jest.fn(),
        removeEventListener:        jest.fn(),
        oniceconnectionstatechange: null,
      };
      return capturedPc;
    });

    localStorage.setItem('voice_username', 'alice');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        clientId: 'c1',
        participants: [
          { clientId: 'c1', username: 'alice' },
          { clientId: 'c2', username: 'bob' },
        ],
      }),
    });

    loadVoice(API);
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(10);

    // Simulate ICE reaching connected
    capturedPc.iceConnectionState = 'connected';
    capturedPc.oniceconnectionstatechange();

    const bobCard = document.getElementById('card-c2');
    const connEl  = document.getElementById('conn-c2');
    expect(connEl.textContent).toBe('connected');
    expect(bobCard.classList.contains('participant-card--connected')).toBe(true);
  });
});

// ── Retry button ─────────────────────────────────────────────────────────────

describe('retry button', () => {
  function makeTwoPeerFetch() {
    return jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        clientId: 'c1',
        participants: [
          { clientId: 'c1', username: 'alice' },
          { clientId: 'c2', username: 'bob' },
        ],
      }),
    });
  }

  function captureAndJoin() {
    let capturedPc;
    global.RTCPeerConnection = jest.fn().mockImplementation(() => {
      capturedPc = {
        iceGatheringState:          'complete',
        iceConnectionState:         'new',
        localDescription:           { sdp: 'mock-sdp' },
        addTrack:                   jest.fn(),
        createOffer:                jest.fn().mockResolvedValue({}),
        setLocalDescription:        jest.fn().mockResolvedValue(),
        setRemoteDescription:       jest.fn().mockResolvedValue(),
        createAnswer:               jest.fn().mockResolvedValue({}),
        close:                      jest.fn(),
        addEventListener:           jest.fn(),
        removeEventListener:        jest.fn(),
        oniceconnectionstatechange: null,
      };
      return capturedPc;
    });
    global.fetch = makeTwoPeerFetch();
    localStorage.setItem('voice_username', 'alice');
    loadVoice(API);
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    return () => capturedPc;
  }

  test('retry button is hidden initially on remote participant card', async () => {
    captureAndJoin();
    await flushPromises(10);

    const btn = document.getElementById('retry-c2');
    expect(btn).not.toBeNull();
    expect(btn.hidden).toBe(true);
  });

  test('retry button shown when ICE state is failed', async () => {
    const getPC = captureAndJoin();
    await flushPromises(10);

    getPC().iceConnectionState = 'failed';
    getPC().oniceconnectionstatechange();

    expect(document.getElementById('retry-c2').hidden).toBe(false);
  });

  test('retry button shown when ICE state is disconnected', async () => {
    const getPC = captureAndJoin();
    await flushPromises(10);

    getPC().iceConnectionState = 'disconnected';
    getPC().oniceconnectionstatechange();

    expect(document.getElementById('retry-c2').hidden).toBe(false);
  });

  test('retry button hidden when ICE state is connected', async () => {
    const getPC = captureAndJoin();
    await flushPromises(10);

    // First make it fail so the button shows
    getPC().iceConnectionState = 'failed';
    getPC().oniceconnectionstatechange();
    expect(document.getElementById('retry-c2').hidden).toBe(false);

    // Now a new connection becomes connected
    getPC().iceConnectionState = 'connected';
    getPC().oniceconnectionstatechange();
    expect(document.getElementById('retry-c2').hidden).toBe(true);
  });

  test('clicking retry closes old PC and sends a new offer', async () => {
    const getPC = captureAndJoin();
    await flushPromises(10);

    const firstPc = getPC();
    // Simulate failure so retry button appears
    firstPc.iceConnectionState = 'failed';
    firstPc.oniceconnectionstatechange();
    await flushPromises(2);

    const signalCallsBefore = fetch.mock.calls.filter(
      ([url]) => url === `${API}/voice/signal`
    ).length;

    document.getElementById('retry-c2').click();
    await flushPromises(10);

    expect(firstPc.close).toHaveBeenCalled();
    const signalCallsAfter = fetch.mock.calls.filter(
      ([url]) => url === `${API}/voice/signal`
    ).length;
    expect(signalCallsAfter).toBeGreaterThan(signalCallsBefore);
  });
});

// ── Peer logs ─────────────────────────────────────────────────────────────────

describe('peer logs', () => {
  test('peer log section created for remote participant', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        clientId: 'c1',
        participants: [
          { clientId: 'c1', username: 'alice' },
          { clientId: 'c2', username: 'bob' },
        ],
      }),
    });
    localStorage.setItem('voice_username', 'alice');
    loadVoice(API);
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(10);

    expect(document.getElementById('peer-log-c2')).not.toBeNull();
    expect(document.getElementById('peer-log-entries-c2')).not.toBeNull();
  });

  test('no peer log section created for own card', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        clientId: 'c1',
        participants: [{ clientId: 'c1', username: 'alice' }],
      }),
    });
    localStorage.setItem('voice_username', 'alice');
    loadVoice(API);
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(5);

    expect(document.getElementById('peer-log-c1')).toBeNull();
  });

  test('ICE state change appends a log entry for the peer', async () => {
    let capturedPc;
    global.RTCPeerConnection = jest.fn().mockImplementation(() => {
      capturedPc = {
        iceGatheringState:          'complete',
        iceConnectionState:         'new',
        localDescription:           { sdp: 'mock-sdp' },
        addTrack:                   jest.fn(),
        createOffer:                jest.fn().mockResolvedValue({}),
        setLocalDescription:        jest.fn().mockResolvedValue(),
        setRemoteDescription:       jest.fn().mockResolvedValue(),
        createAnswer:               jest.fn().mockResolvedValue({}),
        close:                      jest.fn(),
        addEventListener:           jest.fn(),
        removeEventListener:        jest.fn(),
        oniceconnectionstatechange: null,
      };
      return capturedPc;
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        clientId: 'c1',
        participants: [
          { clientId: 'c1', username: 'alice' },
          { clientId: 'c2', username: 'bob' },
        ],
      }),
    });
    localStorage.setItem('voice_username', 'alice');
    loadVoice(API);
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(10);

    capturedPc.iceConnectionState = 'connected';
    capturedPc.oniceconnectionstatechange();

    const entries = document.getElementById('peer-log-entries-c2');
    const texts = Array.from(entries.children).map(e => e.textContent);
    expect(texts.some(t => t.includes('ICE → connected'))).toBe(true);
  });
});

// ── ontrack ──────────────────────────────────────────────────────────────────

describe('ontrack', () => {
  test('calls audio.play() when a remote track arrives', async () => {
    let capturedPc;
    global.RTCPeerConnection = jest.fn().mockImplementation(() => {
      capturedPc = {
        iceGatheringState: 'complete',
        localDescription: { sdp: 'mock-sdp' },
        addTrack: jest.fn(),
        createOffer: jest.fn().mockResolvedValue({}),
        setLocalDescription: jest.fn().mockResolvedValue(),
        setRemoteDescription: jest.fn().mockResolvedValue(),
        createAnswer: jest.fn().mockResolvedValue({}),
        close: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      };
      return capturedPc;
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        clientId: 'c1',
        participants: [{ clientId: 'c2', username: 'bob' }],
      }),
    });

    loadVoice(API);
    // Trigger join via form submit (user-gesture path)
    document.getElementById('voiceUsernameInput').value = 'alice';
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(10);

    expect(capturedPc.ontrack).toBeInstanceOf(Function);

    const mockStream = {};
    capturedPc.ontrack({ streams: [mockStream] });

    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  test('shows audioUnblockBtn when audio.play() is rejected', async () => {
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      writable: true,
      value: jest.fn().mockRejectedValue(new Error('autoplay blocked')),
    });

    let capturedPc;
    global.RTCPeerConnection = jest.fn().mockImplementation(() => {
      capturedPc = {
        iceGatheringState: 'complete',
        localDescription: { sdp: 'mock-sdp' },
        addTrack: jest.fn(),
        createOffer: jest.fn().mockResolvedValue({}),
        setLocalDescription: jest.fn().mockResolvedValue(),
        setRemoteDescription: jest.fn().mockResolvedValue(),
        createAnswer: jest.fn().mockResolvedValue({}),
        close: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      };
      return capturedPc;
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        clientId: 'c1',
        participants: [{ clientId: 'c2', username: 'bob' }],
      }),
    });

    loadVoice(API);
    document.getElementById('voiceUsernameInput').value = 'alice';
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(10);

    capturedPc.ontrack({ streams: [{}] });
    await flushPromises(3); // let the rejected promise settle

    expect(document.getElementById('audioUnblockBtn').hidden).toBe(false);
  });
});

// ── Session persistence ───────────────────────────────────────────────────────

describe('session persistence', () => {
  test('saves session to localStorage on successful join', async () => {
    localStorage.setItem('voice_username', 'alice');
    loadVoice(API);
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(5);

    const session = JSON.parse(localStorage.getItem('voice_session'));
    expect(session).not.toBeNull();
    expect(session.username).toBe('alice');
    expect(typeof session.clientId).toBe('string');
  });

  test('sends previousClientId when stored session username matches', async () => {
    localStorage.setItem('voice_username', 'alice');
    localStorage.setItem('voice_session', JSON.stringify({ clientId: 'prev-id', username: 'alice' }));
    loadVoice(API);
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(5);

    const joinCall = fetch.mock.calls.find(([url]) => url === `${API}/voice/join`);
    expect(joinCall).toBeDefined();
    const body = JSON.parse(joinCall[1].body);
    expect(body.previousClientId).toBe('prev-id');
  });

  test('does not send previousClientId when stored session username differs', async () => {
    localStorage.setItem('voice_username', 'alice');
    localStorage.setItem('voice_session', JSON.stringify({ clientId: 'prev-id', username: 'bob' }));
    loadVoice(API);
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(5);

    const joinCall = fetch.mock.calls.find(([url]) => url === `${API}/voice/join`);
    expect(joinCall).toBeDefined();
    const body = JSON.parse(joinCall[1].body);
    expect(body.previousClientId).toBeUndefined();
  });

  test('clears session from localStorage on leave', async () => {
    localStorage.setItem('voice_username', 'alice');
    loadVoice(API);
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(5);

    // Session should be saved now
    expect(localStorage.getItem('voice_session')).not.toBeNull();

    document.getElementById('leaveBtn').click();
    expect(localStorage.getItem('voice_session')).toBeNull();
  });
});

// ── TURN config ──────────────────────────────────────────────────────────────

describe('TURN config', () => {
  const turnCreds = { username: '1003600:c1', credential: 'hmacvalue' };

  test('makePc uses TURN config when turnReady: true and turnHost is provided', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        clientId: 'c1',
        participants: [{ clientId: 'c2', username: 'bob' }],
        turn: turnCreds,
        turnReady: true,
        turnHost: '1.2.3.4',
      }),
    });

    loadVoice(API);
    document.getElementById('voiceUsernameInput').value = 'alice';
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(10);

    expect(global.RTCPeerConnection).toHaveBeenCalledWith({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:1.2.3.4:3478', username: turnCreds.username, credential: turnCreds.credential },
      ],
    });
  });

  test('waitForTurn polls turn/status until ready, then uses returned host', async () => {
    global.fetch = jest.fn().mockImplementation((url) => {
      if (url.includes('/voice/join')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            clientId: 'c1',
            participants: [{ clientId: 'c2', username: 'bob' }],
            turn: turnCreds,
            turnReady: false,
          }),
        });
      }
      if (url.includes('/voice/turn/status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ready: true, host: '9.8.7.6' }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ participants: [] }) });
    });

    loadVoice(API);
    document.getElementById('voiceUsernameInput').value = 'alice';
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );

    // Let join fetch resolve and enter waitForTurn's first setTimeout
    await flushPromises(3);

    // Advance the 3000ms timer inside waitForTurn
    await jest.advanceTimersByTimeAsync(3000);
    await flushPromises(10);

    // turn/status should have been polled
    const statusCalls = fetch.mock.calls.filter(([url]) => url.includes('turn/status'));
    expect(statusCalls.length).toBeGreaterThan(0);

    // RTCPeerConnection should use the TURN host returned by the poll
    expect(global.RTCPeerConnection).toHaveBeenCalledWith({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:9.8.7.6:3478', username: turnCreds.username, credential: turnCreds.credential },
      ],
    });
  });

  test('makePc falls back to STUN-only when no turn field in join response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        clientId: 'c1',
        participants: [{ clientId: 'c2', username: 'bob' }],
        // no turn field
      }),
    });

    loadVoice(API);
    document.getElementById('voiceUsernameInput').value = 'alice';
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(10);

    // RTCPeerConnection called with STUN-only (no TURN server)
    const callArg = global.RTCPeerConnection.mock.calls[0]?.[0];
    expect(callArg.iceServers).toHaveLength(1);
    expect(callArg.iceServers[0].urls).toBe('stun:stun.l.google.com:19302');
  });
});

// ── createOffer ──────────────────────────────────────────────────────────────

describe('createOffer', () => {
  test('sends offer signal to /voice/signal for each existing participant', async () => {
    localStorage.setItem('voice_username', 'alice');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        clientId: 'c1',
        participants: [
          { clientId: 'c2', username: 'bob' },
        ],
      }),
    });

    loadVoice(API);
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(10);

    const signalCall = fetch.mock.calls.find(
      ([url]) => url === `${API}/voice/signal`
    );
    expect(signalCall).toBeDefined();
    const body = JSON.parse(signalCall[1].body);
    expect(body).toMatchObject({
      from: 'c1',
      to: 'c2',
      type: 'offer',
      roomId: 'main',
    });
  });
});

// ── Notification sounds ───────────────────────────────────────────────────────

describe('notification sounds', () => {
  // Helper: fetch mock that routes by URL
  function makeFetch({ joinParticipants, heartbeatParticipants }) {
    return jest.fn().mockImplementation((url) => {
      if (url.includes('/voice/join')) {
        return Promise.resolve({
          ok: true,
          json: jest.fn().mockResolvedValue({ clientId: 'c1', participants: joinParticipants }),
        });
      }
      if (url.includes('/voice/heartbeat')) {
        return Promise.resolve({
          ok: true,
          json: jest.fn().mockResolvedValue({ participants: heartbeatParticipants }),
        });
      }
      // /voice/signals (poll) and /voice/signal (offer/answer)
      return Promise.resolve({ ok: true, json: jest.fn().mockResolvedValue([]) });
    });
  }

  test('no chime on initial sync when joining alone', async () => {
    global.fetch = makeFetch({
      joinParticipants: [{ clientId: 'c1', username: 'alice' }],
      heartbeatParticipants: [{ clientId: 'c1', username: 'alice' }],
    });

    loadVoice(API);
    document.getElementById('voiceUsernameInput').value = 'alice';
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(10);

    const mockCtx = global.AudioContext.mock.results[0].value;
    expect(mockCtx.createOscillator).not.toHaveBeenCalled();
  });

  test('ascending chime plays when a new participant joins via heartbeat', async () => {
    global.fetch = makeFetch({
      joinParticipants: [{ clientId: 'c1', username: 'alice' }],
      heartbeatParticipants: [
        { clientId: 'c1', username: 'alice' },
        { clientId: 'c2', username: 'bob' },
      ],
    });

    loadVoice(API);
    document.getElementById('voiceUsernameInput').value = 'alice';
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(10);

    const mockCtx = global.AudioContext.mock.results[0].value;
    expect(mockCtx.createOscillator).not.toHaveBeenCalled();

    jest.advanceTimersByTime(15000); // trigger heartbeat
    await flushPromises(10);

    // playChime(true) creates one oscillator per tone (2 tones)
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2);
  });

  test('descending chime plays when a participant leaves via heartbeat', async () => {
    global.fetch = makeFetch({
      joinParticipants: [
        { clientId: 'c1', username: 'alice' },
        { clientId: 'c2', username: 'bob' },
      ],
      heartbeatParticipants: [{ clientId: 'c1', username: 'alice' }],
    });

    loadVoice(API);
    document.getElementById('voiceUsernameInput').value = 'alice';
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(10);

    const mockCtx = global.AudioContext.mock.results[0].value;
    expect(mockCtx.createOscillator).not.toHaveBeenCalled();

    jest.advanceTimersByTime(15000); // trigger heartbeat
    await flushPromises(10);

    // playChime(false) creates one oscillator per tone (2 tones)
    expect(mockCtx.createOscillator).toHaveBeenCalledTimes(2);
  });

  test('no chime when heartbeat returns only self (myClientId)', async () => {
    global.fetch = makeFetch({
      joinParticipants: [{ clientId: 'c1', username: 'alice' }],
      heartbeatParticipants: [{ clientId: 'c1', username: 'alice' }],
    });

    loadVoice(API);
    document.getElementById('voiceUsernameInput').value = 'alice';
    document.getElementById('voiceGateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushPromises(10);

    jest.advanceTimersByTime(15000); // trigger heartbeat
    await flushPromises(10);

    const mockCtx = global.AudioContext.mock.results[0].value;
    expect(mockCtx.createOscillator).not.toHaveBeenCalled();
  });
});
