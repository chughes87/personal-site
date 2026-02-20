/**
 * @jest-environment jsdom
 */

const HTML = `
  <div id="chatGate">
    <form id="gateForm">
      <input id="usernameInput" />
    </form>
  </div>
  <div id="chatUI" hidden>
    <span id="displayName"></span>
    <button id="renameBtn"></button>
    <div id="chatMessages">
      <p id="chatEmpty"></p>
    </div>
    <form id="chatForm">
      <input id="messageInput" />
      <button id="sendBtn"></button>
      <span id="charCount">0</span>
    </form>
  </div>
`;

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  document.body.innerHTML = HTML;
  localStorage.clear();
  window.CHAT_API_BASE = '';
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: jest.fn().mockResolvedValue([]),
  });
});

afterEach(() => {
  jest.useRealTimers();
});

function loadChat(apiBase = '') {
  window.CHAT_API_BASE = apiBase;
  require('../../src/chat');
}

describe('initial gate / chat display', () => {
  test('shows gate and hides chat when no saved username', () => {
    loadChat();
    expect(document.getElementById('chatGate').hidden).toBe(false);
    expect(document.getElementById('chatUI').hidden).toBe(true);
  });

  test('shows chat and hides gate when username is saved', () => {
    localStorage.setItem('chat_username', 'alice');
    loadChat();
    expect(document.getElementById('chatUI').hidden).toBe(false);
    expect(document.getElementById('chatGate').hidden).toBe(true);
    expect(document.getElementById('displayName').textContent).toBe('alice');
  });
});

describe('gate form', () => {
  test('saves username and transitions to chat on submit', () => {
    loadChat();
    document.getElementById('usernameInput').value = 'bob';
    document.getElementById('gateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    expect(localStorage.getItem('chat_username')).toBe('bob');
    expect(document.getElementById('chatUI').hidden).toBe(false);
    expect(document.getElementById('displayName').textContent).toBe('bob');
  });

  test('trims whitespace from submitted username', () => {
    loadChat();
    document.getElementById('usernameInput').value = '  carol  ';
    document.getElementById('gateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    expect(localStorage.getItem('chat_username')).toBe('carol');
    expect(document.getElementById('displayName').textContent).toBe('carol');
  });

  test('does nothing when submitted username is empty', () => {
    loadChat();
    document.getElementById('usernameInput').value = '';
    document.getElementById('gateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    expect(document.getElementById('chatUI').hidden).toBe(true);
    expect(localStorage.getItem('chat_username')).toBeNull();
  });

  test('does nothing when submitted username is whitespace only', () => {
    loadChat();
    document.getElementById('usernameInput').value = '   ';
    document.getElementById('gateForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    expect(document.getElementById('chatUI').hidden).toBe(true);
  });
});

describe('rename button', () => {
  test('clicking rename returns to gate screen', () => {
    localStorage.setItem('chat_username', 'alice');
    loadChat();
    expect(document.getElementById('chatUI').hidden).toBe(false);

    document.getElementById('renameBtn').click();

    expect(document.getElementById('chatGate').hidden).toBe(false);
    expect(document.getElementById('chatUI').hidden).toBe(true);
  });
});

describe('message input', () => {
  test('charCount reflects input length', () => {
    localStorage.setItem('chat_username', 'alice');
    loadChat();

    const input = document.getElementById('messageInput');
    input.value = 'hello world';
    input.dispatchEvent(new Event('input'));

    expect(document.getElementById('charCount').textContent).toBe('11');
  });

  test('charCount updates to 0 when input is cleared', () => {
    localStorage.setItem('chat_username', 'alice');
    loadChat();

    const input = document.getElementById('messageInput');
    input.value = 'some text';
    input.dispatchEvent(new Event('input'));
    input.value = '';
    input.dispatchEvent(new Event('input'));

    expect(document.getElementById('charCount').textContent).toBe('0');
  });
});

describe('send form — API not configured', () => {
  test('shows notice instead of fetching when API_BASE is empty', () => {
    localStorage.setItem('chat_username', 'alice');
    loadChat(''); // empty API_BASE

    document.getElementById('messageInput').value = 'hello';
    document.getElementById('chatForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );

    expect(fetch).not.toHaveBeenCalled();
    const notice = document.querySelector('.chat-notice--error');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toMatch(/not configured/i);
  });
});

describe('XSS prevention', () => {
  test('usernames and content are HTML-escaped when messages are rendered', async () => {
    localStorage.setItem('chat_username', 'alice');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue([
        {
          id: '1',
          username: '<script>alert(1)</script>',
          content: '<img src=x onerror=alert(1)>',
          ts: 1000,
        },
      ]),
    });

    loadChat('https://api.example.com');

    // Flush microtasks so the async fetch + json() calls resolve
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const html = document.getElementById('chatMessages').innerHTML;
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });
});
