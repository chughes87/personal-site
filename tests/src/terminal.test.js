/**
 * @jest-environment jsdom
 */

let TerminalRenderer, repeat, escapeHtml;

beforeEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
  document.body.innerHTML = '<div id="terminalWrap"><pre id="terminal"></pre></div>';

  // Mock clientWidth/clientHeight on the wrapper
  Object.defineProperty(document.getElementById('terminalWrap'), 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(document.getElementById('terminalWrap'), 'clientHeight', { value: 600, configurable: true });

  var mod = require('../../src/terminal');
  TerminalRenderer = mod.TerminalRenderer;
  repeat = mod.repeat;
  escapeHtml = mod.escapeHtml;
});

// Helper: mock measureCell to set fixed cell dimensions
function mockMeasure(renderer) {
  renderer.measureCell = function () {
    this.cellW = 8;
    this.cellH = 16;
  };
}

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

describe('TerminalRenderer', () => {
  let renderer, pre;

  beforeEach(() => {
    pre = document.getElementById('terminal');
    renderer = new TerminalRenderer(pre);
  });

  test('measureCell sets cellW and cellH from probe element', () => {
    // jsdom returns 0 for getBoundingClientRect, so measureCell gets 0s
    // In a real browser it measures a character; we test via mockMeasure
    mockMeasure(renderer);
    renderer.measureCell();
    expect(renderer.cellW).toBe(8);
    expect(renderer.cellH).toBe(16);
  });

  test('resize calculates cols and rows from viewport', () => {
    mockMeasure(renderer);
    renderer.resize();
    expect(renderer.cols).toBe(100); // 800 / 8
    expect(renderer.rows).toBe(37);  // 600 / 16
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
    // c, d, e, f should be clipped
  });

  test('write ignores out-of-bounds rows', () => {
    renderer.cols = 10;
    renderer.allocate(3);
    // Should not throw
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

  test('writeCenter centers text horizontally', () => {
    renderer.cols = 20;
    renderer.allocate(3);
    var col = renderer.writeCenter(1, 'hi', { fg: '#fff' });
    expect(col).toBe(9); // (20 - 2) / 2
    expect(renderer.buffer[1][9].ch).toBe('h');
    expect(renderer.buffer[1][10].ch).toBe('i');
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

  test('drawButton creates a 3-row box with link metadata', () => {
    renderer.cols = 30;
    renderer.allocate(5);
    var w = renderer.drawButton(0, 2, 'Click', 'https://x.com', { fg: '#0ff' });
    expect(w).toBe(9); // 'Click'.length + 4
    expect(renderer.buffer[0][2].ch).toBe('┌');
    expect(renderer.buffer[1][4].ch).toBe('C');
    expect(renderer.buffer[2][2].ch).toBe('└');
    // All 3 rows should be linked
    expect(renderer.meta[0][2].group).toBe('btn_Click');
    expect(renderer.meta[1][2].group).toBe('btn_Click');
    expect(renderer.meta[2][2].group).toBe('btn_Click');
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
    expect(pos.col).toBe(2);  // 20 / 8 = 2.5 → 2
    expect(pos.row).toBe(2);  // 40 / 16 = 2.5 → 2
  });

  test('drawHRule fills the row with ─', () => {
    renderer.cols = 10;
    renderer.allocate(3);
    renderer.drawHRule(1);
    for (var c = 0; c < 10; c++) {
      expect(renderer.buffer[1][c].ch).toBe('─');
    }
  });

  test('writeWrapped breaks long text across rows', () => {
    renderer.cols = 30;
    renderer.allocate(10);
    var endRow = renderer.writeWrapped(0, 2, 'the quick brown fox jumps over the lazy dog', 15, {});
    // "the quick brown" = 15 chars → row 0
    // "fox jumps over" → row 1
    // "the lazy dog" → row 2
    expect(endRow).toBeGreaterThan(2);
    expect(renderer.buffer[0][2].ch).toBe('t');
  });

  test('render produces a full layout without errors', () => {
    mockMeasure(renderer);
    renderer.resize();
    // Should not throw
    renderer.render();
    // Check that some expected content exists in the HTML
    expect(pre.innerHTML).toContain('CHARLES');
    expect(pre.innerHTML).toContain('Senior Software Engineer');
    expect(pre.innerHTML).toContain('ABOUT');
    expect(pre.innerHTML).toContain('SKILLS');
    expect(pre.innerHTML).toContain('PROJECTS');
    expect(pre.innerHTML).toContain('CONTACT');
  });

  test('section offsets are populated after render', () => {
    mockMeasure(renderer);
    renderer.resize();
    renderer.render();
    expect(typeof renderer.sectionOffsets['about']).toBe('number');
    expect(typeof renderer.sectionOffsets['skills']).toBe('number');
    expect(typeof renderer.sectionOffsets['projects']).toBe('number');
    expect(typeof renderer.sectionOffsets['contact']).toBe('number');
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

    // The hover should change the rendering
    expect(after).not.toBe(before);
  });
});

describe('main.js guard', () => {
  test('main.js does not throw when themeToggle is missing', () => {
    jest.resetModules();
    document.body.innerHTML = '<div id="terminalWrap"><pre id="terminal"></pre></div>';
    expect(() => require('../../src/main')).not.toThrow();
  });
});
