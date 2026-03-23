// ── Terminal Rendering Engine ─────────────────────────────────────────────────
// Renders pages as monospace text inside a single <pre> element.
// No dependencies. No build step.
//
// Architecture:
//   TerminalRenderer — low-level buffer (write, flush, events)
//   LayoutContext     — high-level cursor-based drawing (text, link, box, section)
//   Page functions    — define content declaratively via LayoutContext methods

(function () {
  'use strict';

  // ── Color palette ──────────────────────────────────────────────────────────
  var C = {
    green:   '#33ff33',
    bright:  '#00ff88',
    cyan:    '#00bfff',
    yellow:  '#ffcc00',
    muted:   '#666666',
    dim:     '#444444',
    white:   '#e6edf3',
    bg:      '#0d1117',
    hoverBg: '#1a2332'
  };

  // ── Style class cache ─────────────────────────────────────────────────────
  // Maps fg|bg|bold keys to short class names, injected as a <style> element.

  var styleClasses = {};
  var styleRules = [];
  var classCounter = 0;
  var styleEl = null;

  function getStyleClass(fg, bg, bold) {
    var key = fg + '|' + (bg || '') + '|' + (bold ? '1' : '0');
    if (!styleClasses[key]) {
      var cls = 'tc' + classCounter++;
      var rule = '.' + cls + '{color:' + fg;
      if (bg) rule += ';background:' + bg;
      if (bold) rule += ';font-weight:bold';
      rule += '}';
      styleClasses[key] = cls;
      styleRules.push(rule);
    }
    return styleClasses[key];
  }

  function injectStyles() {
    if (!styleEl) {
      styleEl = document.getElementById('terminal-styles');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'terminal-styles';
        document.head.appendChild(styleEl);
      }
    }
    styleEl.textContent = styleRules.join('');
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function repeat(ch, n) {
    if (n <= 0) return '';
    var s = '';
    for (var i = 0; i < n; i++) s += ch;
    return s;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── TerminalRenderer (low-level buffer engine) ─────────────────────────────

  function TerminalRenderer(pre) {
    this.pre = pre;
    this.cols = 80;
    this.rows = 24;
    this.cellW = 0;
    this.cellH = 0;
    this.buffer = [];
    this.meta = [];
    this.groups = {};
    this.hoveredGroup = null;
    this.totalRows = 0;
    this.sectionOffsets = {};
    this._resizeTimer = null;
    this._pageFn = null;
  }

  TerminalRenderer.prototype.measureCell = function () {
    var probe = document.createElement('span');
    probe.textContent = 'X';
    probe.style.cssText = 'visibility:hidden;position:absolute;white-space:pre;';
    this.pre.appendChild(probe);
    var rect = probe.getBoundingClientRect();
    this.cellW = rect.width;
    this.cellH = rect.height;
    this.pre.removeChild(probe);
  };

  TerminalRenderer.prototype.resize = function () {
    this.measureCell();
    if (this.cellW === 0 || this.cellH === 0) return;
    var wrap = this.pre.parentElement;
    this.cols = Math.floor(wrap.clientWidth / this.cellW);
    this.rows = Math.floor(wrap.clientHeight / this.cellH);
    if (this.cols < 20) this.cols = 20;
    if (this.rows < 10) this.rows = 10;
  };

  TerminalRenderer.prototype.allocate = function (totalRows) {
    this.totalRows = totalRows;
    this.buffer = [];
    this.meta = [];
    this.groups = {};
    for (var r = 0; r < totalRows; r++) {
      var row = [];
      var mrow = [];
      for (var c = 0; c < this.cols; c++) {
        row.push({ ch: ' ', fg: C.green, bg: null, bold: false });
        mrow.push(null);
      }
      this.buffer.push(row);
      this.meta.push(mrow);
    }
  };

  TerminalRenderer.prototype.write = function (row, col, text, style) {
    if (row < 0 || row >= this.totalRows) return;
    style = style || {};
    for (var i = 0; i < text.length; i++) {
      var c = col + i;
      if (c < 0 || c >= this.cols) continue;
      this.buffer[row][c].ch = text[i];
      if (style.fg) this.buffer[row][c].fg = style.fg;
      if (style.bg) this.buffer[row][c].bg = style.bg;
      if (style.bold) this.buffer[row][c].bold = true;
    }
  };

  TerminalRenderer.prototype.writeBlock = function (row, col, lines, style) {
    for (var i = 0; i < lines.length; i++) {
      this.write(row + i, col, lines[i], style);
    }
  };

  TerminalRenderer.prototype.addLink = function (row, col, len, href, groupId) {
    if (!this.groups[groupId]) {
      this.groups[groupId] = { href: href, cells: [], rows: [] };
    }
    for (var i = 0; i < len; i++) {
      var c = col + i;
      if (c < 0 || c >= this.cols || row < 0 || row >= this.totalRows) continue;
      this.meta[row][c] = { href: href, group: groupId };
      this.groups[groupId].cells.push({ r: row, c: c });
    }
    if (this.groups[groupId].rows.indexOf(row) === -1) {
      this.groups[groupId].rows.push(row);
    }
  };

  TerminalRenderer.prototype.flushRow = function (r) {
    var row = this.buffer[r];
    var parts = [];

    // Find last non-trivial column to avoid rendering trailing whitespace
    var rowCols = 0;
    for (var k = this.cols - 1; k >= 0; k--) {
      var tc = row[k];
      var tm = this.meta[r][k];
      var hasHoverBg = tm && tm.group === this.hoveredGroup;
      if (tc.ch !== ' ' || tc.bg !== null || tc.bold || hasHoverBg) {
        rowCols = k + 1;
        break;
      }
    }

    var i = 0;
    while (i < rowCols) {
      var cell = row[i];
      var fg = cell.fg;
      var bg = cell.bg;
      var bold = cell.bold;

      var m = this.meta[r][i];
      if (m && m.group === this.hoveredGroup) {
        bg = C.hoverBg;
        fg = C.cyan;
      }

      var run = cell.ch;
      var j = i + 1;
      while (j < rowCols) {
        var next = row[j];
        var nfg = next.fg;
        var nbg = next.bg;
        var nbold = next.bold;
        var nm = this.meta[r][j];
        if (nm && nm.group === this.hoveredGroup) {
          nbg = C.hoverBg;
          nfg = C.cyan;
        }
        if (nfg === fg && nbg === bg && nbold === bold) {
          run += next.ch;
          j++;
        } else {
          break;
        }
      }

      var escaped = escapeHtml(run);
      var cls = getStyleClass(fg, bg, bold);
      parts.push('<span class="' + cls + '">' + escaped + '</span>');
      i = j;
    }

    return parts.join('');
  };

  TerminalRenderer.prototype.flush = function () {
    var html = [];
    for (var r = 0; r < this.totalRows; r++) {
      html.push('<div>' + this.flushRow(r) + '</div>');
    }
    this.pre.innerHTML = html.join('');
    injectStyles();
    this.rowEls = Array.prototype.slice.call(this.pre.children);
  };

  TerminalRenderer.prototype.flushRows = function (rows) {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r >= 0 && r < this.totalRows && this.rowEls && this.rowEls[r]) {
        this.rowEls[r].innerHTML = this.flushRow(r);
      }
    }
  };

  TerminalRenderer.prototype.pixelToGrid = function (x, y) {
    return {
      row: Math.floor(y / this.cellH),
      col: Math.floor(x / this.cellW)
    };
  };

  TerminalRenderer.prototype.bindEvents = function () {
    var self = this;

    this.pre.addEventListener('mousemove', function (e) {
      var rect = self.pre.getBoundingClientRect();
      var pos = self.pixelToGrid(
        e.clientX - rect.left,
        e.clientY - rect.top
      );
      var m = (pos.row >= 0 && pos.row < self.totalRows && pos.col >= 0 && pos.col < self.cols)
        ? self.meta[pos.row][pos.col] : null;
      var newGroup = m ? m.group : null;
      if (newGroup !== self.hoveredGroup) {
        var dirtyRows = [];
        if (self.hoveredGroup && self.groups[self.hoveredGroup]) {
          dirtyRows = dirtyRows.concat(self.groups[self.hoveredGroup].rows);
        }
        self.hoveredGroup = newGroup;
        if (newGroup && self.groups[newGroup]) {
          dirtyRows = dirtyRows.concat(self.groups[newGroup].rows);
        }
        self.flushRows(dirtyRows);
        self.pre.style.cursor = newGroup ? 'pointer' : 'default';
      }
    });

    this.pre.addEventListener('mouseleave', function () {
      if (self.hoveredGroup) {
        var dirtyRows = self.groups[self.hoveredGroup]
          ? self.groups[self.hoveredGroup].rows : [];
        self.hoveredGroup = null;
        self.flushRows(dirtyRows);
        self.pre.style.cursor = 'default';
      }
    });

    this.pre.addEventListener('click', function (e) {
      var rect = self.pre.getBoundingClientRect();
      var pos = self.pixelToGrid(
        e.clientX - rect.left,
        e.clientY - rect.top
      );
      var m = (pos.row >= 0 && pos.row < self.totalRows && pos.col >= 0 && pos.col < self.cols)
        ? self.meta[pos.row][pos.col] : null;
      if (!m) return;
      var href = m.href;
      if (href.charAt(0) === '#') {
        var target = href.slice(1);
        if (self.sectionOffsets[target] !== undefined) {
          self.pre.parentElement.scrollTo({
            top: self.sectionOffsets[target] * self.cellH,
            behavior: 'smooth'
          });
        }
      } else if (href.indexOf('mailto:') === 0) {
        window.location.href = href;
      } else if (href.charAt(0) === '/') {
        window.location.href = href;
      } else {
        window.open(href, '_blank', 'noopener');
      }
    });

    window.addEventListener('resize', function () {
      clearTimeout(self._resizeTimer);
      self._resizeTimer = setTimeout(function () {
        self.resize();
        self.render();
      }, 150);
    });
  };

  // render: allocate a generous buffer, run the page function, trim to actual size
  TerminalRenderer.prototype.render = function (pageFn) {
    if (pageFn) this._pageFn = pageFn;
    if (!this._pageFn) return;

    this.sectionOffsets = {};
    // Generous initial allocation — page will use what it needs
    this.allocate(Math.max(this.rows, 500));

    var ctx = new LayoutContext(this);
    this._pageFn(ctx);

    // Trim buffer to actual rows used
    var used = ctx.row;
    if (used < this.rows) used = this.rows;
    this.buffer.length = used;
    this.meta.length = used;
    this.totalRows = used;

    this.flush();
  };

  TerminalRenderer.prototype.init = function (pageFn) {
    this.resize();
    this.render(pageFn);
    this.bindEvents();
  };

  // ── LayoutContext (high-level cursor-based drawing) ─────────────────────────
  // Wraps a TerminalRenderer and provides auto-advancing drawing methods.
  // Page functions receive a LayoutContext and call its methods to build content.

  function LayoutContext(renderer) {
    this.r = renderer;
    this.row = 0;
    this.cols = renderer.cols;
    this.contentW = Math.min(renderer.cols - 4, 76);
    this.pad = Math.max(Math.floor((renderer.cols - this.contentW) / 2), 2);
  }

  // ── Spacing ──

  LayoutContext.prototype.spacer = function (n) {
    this.row += (n || 1);
  };

  LayoutContext.prototype.rule = function (style) {
    this.r.write(this.row, 0, repeat('─', this.cols), style || { fg: C.dim });
    this.row += 1;
  };

  LayoutContext.prototype.doubleRule = function (style) {
    this.r.write(this.row, 0, repeat('═', this.cols), style || { fg: C.dim });
    this.row += 1;
  };

  // ── Text ──

  LayoutContext.prototype.text = function (str, style) {
    this.row = this.r.writeWrapped
      ? this.r.writeWrapped(this.row, this.pad, str, this.contentW, style || { fg: C.white })
      : this.row + 1;
  };

  // writeWrapped is on the renderer — delegate properly
  TerminalRenderer.prototype.writeWrapped = function (row, col, text, maxWidth, style) {
    var words = text.split(' ');
    var line = '';
    var r = row;
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (test.length > maxWidth && line.length > 0) {
        this.write(r, col, line, style);
        r++;
        line = words[i];
      } else {
        line = test;
      }
    }
    if (line) {
      this.write(r, col, line, style);
      r++;
    }
    return r;
  };

  LayoutContext.prototype.centerText = function (str, style) {
    var col = Math.floor((this.cols - str.length) / 2);
    this.r.write(this.row, col, str, style || { fg: C.white });
    this.row += 1;
  };

  // ── Links ──

  LayoutContext.prototype.link = function (label, href, style) {
    var groupId = 'link_' + href.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30);
    this.r.write(this.row, this.pad, label, style || { fg: C.cyan });
    this.r.addLink(this.row, this.pad, label.length, href, groupId);
    this.row += 1;
  };

  // ── ASCII Art ──

  LayoutContext.prototype.asciiArt = function (lines, opts) {
    opts = opts || {};
    if (opts.fallback && opts.minCols && this.cols < opts.minCols) {
      lines = opts.fallback;
    }
    var maxLen = 0;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].length > maxLen) maxLen = lines[i].length;
    }
    var col = Math.floor((this.cols - maxLen) / 2);
    if (col < 0) col = 0;
    this.r.writeBlock(this.row, col, lines, opts.style || { fg: C.bright, bold: true });
    this.row += lines.length;
  };

  // ── Buttons ──

  LayoutContext.prototype.button = function (label, href, style) {
    var w = label.length + 4;
    var col = Math.floor((this.cols - w) / 2);
    this._drawButton(this.row, col, label, href, style);
    this.row += 3;
  };

  LayoutContext.prototype.buttonRow = function (buttons, style) {
    var totalW = 0;
    for (var i = 0; i < buttons.length; i++) {
      totalW += buttons[i].label.length + 4;
    }
    totalW += (buttons.length - 1) * 4; // gaps
    var col = Math.floor((this.cols - totalW) / 2);
    if (col < 2) col = 2;

    for (var j = 0; j < buttons.length; j++) {
      var btn = buttons[j];
      var w = this._drawButton(this.row, col, btn.label, btn.href, btn.style || style);
      col += w + 4;
    }
    this.row += 3;
  };

  LayoutContext.prototype._drawButton = function (row, col, label, href, style) {
    var w = label.length + 4;
    var top    = '┌' + repeat('─', w - 2) + '┐';
    var mid    = '│ ' + label + ' │';
    var bottom = '└' + repeat('─', w - 2) + '┘';
    style = style || { fg: C.cyan };
    this.r.write(row,     col, top,    style);
    this.r.write(row + 1, col, mid,    style);
    this.r.write(row + 2, col, bottom, style);
    var groupId = 'btn_' + label.replace(/\s/g, '_');
    this.r.addLink(row,     col, w, href, groupId);
    this.r.addLink(row + 1, col, w, href, groupId);
    this.r.addLink(row + 2, col, w, href, groupId);
    return w;
  };

  // ── Sections ──

  LayoutContext.prototype.section = function (id, title, contentFn) {
    this.rule();
    this.r.sectionOffsets[id] = this.row;
    this.spacer(1);
    this.r.write(this.row, this.pad, '>> ' + title, { fg: C.yellow, bold: true });
    this.row += 1;
    this.spacer(1);
    contentFn(this);
    this.spacer(1);
  };

  // ── Nav ──

  LayoutContext.prototype.nav = function (items) {
    this.spacer(1);
    // Logo
    this.r.write(this.row, 1, 'CH', { fg: C.bright, bold: true });

    var pos = this.cols - 2;
    for (var i = items.length - 1; i >= 0; i--) {
      var item = items[i];
      var label = '[' + item.label + ']';
      pos -= label.length;
      if (pos < 5) break;
      this.r.write(this.row, pos, label, { fg: C.cyan });
      this.r.addLink(this.row, pos, label.length, item.href, 'nav_' + item.label);
      pos -= 2;
    }

    this.spacer(1);
    this.doubleRule();
  };

  // ── Boxes (skill panels, project cards, etc.) ──

  LayoutContext.prototype.boxGrid = function (boxes, opts) {
    opts = opts || {};
    var boxW = opts.width || 21;
    var gap = opts.gap || 2;
    var perRow = Math.floor((this.contentW + gap) / (boxW + gap));
    if (perRow < 1) perRow = 1;
    if (perRow > boxes.length) perRow = boxes.length;
    var boxStyle = opts.style || { fg: C.green };

    for (var bi = 0; bi < boxes.length; bi += perRow) {
      var rowBoxes = boxes.slice(bi, bi + perRow);
      var totalW = rowBoxes.length * boxW + (rowBoxes.length - 1) * gap;
      var startCol = Math.floor((this.cols - totalW) / 2);
      if (startCol < 2) startCol = 2;

      var maxItems = 0;
      for (var bj = 0; bj < rowBoxes.length; bj++) {
        var box = rowBoxes[bj];
        var bx = startCol + bj * (boxW + gap);
        var items = box.items || [];
        if (items.length > maxItems) maxItems = items.length;

        // Title bar
        var titleLine = '─ ' + box.title + ' ';
        var remaining = boxW - titleLine.length - 2;
        if (remaining < 0) remaining = 0;
        this.r.write(this.row, bx, '┌' + titleLine + repeat('─', remaining) + '┐', boxStyle);

        // Items
        for (var k = 0; k < items.length; k++) {
          var padRight = boxW - 4 - items[k].length;
          if (padRight < 0) padRight = 0;
          this.r.write(this.row + 1 + k, bx, '│ ' + items[k] + repeat(' ', padRight) + ' │', boxStyle);
        }

        // Bottom
        this.r.write(this.row + 1 + items.length, bx, '└' + repeat('─', boxW - 2) + '┘', boxStyle);
      }
      this.row += 2 + maxItems;
    }
  };

  LayoutContext.prototype.card = function (opts) {
    var w = opts.width || Math.min(this.contentW, 56);
    var col = Math.floor((this.cols - w) / 2);
    if (col < 2) col = 2;
    var style = opts.style || { fg: C.green };
    var lines = opts.lines || [];

    this.r.write(this.row, col, '┌' + repeat('─', w - 2) + '┐', style);
    this.row++;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var text = line.text || '';
      var lineStyle = line.style || style;
      if (line.blank) {
        this.r.write(this.row, col, '│' + repeat(' ', w - 2) + '│', style);
      } else {
        var padRight = w - 4 - text.length;
        if (padRight < 0) padRight = 0;
        this.r.write(this.row, col, '│ ' + text + repeat(' ', padRight) + ' │', lineStyle);
      }
      this.row++;
    }

    this.r.write(this.row, col, '└' + repeat('─', w - 2) + '┘', style);
    this.row++;

    // Optional link below the card
    if (opts.link) {
      var linkText = opts.link.text;
      this.r.write(this.row, col, linkText, { fg: C.cyan });
      this.r.addLink(this.row, col, linkText.length, opts.link.href,
        'link_' + opts.link.href.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 30));
      this.row++;
    }
  };

  // ── Footer ──

  LayoutContext.prototype.footer = function (text) {
    this.rule();
    this.centerText(text || '(c) ' + new Date().getFullYear() + ' Charles Hughes. Built with care.',
      { fg: C.muted });
    this.spacer(1);
  };

  // ── Index Page ─────────────────────────────────────────────────────────────

  var ASCII_CHARLES = [
    ' ██████╗██╗  ██╗ █████╗ ██████╗ ██╗     ███████╗███████╗',
    '██╔════╝██║  ██║██╔══██╗██╔══██╗██║     ██╔════╝██╔════╝',
    '██║     ███████║███████║██████╔╝██║     █████╗  ███████╗',
    '██║     ██╔══██║██╔══██║██╔══██╗██║     ██╔════╝╚════██║',
    '╚██████╗██║  ██║██║  ██║██║  ██║███████╗███████╗███████║',
    ' ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝'
  ];

  var ASCII_HUGHES = [
    '██╗  ██╗██╗   ██╗ ██████╗ ██╗  ██╗███████╗███████╗',
    '██║  ██║██║   ██║██╔════╝ ██║  ██║██╔════╝██╔════╝',
    '███████║██║   ██║██║  ███╗███████║█████╗  ███████╗',
    '██╔══██║██║   ██║██║   ██║██╔══██║██╔══╝  ╚════██║',
    '██║  ██║╚██████╔╝╚██████╔╝██║  ██║███████╗███████║',
    '╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚══════╝╚══════╝'
  ];

  var ASCII_CH_SMALL = [
    ' ___ _  _   _   ___ _    ___ ___',
    '/ __| || | /_\\ | _ | |  | __/ __|',
    '| (__| __ |/ _ \\|   | |__| _|\\__ \\',
    ' \\___|_||_/_/ \\_|_|_|____|___|___/'
  ];

  var ASCII_H_SMALL = [
    ' _  _ _   _  ___ _  _ ___ ___',
    '| || | | | |/ __| || | __/ __|',
    '| __ | |_| | (_ | __ | _|\\__ \\',
    '|_||_|\\___/ \\___|_||_|___|___/'
  ];

  function indexPage(ctx) {
    ctx.nav([
      { label: 'About',    href: '#about' },
      { label: 'Skills',   href: '#skills' },
      { label: 'Projects', href: '#projects' },
      { label: 'Contact',  href: '#contact' },
      { label: 'Chat',     href: '/chat.html' },
      { label: 'Voice',    href: '/voice.html' }
    ]);

    // Hero
    ctx.spacer(2);
    ctx.asciiArt(ASCII_CHARLES, { fallback: ASCII_CH_SMALL, minCols: 60 });
    ctx.spacer(1);
    ctx.asciiArt(ASCII_HUGHES, { fallback: ASCII_H_SMALL, minCols: 60 });
    ctx.spacer(2);
    ctx.centerText('Senior Software Engineer', { fg: C.yellow });
    ctx.spacer(1);
    ctx.text(
      'Full-stack engineer with 14+ years of experience building scalable ' +
      'web applications across React, Node.js, Ruby on Rails, and cloud infrastructure.',
      { fg: C.muted }
    );
    ctx.spacer(1);
    ctx.buttonRow([
      { label: 'View My Work', href: '#projects' },
      { label: 'Get in Touch', href: '#contact' }
    ], { fg: C.cyan });
    ctx.spacer(1);

    // About
    ctx.section('about', 'ABOUT', function () {
      ctx.text(
        "I'm a full-stack software engineer with 14+ years of experience " +
        "delivering high-impact features at companies like Binti, Zillow, " +
        "and ThousandEyes. I specialise in frontend architecture, " +
        "authentication systems, data visualisation, and developer productivity tooling."
      );
      ctx.spacer(1);
      ctx.text(
        "Outside of work I volunteer with Alameda CASA and teach at " +
        "Sudoroom, a community hacker space in Oakland."
      );
      ctx.spacer(1);
      ctx.link('> GitHub: github.com/chughes87', 'https://github.com/chughes87');
      ctx.link('> LinkedIn: linkedin.com/in/charles-hughes', 'https://www.linkedin.com/in/charles-hughes-7a818618/');
    });

    // Skills
    ctx.section('skills', 'SKILLS', function () {
      ctx.boxGrid([
        { title: 'Languages',       items: ['TypeScript', 'JavaScript', 'Ruby', 'C++'] },
        { title: 'Frontend',        items: ['React', 'Redux', 'Apollo Client', 'D3.js'] },
        { title: 'Backend',         items: ['Node.js', 'Ruby on Rails', 'GraphQL', 'React Query'] },
        { title: 'Testing & Infra', items: ['Playwright', 'Cypress', 'AWS', 'GCP'] }
      ], { width: 21, gap: 2 });
    });

    // Projects
    ctx.section('projects', 'PROJECTS', function () {
      ctx.card({
        lines: [
          { text: 'Personal Site', style: { fg: C.bright, bold: true } },
          { blank: true },
          { text: 'This site \u2014 a terminal-style portfolio' },
          { text: 'built with vanilla HTML, CSS, and JS.' },
          { blank: true },
          { text: '[HTML] [CSS] [JavaScript]', style: { fg: C.muted } }
        ],
        link: { text: '  > Source: github.com/chughes87/personal-site', href: 'https://github.com/chughes87/personal-site' }
      });
      ctx.spacer(1);
      ctx.card({
        style: { fg: C.dim },
        lines: [
          { text: 'More Coming Soon', style: { fg: C.muted } },
          { blank: true },
          { text: 'Check back or visit my GitHub.', style: { fg: C.muted } }
        ]
      });
    });

    // Contact
    ctx.section('contact', 'CONTACT', function () {
      ctx.text(
        'Have a project in mind, a question, or just want to say hello? ' +
        'My inbox is always open.'
      );
      ctx.spacer(1);
      ctx.link('> Email: cjhughes87@pm.me', 'mailto:cjhughes87@pm.me');
    });

    ctx.spacer(1);
    ctx.footer();
  }

  // ── Boot ───────────────────────────────────────────────────────────────────

  var pre = document.getElementById('terminal');
  if (pre) {
    var renderer = new TerminalRenderer(pre);
    renderer.init(indexPage);
  }

  // Expose for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      TerminalRenderer: TerminalRenderer,
      LayoutContext: LayoutContext,
      indexPage: indexPage,
      repeat: repeat,
      escapeHtml: escapeHtml,
      C: C
    };
  }
})();
