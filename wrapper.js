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
import { dirname } from 'path';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SERVER_URL = process.env.CLAUDE_REMOTE_SERVER || 'ws://localhost:8765';

// Configuration
const config = {
  command: process.env.CLAUDE_CMD || 'claude',
  args: process.argv.slice(2), // Forward any args passed to wrapper
  cwd: process.cwd(),
  env: process.env,
  cols: process.stdout.columns || 80,
  rows: process.stdout.rows || 24
};

let sessionId = null;
let ws = null;
let terminal = null;

function connectToServer() {
  return new Promise((resolve, reject) => {
    console.log(`[Wrapper] Connecting to server: ${SERVER_URL}`);

    ws = new WebSocket(`${SERVER_URL}?role=wrapper`);

    ws.on('open', () => {
      console.log('[Wrapper] Connected to server');
      resolve();
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleServerMessage(message);
      } catch (err) {
        console.error('[Wrapper] Error parsing message:', err.message);
      }
    });

    ws.on('close', () => {
      console.log('[Wrapper] Disconnected from server');
      if (terminal) {
        terminal.kill();
      }
      process.exit(0);
    });

    ws.on('error', (err) => {
      console.error('[Wrapper] WebSocket error:', err.message);
      reject(err);
    });
  });
}

function handleServerMessage(message) {
  switch (message.type) {
    case 'session-created':
      sessionId = message.sessionId;
      console.log(`[Wrapper] Session created: ${sessionId}`);
      console.log(`[Wrapper] To connect remotely: node client.js ${sessionId}`);
      console.log(`[Wrapper] Server URL: ${message.serverUrl}`);
      console.log('');

      // Send initial metadata
      sendToServer({
        type: 'metadata',
        data: {
          cwd: config.cwd,
          command: config.command,
          args: config.args,
          hostname: os.hostname(),
          platform: os.platform(),
          user: os.userInfo().username
        }
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
      // Terminal resize from remote client
      if (terminal && message.cols && message.rows) {
        terminal.resize(message.cols, message.rows);
      }
      break;

    case 'server-shutdown':
      console.log('[Wrapper] Server is shutting down');
      if (terminal) {
        terminal.kill();
      }
      process.exit(0);
      break;

    default:
      console.warn(`[Wrapper] Unknown message type: ${message.type}`);
  }
}

function sendToServer(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function startClaudeCode() {
  console.log(`[Wrapper] Starting Claude Code: ${config.command} ${config.args.join(' ')}`);

  // Spawn Claude Code in a PTY
  terminal = pty.spawn(config.command, config.args, {
    name: 'xterm-256color',
    cols: config.cols,
    rows: config.rows,
    cwd: config.cwd,
    env: config.env
  });

  // Forward output to server
  terminal.onData((data) => {
    // Also write to local stdout for debugging
    process.stdout.write(data);

    // Send to server for remote clients
    sendToServer({
      type: 'output',
      data: data
    });
  });

  // Handle terminal exit
  terminal.onExit(({ exitCode, signal }) => {
    console.log(`\n[Wrapper] Claude Code exited with code ${exitCode}${signal ? ` (signal: ${signal})` : ''}`);

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
    process.stdin.setRawMode(true);
    process.stdin.on('data', (data) => {
      terminal.write(data);
    });
  }
}

// Handle signals
process.on('SIGINT', () => {
  console.log('\n[Wrapper] Interrupted');
  if (terminal) {
    terminal.kill('SIGINT');
  }
  process.exit(130);
});

process.on('SIGTERM', () => {
  console.log('\n[Wrapper] Terminated');
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
    await connectToServer();
  } catch (err) {
    console.error('[Wrapper] Failed to connect to server:', err.message);
    console.error('[Wrapper] Make sure the server is running: npm run server');
    process.exit(1);
  }
}

main();
