/**
 * Emberclouds TUI — Terminal User Interface
 * Color-block logo + real-time status dashboard
 */
const readline = require('readline');
const os = require('os');

// ========== ANSI Helpers ==========
const CSI = '\x1b[';
const cup = (r, c) => CSI + r + ';' + c + 'H';
const sgr = (...codes) => CSI + codes.join(';') + 'm';
const clear = CSI + '2J' + CSI + 'H';
const clearLine = CSI + '2K';
const hideCursor = CSI + '?25l';
const showCursor = CSI + '?25h';
const saveCursor = CSI + 's';
const restoreCursor = CSI + 'u';

// ========== Color Palette ==========
// Ember (warm gradient): red → orange → amber → yellow
const EMBER = [196, 202, 208, 214, 220, 226, 190, 154, 118, 82, 46];
// Clouds (cool gradient): cyan → blue → purple
const CLOUD = [51, 45, 39, 33, 27, 21, 57, 93, 129, 165, 201];

function fg(c) { return sgr(38, 5, c); }
function bg(c) { return sgr(48, 5, c); }
function reset() { return sgr(0); }

// ========== Logo ==========
// Each letter is 5 rows tall, rendered as colored ██ blocks
// Format: [row][col] = { char, color }
const LOGO_LETTERS = {
  E: [
    '███ ',
    '█   ',
    '███ ',
    '█   ',
    '███ ',
  ],
  M: [
    '█ █ ',
    '███ ',
    '█ █ ',
    '█ █ ',
    '█ █ ',
  ],
  B: [
    '███ ',
    '█ █ ',
    '███ ',
    '█ █ ',
    '███ ',
  ],
  R: [
    '███ ',
    '█ █ ',
    '███ ',
    '█ █ ',
    '█ █ ',
  ],
  C: [
    ' ███',
    '█   ',
    '█   ',
    '█   ',
    ' ███',
  ],
  L: [
    '█   ',
    '█   ',
    '█   ',
    '█   ',
    '███ ',
  ],
  O: [
    ' ██ ',
    '█  █',
    '█  █',
    '█  █',
    ' ██ ',
  ],
  U: [
    '█  █',
    '█  █',
    '█  █',
    '█  █',
    ' ██ ',
  ],
  D: [
    '███ ',
    '█  █',
    '█  █',
    '█  █',
    '███ ',
  ],
  S: [
    ' ███',
    '█   ',
    ' ██ ',
    '   █',
    '███ ',
  ],
};

function renderLogo() {
  const word = 'EMBERCLOUDS';
  const rows = ['', '', '', '', ''];
  const letterColors = [
    ...EMBER.slice(0, 5),   // EMBER
    ...CLOUD.slice(0, 6),   // CLOUDS
  ];

  for (let i = 0; i < word.length; i++) {
    const letter = word[i];
    const pattern = LOGO_LETTERS[letter];
    const color = letterColors[i];
    for (let r = 0; r < 5; r++) {
      rows[r] += fg(color) + pattern[r].replace(/█/g, '██').replace(/ /g, '  ') + reset();
    }
  }

  return rows;
}

// ========== Status Bar ==========
function renderDivider(width, ch = '─') {
  return sgr(38, 5, 240) + ch.repeat(width) + reset();
}

