// Dynamic copyright year
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// ── Theme toggle ──────────────────────────────────────────────────────────────
const THEME_KEY = 'theme';
const toggle = document.getElementById('themeToggle');
const icon = toggle.querySelector('.theme-icon');

function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  icon.textContent = dark ? '☀' : '☾';
  toggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
}

// Resolve initial theme: saved preference → OS preference → light
const saved = localStorage.getItem(THEME_KEY);
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const isDark = saved ? saved === 'dark' : prefersDark;
applyTheme(isDark);

toggle.addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  applyTheme(dark);
  localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
});

// Keep in sync if the user changes OS preference while the tab is open
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
  if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches);
});
