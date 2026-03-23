/**
 * @jest-environment jsdom
 */

let TerminalRenderer, LayoutContext, indexPage, repeat, escapeHtml, C;

beforeEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
  document.body.innerHTML = '<div id="terminalWrap"><pre id="terminal"></pre></div>';

  Object.defineProperty(document.getElementById('terminalWrap'), 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(document.getElementById('terminalWrap'), 'clientHeight', { value: 600, configurable: true });

  var mod = require('../../src/terminal');
  TerminalRenderer = mod.TerminalRenderer;
  LayoutContext = mod.LayoutContext;
  indexPage = mod.indexPage;
  repeat = mod.repeat;
  escapeHtml = mod.escapeHtml;
  C = mod.C;
});

function mockMeasure(renderer) {
  renderer.measureCell = function () {
    this.cellW = 8;
    this.cellH = 16;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

describe('helpers', () => {
  test('repeat generates correct string', () => {
    expect(repeat('x', 5)).toBe('xxxxx');
    expect(repeat('-', 0)).toBe('');
    expect(repeat('ab', 3)).toBe('ababab');
  });

  test('escapeHtml escapes special characters', () => {
    expect(escapeHtml('<div>"a&b"</div>')).toBe('&lt;div&gt;&quot;a&amp;b&quot;&lt;/div&gt;');
  });
});

// ── Low-level renderer ───────────────────────────────────────────────────────

describe('TerminalRenderer', () => {
  let renderer, pre;

  beforeEach(() => {
    pre = document.getElementById('terminal');
    renderer = new TerminalRenderer(pre);
  });

  test('measureCell sets cellW and cellH from probe element', () => {
    mockMeasure(renderer);
    renderer.measureCell();
    expect(renderer.cellW).toBe(8);
    expect(renderer.cellH).toBe(16);
  });

  test('resize calculates cols and rows from viewport', () => {
    mockMeasure(renderer);
    renderer.resize();
    expect(renderer.cols).toBe(100);
    expect(renderer.rows).toBe(37);
  });

  test('allocate creates buffer of correct dimensions', () => {
    renderer.cols = 40;
    renderer.allocate(10);
    expect(renderer.buffer.length).toBe(10);
    expect(renderer.buffer[0].length).toBe(40);
    expect(renderer.meta.length).toBe(10);
    expect(renderer.meta[0].length).toBe(40);
  });

  test('write places characters at correct positions', () => {
    renderer.cols = 40;
    renderer.allocate(5);
    renderer.write(2, 5, 'hello', { fg: '#ff0000', bold: true });
    expect(renderer.buffer[2][5].ch).toBe('h');
    expect(renderer.buffer[2][6].ch).toBe('e');
    expect(renderer.buffer[2][9].ch).toBe('o');
    expect(renderer.buffer[2][5].fg).toBe('#ff0000');
    expect(renderer.buffer[2][5].bold).toBe(true);
  });

  test('write clips text that extends beyond cols', () => {
    renderer.cols = 10;
    renderer.allocate(3);
    renderer.write(0, 8, 'abcdef');
    expect(renderer.buffer[0][8].ch).toBe('a');
    expect(renderer.buffer[0][9].ch).toBe('b');
  });

  test('write ignores out-of-bounds rows', () => {
    renderer.cols = 10;
    renderer.allocate(3);
    renderer.write(-1, 0, 'test');
    renderer.write(5, 0, 'test');
  });

  test('writeBlock writes multiple lines', () => {
    renderer.cols = 20;
    renderer.allocate(5);
    renderer.writeBlock(1, 2, ['AB', 'CD'], { fg: '#00ff00' });
    expect(renderer.buffer[1][2].ch).toBe('A');
    expect(renderer.buffer[1][3].ch).toBe('B');
    expect(renderer.buffer[2][2].ch).toBe('C');
    expect(renderer.buffer[2][3].ch).toBe('D');
  });

  test('addLink registers metadata and groups', () => {
    renderer.cols = 30;
    renderer.allocate(3);
    renderer.addLink(1, 5, 4, 'https://example.com', 'grp1');
    expect(renderer.meta[1][5].href).toBe('https://example.com');
    expect(renderer.meta[1][5].group).toBe('grp1');
    expect(renderer.meta[1][8].group).toBe('grp1');
    expect(renderer.meta[1][9]).toBeNull();
    expect(renderer.groups['grp1'].cells.length).toBe(4);
  });

  test('flush generates HTML with spans', () => {
    renderer.cols = 5;
    renderer.allocate(1);
    renderer.write(0, 0, 'hi', { fg: '#ff0000' });
    renderer.flush();
    expect(pre.innerHTML).toContain('hi');
    expect(pre.innerHTML).toContain('#ff0000');
  });

  test('flush escapes HTML in content', () => {
    renderer.cols = 10;
    renderer.allocate(1);
    renderer.write(0, 0, '<b>xss</b>');
    renderer.flush();
    expect(pre.innerHTML).toContain('&lt;b&gt;');
    expect(pre.innerHTML).not.toContain('<b>');
  });

  test('pixelToGrid converts coordinates correctly', () => {
    renderer.cellW = 8;
    renderer.cellH = 16;
    var pos = renderer.pixelToGrid(20, 40);
    expect(pos.col).toBe(2);
    expect(pos.row).toBe(2);
  });

  test('writeWrapped breaks long text across rows', () => {
    renderer.cols = 30;
    renderer.allocate(10);
    var endRow = renderer.writeWrapped(0, 2, 'the quick brown fox jumps over the lazy dog', 15, {});
    expect(endRow).toBeGreaterThan(2);
    expect(renderer.buffer[0][2].ch).toBe('t');
  });

  test('flush trims trailing whitespace spans', () => {
    renderer.cols = 10;
    renderer.allocate(1);
    renderer.write(0, 0, 'hi', { fg: '#ff0000' });
    renderer.flush();
    // "hi" is at cols 0-1; cols 2-9 are default spaces — should be trimmed
    var spans = pre.querySelectorAll('span');
    var totalChars = 0;
    spans.forEach(function (s) { totalChars += s.textContent.length; });
    expect(totalChars).toBe(2);
  });

  test('flush creates per-row div elements and populates rowEls', () => {
    renderer.cols = 10;
    renderer.allocate(3);
    renderer.write(0, 0, 'AAA');
    renderer.write(2, 0, 'CCC');
    renderer.flush();
    expect(renderer.rowEls.length).toBe(3);
    expect(pre.children.length).toBe(3);
    expect(pre.children[0].tagName).toBe('DIV');
    expect(pre.children[0].innerHTML).toContain('AAA');
    expect(pre.children[2].innerHTML).toContain('CCC');
  });

  test('flushRows updates only specified rows', () => {
    renderer.cols = 20;
    renderer.allocate(3);
    renderer.write(0, 0, 'row0');
    renderer.write(1, 0, 'row1');
    renderer.write(2, 0, 'row2');
    renderer.flush();

    var row0Before = renderer.rowEls[0].innerHTML;
    var row2Before = renderer.rowEls[2].innerHTML;

    // Modify buffer for row 1 only
    renderer.write(1, 0, 'CHANGED', { fg: '#ff0000' });
    renderer.flushRows([1]);

    expect(renderer.rowEls[0].innerHTML).toBe(row0Before);
    expect(renderer.rowEls[2].innerHTML).toBe(row2Before);
    expect(renderer.rowEls[1].innerHTML).toContain('CHANGED');
  });

  test('addLink tracks rows per group', () => {
    renderer.cols = 30;
    renderer.allocate(5);
    renderer.addLink(1, 0, 3, 'https://x.com', 'g1');
    renderer.addLink(3, 0, 3, 'https://x.com', 'g1');
    expect(renderer.groups['g1'].rows).toEqual([1, 3]);
  });

  test('hover changes hovered group and re-renders', () => {
    renderer.cols = 30;
    renderer.allocate(3);
    renderer.write(1, 5, 'link', { fg: '#0ff' });
    renderer.addLink(1, 5, 4, 'https://x.com', 'test_link');
    renderer.flush();

    var before = pre.innerHTML;
    renderer.hoveredGroup = 'test_link';
    renderer.flush();
    var after = pre.innerHTML;

    expect(after).not.toBe(before);
  });
});

// ── LayoutContext ─────────────────────────────────────────────────────────────

describe('LayoutContext', () => {
  let renderer, ctx;

  beforeEach(() => {
    renderer = new TerminalRenderer(document.getElementById('terminal'));
    renderer.cols = 80;
    renderer.allocate(100);
    ctx = new LayoutContext(renderer);
  });

  test('spacer advances the cursor', () => {
    expect(ctx.row).toBe(0);
    ctx.spacer(3);
    expect(ctx.row).toBe(3);
    ctx.spacer();
    expect(ctx.row).toBe(4);
  });

  test('rule draws a horizontal line and advances cursor', () => {
    ctx.rule();
    expect(renderer.buffer[0][0].ch).toBe('─');
    expect(renderer.buffer[0][79].ch).toBe('─');
    expect(ctx.row).toBe(1);
  });

  test('centerText centers text and advances cursor', () => {
    ctx.centerText('hi', { fg: '#fff' });
    expect(renderer.buffer[0][39].ch).toBe('h');
    expect(renderer.buffer[0][40].ch).toBe('i');
    expect(ctx.row).toBe(1);
  });

  test('text wraps text at content width and advances cursor', () => {
    ctx.text('hello world');
    expect(ctx.row).toBe(1);
    // Text should be written at pad offset
    expect(renderer.buffer[0][ctx.pad].ch).toBe('h');
  });

  test('link writes clickable text', () => {
    ctx.link('> click me', 'https://example.com');
    expect(renderer.buffer[0][ctx.pad].ch).toBe('>');
    expect(renderer.meta[0][ctx.pad].href).toBe('https://example.com');
    expect(ctx.row).toBe(1);
  });

  test('asciiArt centers multiline block', () => {
    ctx.asciiArt(['AAA', 'BBB'], { style: { fg: '#ff0' } });
    expect(ctx.row).toBe(2);
  });

  test('asciiArt uses fallback for narrow screens', () => {
    renderer.cols = 40;
    ctx = new LayoutContext(renderer);
    ctx.asciiArt(['WIDE_ART_PLACEHOLDER'], {
      fallback: ['SM'],
      minCols: 60,
      style: { fg: '#ff0' }
    });
    // Should have used the small fallback (2 chars), not the wide one
    var col = Math.floor((40 - 2) / 2);
    expect(renderer.buffer[0][col].ch).toBe('S');
    expect(ctx.row).toBe(1);
  });

  test('button draws a centered box-drawn button', () => {
    ctx.button('OK', 'https://x.com');
    // ┌────┐ │ OK │ └────┘ — 3 rows
    expect(ctx.row).toBe(3);
    var w = 6; // "OK".length + 4
    var col = Math.floor((80 - w) / 2);
    expect(renderer.buffer[0][col].ch).toBe('┌');
    expect(renderer.meta[1][col].group).toBe('btn_OK');
  });

  test('buttonRow draws multiple buttons side by side', () => {
    ctx.buttonRow([
      { label: 'A', href: '#a' },
      { label: 'B', href: '#b' }
    ]);
    expect(ctx.row).toBe(3);
    // Both buttons should be linked
    expect(Object.keys(renderer.groups)).toContain('btn_A');
    expect(Object.keys(renderer.groups)).toContain('btn_B');
  });

  test('section draws rule, title, and content', () => {
    ctx.section('test', 'TEST', function () {
      ctx.text('body text');
    });
    expect(renderer.sectionOffsets['test']).toBeDefined();
    // Should contain the title
    var found = false;
    for (var c = 0; c < 80; c++) {
      if (renderer.buffer[2][c].ch === '>' && renderer.buffer[2][c + 1].ch === '>') {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test('boxGrid draws titled boxes', () => {
    ctx.boxGrid([
      { title: 'Box1', items: ['a', 'b'] },
      { title: 'Box2', items: ['c', 'd'] }
    ], { width: 12, gap: 2 });
    // 1 title + 2 items + 1 bottom = 4 rows
    expect(ctx.row).toBe(4);
  });

  test('card draws a box with lines', () => {
    ctx.card({
      lines: [
        { text: 'Title', style: { fg: '#fff', bold: true } },
        { blank: true },
        { text: 'Desc' }
      ]
    });
    // top + 3 lines + bottom = 5
    expect(ctx.row).toBe(5);
  });

  test('card with link adds clickable text below', () => {
    ctx.card({
      lines: [{ text: 'X' }],
      link: { text: '> source', href: 'https://example.com' }
    });
    // top + 1 line + bottom + link = 4
    expect(ctx.row).toBe(4);
    // The link row should have metadata
    expect(renderer.meta[3][Math.floor((80 - 56) / 2)].href).toBe('https://example.com');
  });

  test('nav draws logo and nav items', () => {
    ctx.nav([
      { label: 'About', href: '#about' },
      { label: 'Chat', href: '/chat.html' }
    ]);
    // spacer + content + spacer + doubleRule = row 3
    expect(ctx.row).toBe(3);
    // CH logo should be at row 1, col 1
    expect(renderer.buffer[1][1].ch).toBe('C');
    expect(renderer.buffer[1][2].ch).toBe('H');
  });

  test('footer draws a rule and centered text', () => {
    ctx.footer();
    expect(ctx.row).toBe(3); // rule + text + spacer
  });
});

// ── Full page render ─────────────────────────────────────────────────────────

describe('indexPage', () => {
  test('renders complete page with all sections', () => {
    var pre = document.getElementById('terminal');
    var renderer = new TerminalRenderer(pre);
    mockMeasure(renderer);
    renderer.resize();
    renderer.render(indexPage);

    var html = pre.innerHTML;
    expect(html).toContain('██');
    expect(html).toContain('Senior Software Engineer');
    expect(html).toContain('ABOUT');
    expect(html).toContain('SKILLS');
    expect(html).toContain('PROJECTS');
    expect(html).toContain('CONTACT');
  });

  test('populates section offsets', () => {
    var renderer = new TerminalRenderer(document.getElementById('terminal'));
    mockMeasure(renderer);
    renderer.resize();
    renderer.render(indexPage);

    expect(typeof renderer.sectionOffsets['about']).toBe('number');
    expect(typeof renderer.sectionOffsets['skills']).toBe('number');
    expect(typeof renderer.sectionOffsets['projects']).toBe('number');
    expect(typeof renderer.sectionOffsets['contact']).toBe('number');
  });
});

// ── main.js guard ────────────────────────────────────────────────────────────

describe('main.js guard', () => {
  test('main.js does not throw when themeToggle is missing', () => {
    jest.resetModules();
    document.body.innerHTML = '<div id="terminalWrap"><pre id="terminal"></pre></div>';
    expect(() => require('../../src/main')).not.toThrow();
  });
});
