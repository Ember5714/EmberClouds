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

      // Enter
      if (key === '\r' || key === '\n') {
        this._executeCommand();
        return;
      }

      // Backspace
      if (key === '\x7f' || key === '\b') {
        if (this.currentInput.length > 0) {
          this.currentInput = this.currentInput.slice(0, -1);
        }
        this.render();
        return;
      }

      // Escape
      if (key === '\x1b') {
        this.currentInput = '';
        this.render();
        return;
      }

      // Up arrow (history)
      if (key === '\x1b[A') {
        if (this.commandHistory.length > 0) {
          this.historyIdx = Math.min(this.historyIdx + 1, this.commandHistory.length - 1);
          this.currentInput = this.commandHistory[this.commandHistory.length - 1 - this.historyIdx];
        }
        this.render();
        return;
      }

      // Down arrow (history)
      if (key === '\x1b[B') {
        if (this.historyIdx > 0) {
          this.historyIdx--;
          this.currentInput = this.commandHistory[this.commandHistory.length - 1 - this.historyIdx];
        } else {
          this.historyIdx = -1;
          this.currentInput = '';
        }
        this.render();
        return;
      }

      // Tab - autocomplete
      if (key === '\t') {
        this._autocomplete();
        return;
      }

      // Printable characters
      if (key.length === 1 && key.charCodeAt(0) >= 32) {
        this.currentInput += key;
        this.render();
      }
    });
  }

  _autocomplete() {
    const cmds = ['help', 'status', 'users', 'config', 'clear', 'stop', 'restart', 'ls', 'tree', 'info', 'mkdir', 'rm'];
    const input = this.currentInput.toLowerCase();
    const matches = cmds.filter(c => c.startsWith(input));
    if (matches.length === 1) {
      this.currentInput = matches[0];
    } else if (matches.length > 1) {
      // Show common prefix
      let common = matches[0];
      for (const m of matches) {
        while (!m.startsWith(common)) common = common.slice(0, -1);
      }
      if (common.length > input.length) {
        this.currentInput = common;
      }
    }
    this.render();
  }

  _executeCommand() {
    const cmd = this.currentInput.trim();
    if (cmd) {
      this.commandHistory.push(cmd);
      if (this.commandHistory.length > 50) this.commandHistory.shift();
      this.historyIdx = -1;
    }
    this.currentInput = '';
    this._onCommand(cmd);
    this.render();
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
    const inputArea = 4; // prompt + divider + input
    const spacerLines = Math.max(0, this.height - contentLines - inputArea);
    for (let i = 0; i < spacerLines; i++) output += '\n';

    // === Input ===
    output += renderDivider(w, '═') + '\n';
    output += sgr(38, 5, 240) + '  Type ' + sgr(1, 38, 5, 226) + 'help' + reset() + sgr(38, 5, 240) + ' for commands | ' + sgr(1, 38, 5, 196) + 'Ctrl+C' + reset() + sgr(38, 5, 240) + ' to stop' + reset() + '\n';
    output += sgr(38, 5, 226) + '  > ' + reset() + this.currentInput + (this.running ? '' : '');

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

  // ========== Help ==========
  showHelp() {
    const w = this.width;
    this.messages.push('--- Help ---');
    const cmds = [
      ['status', 'Show server status and network info'],
      ['users', 'List registered users'],
      ['config', 'Show current configuration'],
      ['ls [path]', 'List files in repository'],
      ['tree [path]', 'Show directory tree'],
      ['info <path>', 'Show file/directory details'],
      ['mkdir <path>', 'Create a directory'],
      ['rm <path>', 'Delete file/directory (requires -y)'],
      ['clear', 'Clear the message log'],
      ['stop', 'Shutdown the server'],
      ['restart', 'Restart the server'],
    ];
    for (const [cmd, desc] of cmds) {
      this.messages.push(`  ${sgr(38, 5, 226)}${cmd.padEnd(16)}${reset()} ${desc}`);
    }
    this.render();
  }
}

module.exports = Tui;