/**
 * @jest-environment jsdom
 */

const HTML = `
  <span id="year"></span>
  <button id="themeToggle"><span class="theme-icon"></span></button>
`;

let matchMediaListeners = [];
let matchMediaMatches = false;

beforeEach(() => {
  jest.resetModules();
  document.body.innerHTML = HTML;
  localStorage.clear();
  matchMediaListeners = [];
  matchMediaMatches = false;

  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn(() => ({
      matches: matchMediaMatches,
      addEventListener: (_, fn) => matchMediaListeners.push(fn),
    })),
  });
});

function loadMain() {
  require('../../src/main');
}

test('sets year element to the current year', () => {
  loadMain();
  expect(document.getElementById('year').textContent).toBe(String(new Date().getFullYear()));
});

describe('initial theme', () => {
  test('applies dark theme when localStorage has "dark"', () => {
    localStorage.setItem('theme', 'dark');
    loadMain();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.querySelector('.theme-icon').textContent).toBe('☀');
    expect(document.getElementById('themeToggle').getAttribute('aria-label')).toBe('Switch to light theme');
  });

  test('applies light theme when localStorage has "light"', () => {
    localStorage.setItem('theme', 'light');
    loadMain();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.querySelector('.theme-icon').textContent).toBe('☾');
    expect(document.getElementById('themeToggle').getAttribute('aria-label')).toBe('Switch to dark theme');
  });

  test('uses OS dark preference when no saved theme', () => {
    matchMediaMatches = true;
    loadMain();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  test('defaults to light when OS prefers light and no saved theme', () => {
    matchMediaMatches = false;
    loadMain();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('theme toggle', () => {
  test('click switches from light to dark and saves to localStorage', () => {
    loadMain();
    expect(document.documentElement.dataset.theme).toBe('light');

    document.getElementById('themeToggle').click();

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  test('click switches from dark to light and saves to localStorage', () => {
    localStorage.setItem('theme', 'dark');
    loadMain();

    document.getElementById('themeToggle').click();

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
  });

  test('repeated toggles keep cycling and persisting theme', () => {
    loadMain();
    const btn = document.getElementById('themeToggle');

    btn.click();
    expect(document.documentElement.dataset.theme).toBe('dark');

    btn.click();
    expect(document.documentElement.dataset.theme).toBe('light');

    btn.click();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('OS preference change listener', () => {
  test('updates theme when OS preference changes and no saved preference', () => {
    loadMain();
    expect(document.documentElement.dataset.theme).toBe('light');

    matchMediaListeners.forEach(fn => fn({ matches: true }));

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  test('ignores OS preference change when user has a saved preference', () => {
    localStorage.setItem('theme', 'light');
    loadMain();

    matchMediaListeners.forEach(fn => fn({ matches: true }));

    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
