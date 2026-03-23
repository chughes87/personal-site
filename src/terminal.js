// ── Terminal Rendering Engine ─────────────────────────────────────────────────
// Renders the entire index page as monospace text inside a single <pre> element.
// No dependencies. No build step.

(function () {
  'use strict';

  // ── ASCII Art ────────────────────────────────────────────────────────────────
  // "ANSI Shadow" font — hardcoded to avoid runtime dependency on figlet.js
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

  // Smaller fallback for narrow screens
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

  // ── Rendering Engine ─────────────────────────────────────────────────────────

  function TerminalRenderer(pre) {
    this.pre = pre;
    this.cols = 80;
    this.rows = 24;
    this.cellW = 0;
    this.cellH = 0;
    this.buffer = [];    // 2D array of {ch, fg, bg, bold}
    this.meta = [];      // 2D array of {href, group} or null
    this.groups = {};    // group id → {href, cells: [{r,c}]}
    this.hoveredGroup = null;
    this.totalRows = 0;
    this.sectionOffsets = {};
    this._resizeTimer = null;
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
    // rows is just viewport rows — content can exceed this
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

  TerminalRenderer.prototype.writeCenter = function (row, text, style) {
    var col = Math.floor((this.cols - text.length) / 2);
    this.write(row, col, text, style);
    return col;
  };

  TerminalRenderer.prototype.writeCenterBlock = function (row, lines, style) {
    var maxLen = 0;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].length > maxLen) maxLen = lines[i].length;
    }
    var col = Math.floor((this.cols - maxLen) / 2);
    if (col < 0) col = 0;
    this.writeBlock(row, col, lines, style);
    return col;
  };

  TerminalRenderer.prototype.addLink = function (row, col, len, href, groupId) {
    if (!this.groups[groupId]) {
      this.groups[groupId] = { href: href, cells: [] };
    }
    for (var i = 0; i < len; i++) {
      var c = col + i;
      if (c < 0 || c >= this.cols || row < 0 || row >= this.totalRows) continue;
      this.meta[row][c] = { href: href, group: groupId };
      this.groups[groupId].cells.push({ r: row, c: c });
    }
  };

  TerminalRenderer.prototype.drawButton = function (row, col, label, href, style) {
    var w = label.length + 4;
    var top    = '┌' + repeat('─', w - 2) + '┐';
    var mid    = '│ ' + label + ' │';
    var bottom = '└' + repeat('─', w - 2) + '┘';
    this.write(row,     col, top,    style);
    this.write(row + 1, col, mid,    style);
    this.write(row + 2, col, bottom, style);
    var groupId = 'btn_' + label.replace(/\s/g, '_');
    // Make all 3 rows of the button clickable
    this.addLink(row,     col, w, href, groupId);
    this.addLink(row + 1, col, w, href, groupId);
    this.addLink(row + 2, col, w, href, groupId);
    return w;
  };

  TerminalRenderer.prototype.drawCenterButton = function (row, label, href, style) {
    var w = label.length + 4;
    var col = Math.floor((this.cols - w) / 2);
    this.drawButton(row, col, label, href, style);
    return col;
  };

  TerminalRenderer.prototype.drawHRule = function (row, style) {
    this.write(row, 0, repeat('─', this.cols), style || { fg: C.dim });
  };

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

  TerminalRenderer.prototype.flush = function () {
    var parts = [];
    for (var r = 0; r < this.totalRows; r++) {
      var row = this.buffer[r];
      var i = 0;
      while (i < this.cols) {
        var cell = row[i];
        var fg = cell.fg;
        var bg = cell.bg;
        var bold = cell.bold;

        // Check hover
        var m = this.meta[r][i];
        if (m && m.group === this.hoveredGroup) {
          bg = C.hoverBg;
          fg = C.cyan;
        }

        // Coalesce adjacent cells with same style
        var run = cell.ch;
        var j = i + 1;
        while (j < this.cols) {
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
        var styles = 'color:' + fg;
        if (bg) styles += ';background:' + bg;
        if (bold) styles += ';font-weight:bold';
        parts.push('<span style="' + styles + '">' + escaped + '</span>');
        i = j;
      }
      if (r < this.totalRows - 1) parts.push('\n');
    }
    this.pre.innerHTML = parts.join('');
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
        e.clientX - rect.left + self.pre.parentElement.scrollLeft,
        e.clientY - rect.top + self.pre.parentElement.scrollTop
      );
      var m = (pos.row >= 0 && pos.row < self.totalRows && pos.col >= 0 && pos.col < self.cols)
        ? self.meta[pos.row][pos.col] : null;
      var newGroup = m ? m.group : null;
      if (newGroup !== self.hoveredGroup) {
        self.hoveredGroup = newGroup;
        self.flush();
        self.pre.style.cursor = newGroup ? 'pointer' : 'default';
      }
    });

    this.pre.addEventListener('mouseleave', function () {
      if (self.hoveredGroup) {
        self.hoveredGroup = null;
        self.flush();
        self.pre.style.cursor = 'default';
      }
    });

    this.pre.addEventListener('click', function (e) {
      var rect = self.pre.getBoundingClientRect();
      var pos = self.pixelToGrid(
        e.clientX - rect.left + self.pre.parentElement.scrollLeft,
        e.clientY - rect.top + self.pre.parentElement.scrollTop
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

  // ── Content Layout ─────────────────────────────────────────────────────────

  TerminalRenderer.prototype.render = function () {
    // First pass: calculate total height needed
    var totalRows = this._calcLayout();
    this.allocate(totalRows);
    // Second pass: draw everything
    this._drawLayout();
    this.flush();
  };

  TerminalRenderer.prototype._calcLayout = function () {
    var r = 0;
    var cols = this.cols;
    var contentW = Math.min(cols - 4, 76);
    var pad = Math.max(Math.floor((cols - contentW) / 2), 2);

    // Nav bar
    r += 2;

    // Hero: ASCII art
    var useSmall = cols < 60;
    var artLines = useSmall ? ASCII_CH_SMALL : ASCII_CHARLES;
    r += 2; // top padding
    r += artLines.length;
    r += 1; // gap
    var art2 = useSmall ? ASCII_H_SMALL : ASCII_HUGHES;
    r += art2.length;
    r += 2; // subtitle
    r += 2; // description lines (approx)
    var desc = 'Full-stack engineer with 14+ years of experience building scalable web applications across React, Node.js, Ruby on Rails, and cloud infrastructure.';
    r += Math.ceil(desc.length / contentW) + 1;
    r += 1; // gap
    r += 3; // buttons
    r += 2; // bottom padding

    // About section
    r += 1; // rule
    r += 2; // title
    var about1 = "I'm a full-stack software engineer with 14+ years of experience delivering high-impact features at companies like Binti, Zillow, and ThousandEyes. I specialise in frontend architecture, authentication systems, data visualisation, and developer productivity tooling.";
    var about2 = "Outside of work I volunteer with Alameda CASA and teach at Sudoroom, a community hacker space in Oakland.";
    r += Math.ceil(about1.length / contentW) + 1;
    r += Math.ceil(about2.length / contentW) + 1;
    r += 3; // links
    r += 2; // padding

    // Skills section
    r += 1; // rule
    r += 2; // title
    r += 8; // skill boxes (6 lines each box + padding)
    r += 2;

    // Projects section
    r += 1; // rule
    r += 2; // title
    r += 12; // project cards
    r += 2;

    // Contact section
    r += 1; // rule
    r += 2; // title
    r += 3; // text
    r += 3; // button
    r += 2;

    // Footer
    r += 1; // rule
    r += 2;

    // Ensure at least viewport height
    if (r < this.rows) r = this.rows;

    return r;
  };

  TerminalRenderer.prototype._drawLayout = function () {
    var r = 0;
    var cols = this.cols;
    var contentW = Math.min(cols - 4, 76);
    var pad = Math.max(Math.floor((cols - contentW) / 2), 2);

    // ── Nav Bar ──────────────────────────────────────────────────────────────
    r = this._drawNav(r);

    // ── Hero ─────────────────────────────────────────────────────────────────
    r += 2;
    this.sectionOffsets['top'] = r;
    var useSmall = cols < 60;
    var art1 = useSmall ? ASCII_CH_SMALL : ASCII_CHARLES;
    var art2 = useSmall ? ASCII_H_SMALL : ASCII_HUGHES;

    this.writeCenterBlock(r, art1, { fg: C.bright, bold: true });
    r += art1.length + 1;
    this.writeCenterBlock(r, art2, { fg: C.bright, bold: true });
    r += art2.length + 2;

    this.writeCenter(r, 'Senior Software Engineer', { fg: C.yellow });
    r += 2;

    var desc = 'Full-stack engineer with 14+ years of experience building scalable web applications across React, Node.js, Ruby on Rails, and cloud infrastructure.';
    r = this.writeWrapped(r, pad, desc, contentW, { fg: C.muted });
    r += 2;

    // Hero buttons
    var btnLabel1 = 'View My Work';
    var btnLabel2 = 'Get in Touch';
    var bw1 = btnLabel1.length + 4;
    var bw2 = btnLabel2.length + 4;
    var totalBtnW = bw1 + 4 + bw2;
    var btnStart = Math.floor((cols - totalBtnW) / 2);
    if (btnStart < 2) btnStart = 2;
    this.drawButton(r, btnStart, btnLabel1, '#projects', { fg: C.cyan });
    this.drawButton(r, btnStart + bw1 + 4, btnLabel2, '#contact', { fg: C.cyan });
    r += 4;

    // ── About ────────────────────────────────────────────────────────────────
    this.drawHRule(r);
    r += 1;
    this.sectionOffsets['about'] = r;
    r += 1;
    this.write(r, pad, '>> ABOUT', { fg: C.yellow, bold: true });
    r += 2;

    var about1 = "I'm a full-stack software engineer with 14+ years of experience delivering high-impact features at companies like Binti, Zillow, and ThousandEyes. I specialise in frontend architecture, authentication systems, data visualisation, and developer productivity tooling.";
    r = this.writeWrapped(r, pad, about1, contentW, { fg: C.white });
    r += 1;

    var about2 = 'Outside of work I volunteer with Alameda CASA and teach at Sudoroom, a community hacker space in Oakland.';
    r = this.writeWrapped(r, pad, about2, contentW, { fg: C.white });
    r += 1;

    // Links
    var ghText = '> GitHub: github.com/chughes87';
    this.write(r, pad, ghText, { fg: C.cyan });
    this.addLink(r, pad, ghText.length, 'https://github.com/chughes87', 'link_github');
    r += 1;

    var liText = '> LinkedIn: linkedin.com/in/charles-hughes';
    this.write(r, pad, liText, { fg: C.cyan });
    this.addLink(r, pad, liText.length, 'https://www.linkedin.com/in/charles-hughes-7a818618/', 'link_linkedin');
    r += 2;

    // ── Skills ───────────────────────────────────────────────────────────────
    this.drawHRule(r);
    r += 1;
    this.sectionOffsets['skills'] = r;
    r += 1;
    this.write(r, pad, '>> SKILLS', { fg: C.yellow, bold: true });
    r += 2;

    var categories = [
      { title: 'Languages',      items: ['TypeScript', 'JavaScript', 'Ruby', 'C++'] },
      { title: 'Frontend',       items: ['React', 'Redux', 'Apollo Client', 'D3.js'] },
      { title: 'Backend',        items: ['Node.js', 'Ruby on Rails', 'GraphQL', 'React Query'] },
      { title: 'Testing & Infra', items: ['Playwright', 'Cypress', 'AWS', 'GCP'] }
    ];

    var boxW = 18;
    var gap = 2;
    var boxesPerRow = Math.floor((contentW + gap) / (boxW + gap));
    if (boxesPerRow < 1) boxesPerRow = 1;
    if (boxesPerRow > 4) boxesPerRow = 4;

    for (var bi = 0; bi < categories.length; bi += boxesPerRow) {
      var rowBoxes = categories.slice(bi, bi + boxesPerRow);
      var totalW = rowBoxes.length * boxW + (rowBoxes.length - 1) * gap;
      var startCol = Math.floor((cols - totalW) / 2);
      if (startCol < 2) startCol = 2;

      var boxR = r;
      for (var bj = 0; bj < rowBoxes.length; bj++) {
        var cat = rowBoxes[bj];
        var bx = startCol + bj * (boxW + gap);
        // Draw box
        var titleLine = '─ ' + cat.title + ' ';
        var remaining = boxW - titleLine.length - 2;
        if (remaining < 0) remaining = 0;
        this.write(boxR, bx, '┌' + titleLine + repeat('─', remaining) + '┐', { fg: C.green });
        for (var k = 0; k < cat.items.length; k++) {
          var item = cat.items[k];
          var padRight = boxW - 4 - item.length;
          if (padRight < 0) padRight = 0;
          this.write(boxR + 1 + k, bx, '│ ' + item + repeat(' ', padRight) + ' │', { fg: C.green });
        }
        this.write(boxR + 1 + cat.items.length, bx, '└' + repeat('─', boxW - 2) + '┘', { fg: C.green });
      }
      r += 2 + categories[0].items.length;
    }
    r += 2;

    // ── Projects ─────────────────────────────────────────────────────────────
    this.drawHRule(r);
    r += 1;
    this.sectionOffsets['projects'] = r;
    r += 1;
    this.write(r, pad, '>> PROJECTS', { fg: C.yellow, bold: true });
    r += 2;

    // Project card
    var projW = Math.min(contentW, 56);
    var projStart = Math.floor((cols - projW) / 2);
    if (projStart < 2) projStart = 2;

    this.write(r, projStart, '┌' + repeat('─', projW - 2) + '┐', { fg: C.green });
    r++;
    var pTitle = 'Personal Site';
    this.write(r, projStart, '│ ' + pTitle + repeat(' ', projW - 4 - pTitle.length) + ' │', { fg: C.bright, bold: true });
    r++;
    this.write(r, projStart, '│' + repeat(' ', projW - 2) + '│', { fg: C.green });
    r++;
    var pDesc1 = 'This site — a terminal-style portfolio';
    this.write(r, projStart, '│ ' + pDesc1 + repeat(' ', projW - 4 - pDesc1.length) + ' │', { fg: C.white });
    r++;
    var pDesc2 = 'built with vanilla HTML, CSS, and JS.';
    this.write(r, projStart, '│ ' + pDesc2 + repeat(' ', projW - 4 - pDesc2.length) + ' │', { fg: C.white });
    r++;
    this.write(r, projStart, '│' + repeat(' ', projW - 2) + '│', { fg: C.green });
    r++;
    var pTags = '[HTML] [CSS] [JavaScript]';
    this.write(r, projStart, '│ ' + pTags + repeat(' ', projW - 4 - pTags.length) + ' │', { fg: C.muted });
    r++;
    this.write(r, projStart, '└' + repeat('─', projW - 2) + '┘', { fg: C.green });
    r++;

    var srcLink = '  > Source: github.com/chughes87/personal-site';
    this.write(r, projStart, srcLink, { fg: C.cyan });
    this.addLink(r, projStart, srcLink.length, 'https://github.com/chughes87/personal-site', 'link_project_src');
    r += 2;

    // Second project placeholder
    this.write(r, projStart, '┌' + repeat('─', projW - 2) + '┐', { fg: C.dim });
    r++;
    var p2Title = 'More Coming Soon';
    this.write(r, projStart, '│ ' + p2Title + repeat(' ', projW - 4 - p2Title.length) + ' │', { fg: C.muted });
    r++;
    this.write(r, projStart, '│' + repeat(' ', projW - 2) + '│', { fg: C.dim });
    r++;
    var p2Desc = 'Check back or visit my GitHub.';
    this.write(r, projStart, '│ ' + p2Desc + repeat(' ', projW - 4 - p2Desc.length) + ' │', { fg: C.muted });
    r++;
    this.write(r, projStart, '└' + repeat('─', projW - 2) + '┘', { fg: C.dim });
    r += 3;

    // ── Contact ──────────────────────────────────────────────────────────────
    this.drawHRule(r);
    r += 1;
    this.sectionOffsets['contact'] = r;
    r += 1;
    this.write(r, pad, '>> CONTACT', { fg: C.yellow, bold: true });
    r += 2;

    var contactText = 'Have a project in mind, a question, or just want to say hello? My inbox is always open.';
    r = this.writeWrapped(r, pad, contactText, contentW, { fg: C.white });
    r += 1;

    this.drawCenterButton(r, 'Say Hello', 'mailto:cjhughes87@pm.me', { fg: C.cyan });
    r += 4;

    // ── Footer ───────────────────────────────────────────────────────────────
    this.drawHRule(r);
    r += 1;
    var year = new Date().getFullYear();
    var footerText = '(c) ' + year + ' Charles Hughes. Built with care.';
    this.writeCenter(r, footerText, { fg: C.muted });
    r += 2;
  };

  TerminalRenderer.prototype._drawNav = function (r) {
    // Logo
    this.write(r, 1, 'CH', { fg: C.bright, bold: true });

    // Nav items
    var navItems = [
      { label: 'About',    href: '#about' },
      { label: 'Skills',   href: '#skills' },
      { label: 'Projects', href: '#projects' },
      { label: 'Contact',  href: '#contact' },
      { label: 'Chat',     href: '/chat.html' },
      { label: 'Voice',    href: '/voice.html' }
    ];

    var pos = this.cols - 2;
    for (var i = navItems.length - 1; i >= 0; i--) {
      var item = navItems[i];
      var label = '[' + item.label + ']';
      pos -= label.length;
      if (pos < 5) break; // don't overlap logo
      this.write(r, pos, label, { fg: C.cyan });
      this.addLink(r, pos, label.length, item.href, 'nav_' + item.label);
      pos -= 2; // gap
    }

    // Nav underline
    this.write(r + 1, 0, repeat('═', this.cols), { fg: C.dim });

    return r + 2;
  };

  // ── Init ───────────────────────────────────────────────────────────────────

  TerminalRenderer.prototype.init = function () {
    this.resize();
    this.render();
    this.bindEvents();
  };

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

  // ── Boot ───────────────────────────────────────────────────────────────────

  var pre = document.getElementById('terminal');
  if (pre) {
    var renderer = new TerminalRenderer(pre);
    renderer.init();
  }

  // Expose for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TerminalRenderer: TerminalRenderer, repeat: repeat, escapeHtml: escapeHtml };
  }
})();