function renderHeader(width) {
  const logo = renderLogo();
  const lines = [];
  lines.push('');
  for (const row of logo) {
    const pad = Math.max(0, Math.floor((width - (row.length / 2)) / 2));
    // Approximate visual width (each ██ is 2 chars, colors don't count)
    const visualWidth = row.replace(/\x1b\[[0-9;]*m/g, '').length;
    const leftPad = Math.max(0, Math.floor((width - visualWidth) / 2));
    lines.push(' '.repeat(leftPad) + row);
  }
  lines.push('');
  lines.push(renderDivider(width));
  return lines.join('\n');
}

// ========== TUI State ==========
class Tui {
  constructor(options = {}) {
    this.width = process.stdout.columns || 80;
    this.height = process.stdout.rows || 24;
    this.refreshInterval = options.refreshInterval || 1000;
    this.commandHistory = [];
    this.historyIdx = -1;
    this.currentInput = '';
    this.cursorPos = 0;
    this.messages = [];
    this.maxMessages = 100;
    this.running = false;
    this._refreshTimer = null;

    // Data providers (set by index.js)
    this._getStatus = options.getStatus || (() => ({}));
    this._getDevices = options.getDevices || (() => []);
    this._getUsers = options.getUsers || (async () => []);
    this._onCommand = options.onCommand || (() => {});
    this._onShutdown = options.onShutdown || (() => {});
    this._onRestart = options.onRestart || (() => {});

    // Menu navigation
    this._menuItems = [
      { cmd: 'status',    desc: 'Show server status and network info', needsArg: false },
      { cmd: 'users',     desc: 'List registered users',              needsArg: false },
      { cmd: 'config',    desc: 'Show current configuration',         needsArg: false },
      { cmd: 'ls',        desc: 'List files in repository',           needsArg: true,  argHint: ' [path]' },
      { cmd: 'tree',      desc: 'Show directory tree',                needsArg: true,  argHint: ' [path]' },
      { cmd: 'info',      desc: 'Show file/directory details',        needsArg: true,  argHint: ' <path>' },
      { cmd: 'mkdir',     desc: 'Create a directory',                 needsArg: true,  argHint: ' <path>' },
      { cmd: 'rm',        desc: 'Delete file/directory',              needsArg: true,  argHint: ' <path>' },
      { cmd: 'clear',     desc: 'Clear the message log',              needsArg: false },
      { cmd: 'stop',      desc: 'Shutdown the server',                needsArg: false },
      { cmd: 'restart',   desc: 'Restart the server',                 needsArg: false },
    ];
    this._selectedIndex = 0;
    this._menuScrollOffset = 0;
    this._argMode = false;
    this._argInput = '';
    this._argForCmd = null;
    this._visibleItems = 6;

    // Command input mode (triggered by :)
    this._cmdMode = false;
    this._cmdInput = '';

    // Log viewer
    this._logMode = false;
    this._logScroll = 0;
  }

  log(msg) {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    this.messages.push(`[${time}] ${msg}`);
    if (this.messages.length > this.maxMessages) this.messages.shift();
    if (this.running) this.render();
  }

  start() {
    this.running = true;
    this._setupInput();
    this._setupResize();
    this._renderLoop();
    process.stdout.write(hideCursor);
    this.render();
  }

  stop() {
    this.running = false;
    if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
    if (this._rawMode) { process.stdin.setRawMode(false); this._rawMode = false; }
    process.stdin.removeAllListeners('data');
    process.stdout.write(clear + showCursor);
  }

  // ========== Input ==========
  _setupInput() {
    this._rawMode = true;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (key) => {
      // Ctrl+C
      if (key === '\x03') {
        this._onShutdown();
        return;
      }

      // Arg input mode (typing a path for a command)
      if (this._argMode) {
        if (key === '\r' || key === '\n') {
          this._executeArgCommand();
          return;
        }
        if (key === '\x1b') {
          this._argMode = false;
          this._argInput = '';
          this._argForCmd = null;
          this.render();
          return;
        }
        if (key === '\x7f' || key === '\b') {
          if (this._argInput.length > 0) {
            this._argInput = this._argInput.slice(0, -1);
          }
          this.render();
          return;
        }
        if (key.length === 1 && key.charCodeAt(0) >= 32) {
          this._argInput += key;
          this.render();
        }
        return;
      }

      // Log mode
      if (this._logMode) {
        if (key === '\x1b') {
          this._logMode = false;
          this._logScroll = 0;
          this.render();
          return;
        }
        if (key === '\x1b[A') {
          this._logScroll = Math.max(0, this._logScroll - 1);
          this.render();
          return;
        }
        if (key === '\x1b[B') {
          const maxScroll = Math.max(0, this.messages.length - this._logVisibleLines());
          this._logScroll = Math.min(maxScroll, this._logScroll + 1);
          this.render();
          return;
        }
        return;
      }

      // Command input mode
      if (this._cmdMode) {
        if (key === '\r' || key === '\n') {
          const input = this._cmdInput.trim();
          this._cmdMode = false;
          this._cmdInput = '';
          if (input) this._onCommand(input);
          this.render();
          return;
        }
        if (key === '\x1b') {
          this._cmdMode = false;
          this._cmdInput = '';
          this.render();
          return;
        }
        if (key === '\x7f' || key === '\b') {
          if (this._cmdInput.length > 0) {
            this._cmdInput = this._cmdInput.slice(0, -1);
          }
          this.render();
          return;
        }
        if (key.length === 1 && key.charCodeAt(0) >= 32) {
          this._cmdInput += key;
          this.render();
        }
        return;
      }

      // Menu navigation mode
      if (key === '\x1b[A') {
        this._resetKeyBuffer();
        this._selectedIndex = Math.max(0, this._selectedIndex - 1);
        this._updateScroll();
        this.render();
        return;
      }
      if (key === '\x1b[B') {
        this._resetKeyBuffer();
        this._selectedIndex = Math.min(this._menuItems.length - 1, this._selectedIndex + 1);
        this._updateScroll();
        this.render();
        return;
      }
      if (key === '\r' || key === '\n') {
        this._resetKeyBuffer();
        this._selectMenuItem();
        return;
      }
      // : key — enter command input mode
      if (key === ':') {
        this._resetKeyBuffer();
        this._cmdMode = true;
        this._cmdInput = '';
        this.render();
        return;
      }
      // L key — enter log viewer
      if (key === 'l' || key === 'L') {
        this._resetKeyBuffer();
        this._logMode = true;
        this._logScroll = Math.max(0, this.messages.length - this._logVisibleLines());
        this.render();
        return;
      }
      // Buffer printable characters for hidden command detection
      if (key.length === 1 && key.charCodeAt(0) >= 32) {
        this._bufferKey(key);
        return;
      }
      // Any other key resets the buffer
      this._resetKeyBuffer();
    });
  }

  _selectMenuItem() {
    const item = this._menuItems[this._selectedIndex];
    if (!item) return;
    if (item.needsArg) {
      this._argMode = true;
      this._argInput = '';
      this._argForCmd = item;
      this.render();
    } else {
      this._onCommand(item.cmd);
    }
  }

  _executeArgCommand() {
    const item = this._argForCmd;
    if (!item) return;
    const arg = this._argInput.trim();
    if (item.cmd === 'rm' && !arg) {
      this.log('Usage: rm <path>');
    } else {
      this._onCommand(item.cmd + (arg ? ' ' + arg : ''));
    }
    this._argMode = false;
    this._argInput = '';
    this._argForCmd = null;
    this.render();
  }

  _updateScroll() {
    if (this._selectedIndex < this._menuScrollOffset) {
      this._menuScrollOffset = this._selectedIndex;
    } else if (this._selectedIndex >= this._menuScrollOffset + this._visibleItems) {
      this._menuScrollOffset = this._selectedIndex - this._visibleItems + 1;
    }
  }

  _logVisibleLines() {
    // Calculate how many log lines fit in the menu area
    const linesForMenu = Math.min(this._menuItems.length, this._visibleItems) + 3;
    return Math.max(0, linesForMenu - 2); // Reserve 2 lines for header + hint
  }

  // ========== Resize ==========
  _setupResize() {
    process.stdout.on('resize', () => {
      this.width = process.stdout.columns || 80;
      this.height = process.stdout.rows || 24;
      this.render();
    });
  }

  // ========== Render ==========
  _renderLoop() {
    this.render();
    this._refreshTimer = setInterval(() => {
      if (this.running) this.render();
    }, this.refreshInterval);
  }

  render() {
    if (!this.running) return;
    const w = this.width;
    const status = this._getStatus();
    const devices = this._getDevices();

    let output = '';
    output += clear;

    // === Header: Logo ===
    output += renderHeader(w);

    // === Status Panel ===
    output += '\n';
    output += sgr(1, 38, 5, 226) + '  ⬡ Status' + reset() + '\n';
    output += renderDivider(w, '─') + '\n';
    output += this._kv('Device', status.name || 'Unknown');
    output += this._kv('Port', String(status.port || '-'));
    output += this._kv('Bind', status.bind || '127.0.0.1');
    output += this._kv('Uptime', this._formatUptime(status.uptime || 0));
    output += this._kv('SMTP', status.smtp || 'Not configured');
    output += this._kv('WS Clients', String(status.wsClients || 0));
    output += this._kv('Storage', status.storage || '-');
    if (status.diskUsage) {
      output += this._kv('Disk Usage', status.diskUsage);
    }
    if (status.registrationOpen !== undefined) {
      output += this._kv('Registration', status.registrationOpen ? sgr(38, 5, 46) + 'Open' + reset() : sgr(38, 5, 196) + 'Closed' + reset());
    }

    // === LAN IPs ===
    output += '\n' + sgr(1, 38, 5, 81) + '  ⬡ Network' + reset() + '\n';
    output += renderDivider(w, '─') + '\n';
    const lanIPs = status.lanIPs || [];
    if (lanIPs.length > 0) {
      for (const ip of lanIPs) {
        const label = ip === '127.0.0.1' ? 'Local' : 'LAN';
        output += this._kv(label, sgr(38, 5, 39) + `http://${ip}:${status.port || 3000}` + reset());
      }
    } else {
      output += this._kv('Network', sgr(38, 5, 240) + 'No network interfaces detected' + reset());
    }
    if (status.publicIP) {
      output += this._kv('Public', sgr(38, 5, 39) + `http://${status.publicIP}:${status.port || 3000}` + reset());
    }

    // === Devices ===
    output += '\n' + sgr(1, 38, 5, 201) + '  ⬡ Devices' + reset() + sgr(38, 5, 240) + ` (${devices.length} online)` + reset() + '\n';
    output += renderDivider(w, '─') + '\n';
    if (devices.length > 0) {
      for (const d of devices) {
        const dot = sgr(38, 5, 46) + '●' + reset();
        output += `  ${dot} ${d.name || 'Unknown'}  ${sgr(38, 5, 240)}@ ${d.address}:${d.port || '-'}${reset()}\n`;
      }
    } else {
      output += '  ' + sgr(38, 5, 240) + '(no devices discovered)' + reset() + '\n';
    }

    // === Messages (last 3) ===
    const recentMsgs = this.messages.slice(-3);
    if (recentMsgs.length > 0) {
      output += '\n' + sgr(1, 38, 5, 240) + '  ⬡ Log' + reset() + '\n';
      output += renderDivider(w, '─') + '\n';
      for (const msg of recentMsgs) {
        output += '  ' + sgr(38, 5, 240) + msg + reset() + '\n';
      }
    }

    // === Spacer ===
    const contentLines = output.split('\n').length;
    const inputArea = this._cmdMode ? 4 : (this._argMode ? 4 : (Math.min(this._menuItems.length, this._visibleItems) + 3));
    const spacerLines = Math.max(0, this.height - contentLines - inputArea);
    for (let i = 0; i < spacerLines; i++) output += '\n';

    // === Menu / Input ===
    output += renderDivider(w, '═') + '\n';
    if (this._logMode) {
      output += sgr(1, 38, 5, 226) + '  ⬡ Log Viewer' + reset() + sgr(38, 5, 240) + ' — Esc to close' + reset() + '\n';
      output += renderDivider(w, '─') + '\n';
      const visible = this._logVisibleLines();
      if (this.messages.length === 0) {
        output += '  ' + sgr(38, 5, 240) + '(no messages)' + reset() + '\n';
      } else {
        const start = this._logScroll;
        const end = Math.min(start + visible, this.messages.length);
        for (let i = start; i < end; i++) {
          const padding = Math.max(0, w - 4 - this.messages[i].replace(/\x1b\[[0-9;]*m/g, '').length);
          output += '  ' + sgr(38, 5, 240) + this.messages[i] + reset() + '\n';
        }
      }
      // Fill remaining lines
      const shown = Math.min(visible, this.messages.length - this._logScroll);
      for (let i = shown; i < visible; i++) output += '\n';
      if (this.messages.length > visible) {
        output += sgr(38, 5, 240) + '  (' + (this._logScroll + 1) + '-' + Math.min(this._logScroll + visible, this.messages.length) + '/' + this.messages.length + ') ' + reset() + sgr(38, 5, 240) + '↑↓ scroll  Esc back' + reset();
      } else {
        output += sgr(38, 5, 240) + '  ↑↓ scroll  Esc back' + reset();
      }
    } else if (this._cmdMode) {
      output += sgr(38, 5, 240) + '  Enter command | Esc to cancel' + reset() + '\n';
      output += sgr(38, 5, 226) + '  : ' + reset() + this._cmdInput;
    } else if (this._argMode) {
      output += sgr(38, 5, 240) + '  Enter path for ' + sgr(1, 38, 5, 226) + this._argForCmd.cmd + reset() + sgr(38, 5, 240) + ' | Esc to cancel' + reset() + '\n';
      output += sgr(38, 5, 226) + '  ' + this._argForCmd.cmd + ' ' + reset() + this._argInput;
    } else {
      const start = this._menuScrollOffset;
      const end = Math.min(start + this._visibleItems, this._menuItems.length);
      for (let i = start; i < end; i++) {
        const item = this._menuItems[i];
        const isSelected = i === this._selectedIndex;
        const label = item.cmd + (item.needsArg ? item.argHint : '');
        if (isSelected) {
          output += sgr(48, 5, 237, 38, 5, 231) + ' ▶ ' + label.padEnd(16) + item.desc + reset() + '\n';
        } else {
          output += sgr(38, 5, 245) + '   ' + label.padEnd(16) + item.desc + reset() + '\n';
        }
      }
      if (this._menuItems.length > this._visibleItems) {
        output += sgr(38, 5, 240) + '  (' + (this._selectedIndex + 1) + '/' + this._menuItems.length + ') ' + reset() + sgr(38, 5, 240) + '↑↓ nav  Enter select  : cmd  L log  Ctrl+C quit' + reset() + '\n';
      } else {
        output += sgr(38, 5, 240) + '  ↑↓ nav  Enter select  : cmd  L log  Ctrl+C quit' + reset() + '\n';
      }
    }

    process.stdout.write(output);
  }

  _kv(key, value) {
    const keyStr = `  ${key.padEnd(16)}`;
    return sgr(38, 5, 245) + keyStr + reset() + value + '\n';
  }

  _formatUptime(ms) {
    if (ms <= 0) return '-';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (parts.length === 0 || sec > 0) parts.push(`${sec}s`);
    return parts.join(' ');
  }

}

module.exports = Tui;