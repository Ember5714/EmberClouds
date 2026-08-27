/**
 * Emberclouds — Command-line interface (readline REPL)
 * Text-based command console. Replaces the old full-screen TUI.
 */
const readline = require('readline');

const HELP = [
  'Commands:',
  '  help              Show this help',
  '  status            Show server status and network info',
  '  users             List registered users',
  '  config            Show current configuration',
  '  ls [path]         List files in a directory',
  '  tree [path]       Show directory tree',
  '  info <path>       Show file/directory details',
  '  mkdir <path>      Create a directory',
  '  rm -y <path>      Delete a file or directory (requires -y)',
  '  clear             Clear the terminal',
  '  stop              Shut down the server',
  '  restart           Restart the server',
  '  exit | quit       Shut down the server',
];

class Cli {
  constructor(options = {}) {
    this._onCommand = options.onCommand || (() => {});
    this._onShutdown = options.onShutdown || (() => {});
    this.rl = null;
    this.running = false;
  }

  // Print a line while keeping the prompt clean.
  log(msg) {
    if (this.rl && this.running) {
      this.rl.output.write('\r\x1b[2K' + msg + '\n');
      this.rl.prompt();
    } else {
      process.stdout.write(msg + '\n');
    }
  }

  start() {
    this.running = true;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'ember> ',
      terminal: true,
      historySize: 200,
    });

    this.rl.on('line', (line) => this._handleLine(line));
    this.rl.on('SIGINT', () => this._onShutdown());

    process.stdout.write('\n  Emberclouds — command-line interface\n');
    process.stdout.write('  Type "help" for commands, Ctrl+C to quit.\n\n');
    this.rl.prompt();
  }

  async _handleLine(line) {
    const input = line.trim();
    if (!input) { this.rl.prompt(); return; }

    const [cmd] = input.split(/\s+/);
    switch (cmd.toLowerCase()) {
      case 'help':
      case '?':
        HELP.forEach((h) => this.log(h));
        return;
      case 'clear':
        process.stdout.write('\x1b[2J\x1b[H');
        this.rl.prompt();
        return;
      case 'exit':
      case 'quit':
        this._onShutdown();
        return;
      default:
        await this._onCommand(input);
        this.rl.prompt();
    }
  }

  stop() {
    this.running = false;
    if (this.rl) {
      this.rl.removeAllListeners('line');
      this.rl.removeAllListeners('SIGINT');
      this.rl.close();
      this.rl = null;
    }
  }
}

module.exports = Cli;