#!/usr/bin/env node

/**
 * Claude Code Wrapper
 *
 * Launches Claude Code in a PTY (pseudo-terminal) and streams I/O
 * to the remote access server.
 */

import pty from 'node-pty';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Auto-detect protocol based on cert files
const projectRoot = join(__dirname, '..');
const certPath = join(projectRoot, 'cert.pem');
const keyPath = join(projectRoot, 'key.pem');
const USE_HTTPS = existsSync(certPath) && existsSync(keyPath);
const DEFAULT_PROTOCOL = USE_HTTPS ? 'wss' : 'ws';
const SERVER_URL = process.env.CLAUDE_REMOTE_SERVER || `${DEFAULT_PROTOCOL}://localhost:8085`;
const SEAMLESS_MODE = process.env.CLAUDE_SEAMLESS_MODE === 'true';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    tmuxSession: null,
    remainingArgs: []
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tmux-session' && i + 1 < args.length) {
      parsed.tmuxSession = args[i + 1];
      i++; // Skip the next arg (session name)
    } else {
      parsed.remainingArgs.push(args[i]);
    }
  }

  return parsed;
}

const parsedArgs = parseArgs();

// Configuration
const config = {
  command: parsedArgs.tmuxSession ? 'tmux' : (process.env.CLAUDE_CMD || 'claude'),
  args: parsedArgs.tmuxSession
    ? ['attach-session', '-t', parsedArgs.tmuxSession]
    : parsedArgs.remainingArgs,
  cwd: process.cwd(),
  env: process.env,
  cols: parseInt(process.env.CLAUDE_COLS) || process.stdout.columns || 80,
  rows: parseInt(process.env.CLAUDE_ROWS) || process.stdout.rows || 24,
  tmuxSession: parsedArgs.tmuxSession
};

// Logging helper - only log if not in seamless mode
function log(...args) {
  if (!SEAMLESS_MODE) {
    console.log(...args);
  }
}

function logError(...args) {
  if (!SEAMLESS_MODE) {
    console.error(...args);
  }
}

let sessionId = null;
let ws = null;
let terminal = null;

function connectToServer() {
  return new Promise((resolve, reject) => {
    log(`[Wrapper] Connecting to server: ${SERVER_URL} (${config.cols}x${config.rows})`);

    // WebSocket options - allow self-signed certificates for wss://
    const wsOptions = USE_HTTPS ? {
      rejectUnauthorized: false
    } : {};

    ws = new WebSocket(`${SERVER_URL}?role=wrapper&cols=${config.cols}&rows=${config.rows}`, wsOptions);

    ws.on('open', () => {
      log('[Wrapper] Connected to server');
      resolve();
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleServerMessage(message);
      } catch (err) {
        logError('[Wrapper] Error parsing message:', err.message);
      }
    });

    ws.on('close', () => {
      log('[Wrapper] Disconnected from server');
      if (terminal) {
        terminal.kill();
      }
      process.exit(0);
    });

    ws.on('error', (err) => {
      logError('[Wrapper] WebSocket error:', err.message);
      reject(err);
    });
  });
}

function handleServerMessage(message) {
  switch (message.type) {
    case 'session-created':
      sessionId = message.sessionId;
      log(`[Wrapper] Session created: ${sessionId}`);
      log(`[Wrapper] To connect remotely: node client.js ${sessionId}`);
      log(`[Wrapper] Server URL: ${message.serverUrl}`);
      log('');

      // Send initial metadata
      const metadata = {
        cwd: config.cwd,
        command: config.command,
        args: config.args,
        hostname: os.hostname(),
        platform: os.platform(),
        user: os.userInfo().username,
        cols: config.cols,
        rows: config.rows
      };

      if (config.tmuxSession) {
        metadata.tmuxSession = config.tmuxSession;
      }

      sendToServer({
        type: 'metadata',
        data: metadata
      });

      // Start Claude Code
      startClaudeCode();
      break;

    case 'input':
      // Input from remote client
      if (terminal) {
        terminal.write(message.data);
      }
      break;

    case 'resize':
      // Ignore resize from remote clients to prevent PTY size conflicts
      // The PTY size is locked to the local terminal size
      // Remote viewers should adapt their display, not change the PTY
      break;

    case 'server-shutdown':
      log('[Wrapper] Server is shutting down');
      if (terminal) {
        terminal.kill();
      }
      process.exit(0);
      break;

    default:
      logError(`[Wrapper] Unknown message type: ${message.type}`);
  }
}

