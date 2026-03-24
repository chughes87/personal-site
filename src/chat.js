// ── Config ─────────────────────────────────────────────────────────────────
const API_BASE     = (window.CHAT_API_BASE || '').replace(/\/$/, '');
const USERNAME_KEY = 'chat_username';
const POLL_MS      = 3000;

// ── DOM ────────────────────────────────────────────────────────────────────
const chatGate    = document.getElementById('chatGate');
const gateForm    = document.getElementById('gateForm');
const usernameInput = document.getElementById('usernameInput');

const chatUI      = document.getElementById('chatUI');
const displayName = document.getElementById('displayName');
const renameBtn   = document.getElementById('renameBtn');

const chatMessages = document.getElementById('chatMessages');
const chatEmpty    = document.getElementById('chatEmpty');

const chatForm    = document.getElementById('chatForm');
const messageInput = document.getElementById('messageInput');
const sendBtn     = document.getElementById('sendBtn');
const charCount   = document.getElementById('charCount');

// ── State ──────────────────────────────────────────────────────────────────
let lastTs   = 0;
let pollTimer = null;
const seen   = new Set(); // dedup by `ts#id`

// ── Terminal renderer ──────────────────────────────────────────────────────
var chatRenderer = null;

var NAV_ITEMS = [
  { label: 'About',    href: '/#about' },
  { label: 'Skills',   href: '/#skills' },
  { label: 'Projects', href: '/#projects' },
  { label: 'Contact',  href: '/#contact' },
  { label: 'Chat',     href: '/chat.html' },
  { label: 'Voice',    href: '/voice.html' }
];

function chatPage(ctx) {
  var C = window.TerminalColors;
  ctx.nav(NAV_ITEMS);
  ctx.spacer(1);
  ctx.centerText('# general', { fg: C.yellow, bold: true });
  ctx.rule();
  // Middle area left empty — message overlay covers it
  ctx.spacer(Math.max(1, ctx.r.rows - ctx.row - 4));
  ctx.rule();
  ctx.centerText('pointfree.space/chat', { fg: C.muted });
  ctx.spacer(1);
}

function gatePage(ctx) {
  var C = window.TerminalColors;
  ctx.nav(NAV_ITEMS);
  var midRow = Math.floor(ctx.r.rows / 2) - 3;
  if (midRow > ctx.row) ctx.spacer(midRow - ctx.row);
  ctx.centerText('Join the chat', { fg: C.yellow, bold: true });
  ctx.spacer(1);
  ctx.centerText('Pick a display name to get started.', { fg: C.muted });
  ctx.spacer(2);
}

function initTerminal() {
  var pre = document.getElementById('chatTerminal');
  if (!pre || !window.TerminalRenderer) return;
  chatRenderer = new window.TerminalRenderer(pre);
  chatRenderer.measureCell();
  chatRenderer.resize();
}

function renderTerminal(pageFn) {
  if (!chatRenderer) return;
  chatRenderer.render(pageFn);
  positionOverlays();
}

function positionOverlays() {
  if (!chatRenderer || !chatRenderer.cellH) return;
  var cellH = chatRenderer.cellH;
  // Nav (row 0-2) + spacer + title + rule = ~6 rows of chrome at top
  // Bottom: rule + footer + spacer = ~3 rows of chrome
  var topRows = 6;
  var bottomRows = 3;
  var top = topRows * cellH;
  var bottom = bottomRows * cellH;

  chatMessages.style.top = top + 'px';
  chatMessages.style.bottom = bottom + 'px';

  if (chatGate && !chatGate.hidden) {
    // Gate form positioned in center
    chatGate.style.top = top + 'px';
    chatGate.style.bottom = bottom + 'px';
  }
}

// ── Username ───────────────────────────────────────────────────────────────
function getUsername()     { return localStorage.getItem(USERNAME_KEY); }
function saveUsername(name) { localStorage.setItem(USERNAME_KEY, name); }

function showGate() {
  stopPolling();
  chatUI.hidden = true;
  chatGate.hidden = false;
  usernameInput.value = getUsername() || '';
  usernameInput.focus();
  renderTerminal(gatePage);
}

