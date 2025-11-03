#!/usr/bin/env node

/**
 * Claude Code Remote Client
 *
 * Connects to a remote Claude Code session and displays/controls it.
 */

import { WebSocket } from 'ws';
import blessed from 'blessed';
import { Command } from 'commander';
import chalk from 'chalk';

const program = new Command();

program
  .name('claude-remote')
  .description('Connect to a remote Claude Code session')
  .argument('[session-id]', 'Session ID to connect to (omit to list sessions)')
  .option('-s, --server <url>', 'Server URL', process.env.CLAUDE_REMOTE_SERVER || 'ws://localhost:8765')
  .option('--list', 'List available sessions')
  .action(async (sessionId, options) => {
    if (options.list || !sessionId) {
      await listSessions(options.server);
    } else {
      await connectToSession(sessionId, options.server);
    }
  });

program.parse();

async function listSessions(serverUrl) {
  console.log(chalk.cyan('Fetching sessions from server...'));

  try {
    // Use HTTP endpoint for listing
    const httpUrl = serverUrl.replace('ws://', 'http://').replace('wss://', 'https://');
    const response = await fetch(`${httpUrl}/sessions`);
    const data = await response.json();

    if (data.sessions.length === 0) {
      console.log(chalk.yellow('\nNo active sessions found.'));
      console.log(chalk.gray('Start a session with: npm run wrapper'));
      return;
    }

    console.log(chalk.green(`\nFound ${data.sessions.length} active session(s):\n`));

    for (const session of data.sessions) {
      const age = Math.floor((Date.now() - new Date(session.created).getTime()) / 1000);
      const lastActivity = Math.floor((Date.now() - new Date(session.lastActivity).getTime()) / 1000);

      console.log(chalk.bold(`Session ID: ${session.id}`));
      console.log(chalk.gray(`  Created:       ${Math.floor(age / 60)}m ${age % 60}s ago`));
      console.log(chalk.gray(`  Last Activity: ${Math.floor(lastActivity / 60)}m ${lastActivity % 60}s ago`));

      if (session.metadata) {
        if (session.metadata.hostname) {
          console.log(chalk.gray(`  Hostname:      ${session.metadata.hostname}`));
        }
        if (session.metadata.cwd) {
          console.log(chalk.gray(`  Working Dir:   ${session.metadata.cwd}`));
        }
        if (session.metadata.user) {
          console.log(chalk.gray(`  User:          ${session.metadata.user}`));
        }
      }

      console.log(chalk.cyan(`  Connect:       node client.js ${session.id}`));
      console.log('');
    }

  } catch (err) {
    console.error(chalk.red('Error fetching sessions:'), err.message);
    console.error(chalk.gray('Make sure the server is running: npm run server'));
    process.exit(1);
  }
}