function sendToServer(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function startClaudeCode() {
  if (config.tmuxSession) {
    log(`[Wrapper] Attaching to tmux session: ${config.tmuxSession}`);
  } else {
    log(`[Wrapper] Starting Claude Code: ${config.command} ${config.args.join(' ')}`);
  }

  log(`[Wrapper] Working directory: ${config.cwd}`);
  log(`[Wrapper] Terminal size: ${config.cols}x${config.rows}`);
  log('');

  // Spawn Claude Code in a PTY
  try {
    terminal = pty.spawn(config.command, config.args, {
      name: 'xterm-256color',
      cols: config.cols,
      rows: config.rows,
      cwd: config.cwd,
      env: config.env
    });
  } catch (err) {
    logError('[Wrapper] Failed to spawn process:', err.message);
    logError('[Wrapper] Command:', config.command);
    logError('[Wrapper] Args:', config.args);
    process.exit(1);
  }

  // Forward output to server
  terminal.onData((data) => {
    // Also write to local stdout (always, for user to see)
    process.stdout.write(data);

    // Send to server for remote clients
    sendToServer({
      type: 'output',
      data: data
    });
  });

  // Also capture any errors on stderr (though PTY combines them)
  terminal.on('data', (data) => {
    // PTY already forwards this, but log if it's an error pattern
    const text = data.toString();
    if (text.toLowerCase().includes('error') || text.toLowerCase().includes('failed')) {
      logError('[Wrapper] Detected error in output:', text.substring(0, 200));
    }
  });

  // Handle terminal exit
  terminal.onExit(({ exitCode, signal }) => {
    log(`\n[Wrapper] Claude Code exited with code ${exitCode}${signal ? ` (signal: ${signal})` : ''}`);

    sendToServer({
      type: 'exit',
      code: exitCode,
      signal: signal
    });

    // Close connection
    if (ws) {
      ws.close();
    }

    process.exit(exitCode);
  });

  // Forward local stdin to terminal (for local interaction)
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(true);
      process.stdin.on('data', (data) => {
        terminal.write(data);
      });
      log('[Wrapper] Local stdin forwarding enabled (TTY mode)');
    } catch (err) {
      logError('[Wrapper] Failed to set raw mode:', err.message);
    }
  } else {
    // Even if not a TTY, try to forward stdin in non-raw mode
    // This allows some IDEs to still send input
    try {
      process.stdin.on('data', (data) => {
        terminal.write(data);
      });
      log('[Wrapper] Local stdin forwarding enabled (non-TTY mode - may have limited functionality)');
    } catch (err) {
      log('[Wrapper] Local stdin not available - use web UI for input');
    }
  }

  // Handle local terminal resize
  process.stdout.on('resize', () => {
    const newCols = process.stdout.columns || 80;
    const newRows = process.stdout.rows || 24;

    log(`[Wrapper] Local terminal resized to ${newCols}x${newRows}`);

    // Resize the PTY
    if (terminal) {
      terminal.resize(newCols, newRows);
    }

    // Update config
    config.cols = newCols;
    config.rows = newRows;

    // Send new dimensions to server
    sendToServer({
      type: 'metadata',
      data: {
        cwd: config.cwd,
        command: config.command,
        args: config.args,
        hostname: os.hostname(),
        platform: os.platform(),
        user: os.userInfo().username,
        cols: newCols,
        rows: newRows
      }
    });
  });
}

// Handle signals
process.on('SIGINT', () => {
  log('\n[Wrapper] Interrupted');
  if (terminal) {
    terminal.kill('SIGINT');
  }
  process.exit(130);
});

process.on('SIGTERM', () => {
  log('\n[Wrapper] Terminated');
  if (terminal) {
    terminal.kill('SIGTERM');
  }
  process.exit(143);
});

// Handle terminal resize
process.stdout.on('resize', () => {
  if (terminal) {
    terminal.resize(process.stdout.columns, process.stdout.rows);
  }
});

// Main
async function main() {
  try {
    // Check if stdin is a TTY (important for CLion and other IDEs)
    if (!process.stdin.isTTY && !SEAMLESS_MODE) {
      log('[Wrapper] Warning: stdin is not a TTY - local input may not work');
      log('[Wrapper] This is common in IDE terminals like CLion');
      log('[Wrapper] You can still view output and control remotely via web UI');
      log('');
    }

    await connectToServer();
  } catch (err) {
    logError('[Wrapper] Failed to connect to server:', err.message);
    logError('[Wrapper] Server URL:', SERVER_URL);
    logError('[Wrapper] Make sure the server is running: npm run server');
    logError('[Wrapper] Or check server status: curl -k https://localhost:8085/health');
    process.exit(1);
  }
}

main();