function showChat(name) {
  displayName.textContent = name;
  chatGate.hidden = true;
  chatUI.hidden = false;
  messageInput.focus();
  renderTerminal(chatPage);
  startPolling();
}

gateForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = usernameInput.value.trim();
  if (!name) return;
  saveUsername(name);
  showChat(name);
});

renameBtn.addEventListener('click', showGate);

// ── Rendering ──────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function appendMessage({ id, username, content, ts }) {
  const key = `${ts}#${id}`;
  if (seen.has(key)) return;
  seen.add(key);

  chatEmpty.hidden = true;

  const isSelf = username === getUsername();
  const el = document.createElement('div');
  el.className = 'chat-msg' + (isSelf ? ' chat-msg--self' : '');
  el.innerHTML =
    '<span class="chat-msg-time">' + formatTime(ts) + '</span> ' +
    '<span class="chat-msg-author">&lt;' + esc(username) + '&gt;</span> ' +
    '<span class="chat-msg-text">' + esc(content) + '</span>';
  chatMessages.appendChild(el);

  // Only auto-scroll if already near the bottom
  const { scrollTop, scrollHeight, clientHeight } = chatMessages;
  if (scrollHeight - scrollTop - clientHeight < 120) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function appendNotice(text, isError = false) {
  const el = document.createElement('p');
  el.className = 'chat-notice' + (isError ? ' chat-notice--error' : '');
  el.textContent = text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  setTimeout(() => el.remove(), 5000);
}

// ── Polling ────────────────────────────────────────────────────────────────
async function fetchMessages() {
  if (!API_BASE || API_BASE.includes('TODO')) return;
  try {
    const url = `${API_BASE}/messages` + (lastTs ? `?since=${lastTs}` : '');
    const res = await fetch(url);
    if (!res.ok) return;
    const msgs = await res.json();
    msgs.forEach(m => {
      appendMessage(m);
      if (m.ts > lastTs) lastTs = m.ts;
    });
  } catch (_) { /* retry next tick */ }
}

function startPolling() {
  fetchMessages();
  pollTimer = setInterval(() => {
    if (!document.hidden) fetchMessages();
  }, POLL_MS);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

// ── Send ───────────────────────────────────────────────────────────────────
chatForm.addEventListener('submit', async e => {
  e.preventDefault();
  if (!API_BASE || API_BASE.includes('TODO')) {
    appendNotice('Chat API not configured yet.', true);
    return;
  }

  const content = messageInput.value.trim();
  if (!content) return;

  sendBtn.disabled = true;
  messageInput.value = '';
  charCount.textContent = '0';

  try {
    const res = await fetch(`${API_BASE}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: getUsername(), content }),
    });

    if (res.status === 429) {
      appendNotice('Rate limit reached — try again in an hour.', true);
      messageInput.value = content;
      charCount.textContent = content.length;
    } else if (!res.ok) {
      appendNotice('Failed to send. Try again.', true);
      messageInput.value = content;
      charCount.textContent = content.length;
    } else {
      const msg = await res.json();
      appendMessage(msg);
      if (msg.ts > lastTs) lastTs = msg.ts;
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  } catch (_) {
    appendNotice('Network error. Try again.', true);
    messageInput.value = content;
    charCount.textContent = content.length;
  } finally {
    sendBtn.disabled = false;
    messageInput.focus();
  }
});

messageInput.addEventListener('input', () => {
  charCount.textContent = messageInput.value.length;
});

// ── Resize ─────────────────────────────────────────────────────────────────
if (chatRenderer) {
  window.addEventListener('resize', function () {
    clearTimeout(chatRenderer._resizeTimer);
    chatRenderer._resizeTimer = setTimeout(function () {
      chatRenderer.resize();
      if (!chatUI.hidden) {
        renderTerminal(chatPage);
      } else {
        renderTerminal(gatePage);
      }
    }, 150);
  });
}

// ── Init ───────────────────────────────────────────────────────────────────
initTerminal();

const savedUsername = getUsername();
if (savedUsername) {
  showChat(savedUsername);
} else {
  showGate();
}
