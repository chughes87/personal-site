/**
 * @jest-environment jsdom
 */

const HTML = `
  <div id="voiceGate" hidden>
    <form id="voiceGateForm">
      <input id="voiceUsernameInput" />
      <button type="submit">Join</button>
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
});

afterEach(() => {
  jest.useRealTimers();
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
    loadVoice('https://api.example.com');
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