async function connectToSession(sessionId, serverUrl) {
  console.log(chalk.cyan(`Connecting to session ${sessionId}...`));

  const ws = new WebSocket(`${serverUrl}?role=viewer&session=${sessionId}`);

  let screen = null;
  let terminal = null;
  let statusBar = null;
  let inputBox = null;
  let connected = false;

  ws.on('open', () => {
    console.log(chalk.green('Connected!'));
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleServerMessage(message);
    } catch (err) {
      console.error('Error parsing message:', err.message);
    }
  });

  ws.on('error', (err) => {
    if (screen) {
      screen.destroy();
    }
    console.error(chalk.red('WebSocket error:'), err.message);
    process.exit(1);
  });

  ws.on('close', () => {
    if (screen) {
      screen.destroy();
    }
    console.log(chalk.yellow('Disconnected from session'));
    process.exit(0);
  });

  function handleServerMessage(message) {
    switch (message.type) {
      case 'session-attached':
        console.log(chalk.green('Attached to session!'));
        connected = true;
        initializeUI(message);
        break;

      case 'output':
        if (terminal) {
          appendToTerminal(message.data);
        }
        break;

      case 'input-echo':
        // Input from another viewer
        if (terminal) {
          appendToTerminal(message.data);
        }
        break;

      case 'metadata':
        if (statusBar) {
          updateStatusBar(message.data);
        }
        break;

      case 'exit':
        if (screen) {
          screen.destroy();
        }
        console.log(chalk.yellow(`\nSession exited with code ${message.code}`));
        process.exit(0);
        break;

      case 'wrapper-disconnected':
        if (statusBar) {
          statusBar.setContent('{red-fg}Wrapper disconnected - waiting for reconnection...{/red-fg}');
          screen.render();
        }
        break;

      case 'server-shutdown':
        if (screen) {
          screen.destroy();
        }
        console.log(chalk.red('\nServer is shutting down'));
        process.exit(0);
        break;

      case 'error':
        if (screen) {
          screen.destroy();
        }
        console.error(chalk.red('Error:'), message.error);
        process.exit(1);
        break;
    }
  }

  function appendToTerminal(data) {
    if (!terminal) return;

    // Strip ANSI escape codes for blessed compatibility
    const stripped = data.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');

    // Use log method which handles output properly
    terminal.log(stripped);
  }

  function initializeUI(sessionData) {
    // Clear console
    console.log('\n\n');

    // Create blessed screen
    screen = blessed.screen({
      smartCSR: true,
      title: `Claude Code Remote - ${sessionId}`,
      fullUnicode: true
    });

    // Status bar
    statusBar = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      style: {
        bg: 'blue',
        fg: 'white'
      }
    });
    screen.append(statusBar);

    // Terminal output area
    terminal = blessed.log({
      top: 1,
      left: 0,
      width: '100%',
      height: '100%-2',
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: '█',
        track: {
          bg: 'gray'
        },
        style: {
          inverse: true
        }
      },
      mouse: true,
      keys: true,
      vi: false,
      tags: false,
      style: {
        bg: 'black',
        fg: 'white'
      }
    });
    screen.append(terminal);

    // Input hint bar
    const hintBar = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      content: '{cyan-fg}Ctrl+I{/cyan-fg}: Send Input | {cyan-fg}Ctrl+C{/cyan-fg}: Quit | {cyan-fg}Ctrl+L{/cyan-fg}: Clear | {cyan-fg}Mouse{/cyan-fg}: Scroll',
      style: {
        bg: 'black',
        fg: 'gray'
      }
    });
    screen.append(hintBar);

    // Update status bar
    updateStatusBar(sessionData.metadata);

    // Display history
    if (sessionData.history) {
      for (const item of sessionData.history) {
        if (item.type === 'output') {
          appendToTerminal(item.data);
        }
      }
    }

    // Key bindings
    screen.key(['C-c'], () => {
      screen.destroy();
      console.log(chalk.yellow('\nDisconnected'));
      process.exit(0);
    });

    screen.key(['C-l'], () => {
      terminal.setContent('');
      screen.render();
    });

    screen.key(['C-i'], () => {
      openInputDialog();
    });

    // Focus terminal for scrolling
    terminal.focus();

    screen.render();
  }

  function updateStatusBar(metadata) {
    const parts = [
      `Session: ${sessionId}`,
      metadata.hostname ? `Host: ${metadata.hostname}` : null,
      metadata.user ? `User: ${metadata.user}` : null,
      metadata.cwd ? `CWD: ${metadata.cwd}` : null
    ].filter(Boolean);

    statusBar.setContent(` ${parts.join(' | ')} `);
    screen.render();
  }

  function openInputDialog() {
    // Create input box
    inputBox = blessed.textbox({
      top: 'center',
      left: 'center',
      width: '80%',
      height: 3,
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'cyan'
        },
        focus: {
          border: {
            fg: 'green'
          }
        }
      },
      label: ' Send Input (Enter to send, Esc to cancel) ',
      inputOnFocus: true
    });

    screen.append(inputBox);

    inputBox.on('submit', (value) => {
      if (value) {
        // Send input to server with carriage return
        ws.send(JSON.stringify({
          type: 'input',
          data: value + '\r'
        }));
      }

      screen.remove(inputBox);
      inputBox.destroy();
      terminal.focus();
      screen.render();
    });

    inputBox.on('cancel', () => {
      screen.remove(inputBox);
      inputBox.destroy();
      terminal.focus();
      screen.render();
    });

    inputBox.key(['escape'], () => {
      screen.remove(inputBox);
      inputBox.destroy();
      terminal.focus();
      screen.render();
    });

    inputBox.focus();
    screen.render();
  }
}
