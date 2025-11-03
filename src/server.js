#!/usr/bin/env node

/**
 * Claude Code Remote Access Server
 *
 * Manages Claude Code sessions and provides remote access via WebSocket.
 * Acts as a central hub for session I/O multiplexing.
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { readdir, stat } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import os from 'os';

const PORT = process.env.PORT || 8085;
const HOST = process.env.HOST || '0.0.0.0';

// Session storage
const sessions = new Map();
// Client connections: Map<clientId, {ws, sessionId, role}>
const clients = new Map();

/**
 * Session structure:
 * {
 *   id: string,
 *   created: Date,
 *   lastActivity: Date,
 *   wrapperWs: WebSocket,
 *   metadata: { cwd, pid, ... },
 *   history: Array<{type, data, timestamp}>
 * }
 */

function createSession(wrapperWs, metadata) {
  const id = crypto.randomBytes(8).toString('hex');
  const session = {
    id,
    created: new Date(),
    lastActivity: new Date(),
    wrapperWs,
    metadata: metadata || {},
    history: [], // Keep last 10000 lines for new clients
    maxHistory: 10000
  };

  sessions.set(id, session);
  console.log(`[Session] Created session ${id}`);
  return session;
}

function addToHistory(session, type, data) {
  session.history.push({
    type,
    data,
    timestamp: new Date()
  });

  // Trim history
  if (session.history.length > session.maxHistory) {
    session.history = session.history.slice(-session.maxHistory);
  }
}

function broadcastToSession(sessionId, message) {
  // Send to all clients watching this session
  for (const [clientId, client] of clients.entries()) {
    if (client.sessionId === sessionId && client.role === 'viewer' && client.ws.readyState === 1) {
      try {
        client.ws.send(JSON.stringify(message));
      } catch (err) {
        console.error(`[Broadcast] Error sending to client ${clientId}:`, err.message);
      }
    }
  }
}

function handleWrapperMessage(ws, clientId, message) {
  const client = clients.get(clientId);
  if (!client) return;

  const session = sessions.get(client.sessionId);
  if (!session) return;

  session.lastActivity = new Date();

  switch (message.type) {
    case 'output':
      // Claude Code output (stdout/stderr)
      addToHistory(session, 'output', message.data);
      broadcastToSession(session.id, message);
      break;

    case 'metadata':
      // Update session metadata
      session.metadata = { ...session.metadata, ...message.data };
      broadcastToSession(session.id, message);
      break;

    case 'exit':
      // Session ended
      console.log(`[Session] Session ${session.id} ended with code ${message.code}`);
      broadcastToSession(session.id, message);
      sessions.delete(session.id);
      break;

    default:
      console.warn(`[Wrapper] Unknown message type: ${message.type}`);
  }
}

function handleViewerMessage(ws, clientId, message) {
  const client = clients.get(clientId);
  if (!client) return;

  const session = sessions.get(client.sessionId);
  if (!session || !session.wrapperWs || session.wrapperWs.readyState !== 1) {
    ws.send(JSON.stringify({ type: 'error', error: 'Session not available' }));
    return;
  }

  switch (message.type) {
    case 'input':
      // Forward input to the wrapper (and thus to Claude Code)
      session.wrapperWs.send(JSON.stringify({
        type: 'input',
        data: message.data
      }));

      // Also broadcast to other viewers
      broadcastToSession(session.id, {
        type: 'input-echo',
        data: message.data
      });
      break;

    case 'resize':
      // Forward terminal resize
      session.wrapperWs.send(JSON.stringify({
        type: 'resize',
        cols: message.cols,
        rows: message.rows
      }));
      break;

    default:
      console.warn(`[Viewer] Unknown message type: ${message.type}`);
  }
}

function handleConnection(ws, req) {
  const clientId = crypto.randomBytes(8).toString('hex');
  const url = new URL(req.url, `http://${req.headers.host}`);
  const role = url.searchParams.get('role'); // 'wrapper' or 'viewer'
  const sessionId = url.searchParams.get('session');

  console.log(`[Server] New connection: ${clientId} (role: ${role}, session: ${sessionId || 'new'})`);

  if (role === 'wrapper') {
    // This is a new Claude Code session
    const session = createSession(ws, {});
    clients.set(clientId, {
      ws,
      sessionId: session.id,
      role: 'wrapper'
    });

    // Send session ID to wrapper
    ws.send(JSON.stringify({
      type: 'session-created',
      sessionId: session.id,
      serverUrl: `ws://${HOST}:${PORT}`
    }));

  } else if (role === 'viewer') {
    // Client wants to view/control a session
    if (!sessionId) {
      // Send list of available sessions
      const sessionList = Array.from(sessions.values()).map(s => ({
        id: s.id,
        created: s.created,
        lastActivity: s.lastActivity,
        metadata: s.metadata
      }));

      ws.send(JSON.stringify({
        type: 'session-list',
        sessions: sessionList
      }));

      ws.close();
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      ws.send(JSON.stringify({
        type: 'error',
        error: `Session ${sessionId} not found`
      }));
      ws.close();
      return;
    }

    clients.set(clientId, {
      ws,
      sessionId,
      role: 'viewer'
    });

    // Send session info and history
    ws.send(JSON.stringify({
      type: 'session-attached',
      sessionId: session.id,
      metadata: session.metadata,
      history: session.history
    }));

  } else {
    ws.send(JSON.stringify({
      type: 'error',
      error: 'Invalid role. Use ?role=wrapper or ?role=viewer'
    }));
    ws.close();
    return;
  }

  // Handle messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      const client = clients.get(clientId);

      if (client.role === 'wrapper') {
        handleWrapperMessage(ws, clientId, message);
      } else if (client.role === 'viewer') {
        handleViewerMessage(ws, clientId, message);
      }
    } catch (err) {
      console.error(`[Server] Error handling message:`, err.message);
    }
  });

  // Handle disconnection
  ws.on('close', () => {
    console.log(`[Server] Client ${clientId} disconnected`);
    const client = clients.get(clientId);

    if (client && client.role === 'wrapper') {
      // Wrapper disconnected, remove session
      const session = sessions.get(client.sessionId);
      if (session) {
        console.log(`[Session] Wrapper disconnected for session ${session.id}`);
        broadcastToSession(session.id, {
          type: 'wrapper-disconnected'
        });
        // Keep session for a bit in case wrapper reconnects
        setTimeout(() => {
          if (sessions.has(client.sessionId)) {
            console.log(`[Session] Cleaning up session ${client.sessionId}`);
            sessions.delete(client.sessionId);
          }
        }, 30000); // 30 second grace period
      }
    }

    clients.delete(clientId);
  });

  ws.on('error', (err) => {
    console.error(`[Server] WebSocket error for ${clientId}:`, err.message);
  });
}

// Directory browser handler
async function handleBrowseRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let requestedPath = url.searchParams.get('path') || os.homedir();

    // Resolve and normalize path
    requestedPath = resolve(requestedPath);

    // Basic security: don't allow browsing outside user's home or /tmp
    const homeDir = os.homedir();
    if (!requestedPath.startsWith(homeDir) && !requestedPath.startsWith('/tmp')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }

    // Read directory contents
    const entries = await readdir(requestedPath, { withFileTypes: true });
    const items = [];

    // Add parent directory entry if not at root
    if (requestedPath !== '/' && requestedPath !== homeDir) {
      items.push({
        name: '..',
        path: dirname(requestedPath),
        isDirectory: true,
        isParent: true
      });
    }

    // Add directories first, then files
    const dirs = [];
    const files = [];

    for (const entry of entries) {
      // Skip hidden files
      if (entry.name.startsWith('.')) continue;

      const fullPath = join(requestedPath, entry.name);
      const item = {
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory()
      };

      if (entry.isDirectory()) {
        dirs.push(item);
      } else {
        files.push(item);
      }
    }

    // Sort alphabetically
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      currentPath: requestedPath,
      items: [...items, ...dirs, ...files]
    }));
  } catch (err) {
    console.error('[Browse] Error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// Start session handler
async function handleStartSession(req, res) {
  let body = '';

  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      const { workingDir, command, cols, rows } = JSON.parse(body);

      if (!workingDir) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'workingDir is required' }));
        return;
      }

      // Validate directory exists and is accessible
      const resolvedPath = resolve(workingDir);
      const homeDir = os.homedir();

      // Security check
      if (!resolvedPath.startsWith(homeDir) && !resolvedPath.startsWith('/tmp')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Access denied' }));
        return;
      }

      try {
        const stats = await stat(resolvedPath);
        if (!stats.isDirectory()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not a directory' }));
          return;
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Directory not found' }));
        return;
      }

      // Generate session ID
      const sessionId = crypto.randomBytes(8).toString('hex');
      const tmuxSessionName = `claude-${sessionId}`;

      // Check if tmux is available
      const tmuxCheck = spawn('which', ['tmux']);
      let tmuxAvailable = false;

      await new Promise((resolve) => {
        tmuxCheck.on('close', (code) => {
          tmuxAvailable = code === 0;
          resolve();
        });
      });

      if (!tmuxAvailable) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'tmux is not installed' }));
        return;
      }

      // Spawn wrapper.js inside a tmux session
      // This way the session runs in tmux (can be attached to) but wrapper works normally
      const wrapperPath = new URL('./wrapper.js', import.meta.url).pathname;

      // Get full paths to node and claude binaries
      // Claude is usually in the same directory as node (when installed via npm global)
      const nodePath = process.execPath;
      const nodeBinDir = dirname(nodePath);
      const claudeCmd = command || join(nodeBinDir, 'claude');

      const tmuxArgs = [
        'new-session',
        '-d',  // Detached
        '-s', tmuxSessionName,  // Session name
        '-c', resolvedPath,  // Working directory
      ];

      // Set terminal dimensions if provided
      if (cols && rows) {
        tmuxArgs.push('-x', cols.toString(), '-y', rows.toString());
      }

      // The command to run inside tmux: bash script that logs and runs wrapper
      // We use a shell script to capture any errors
      const logFile = `/tmp/claude-session-${sessionId}.log`;
      const shellCommand = `exec > ${logFile} 2>&1; echo "Starting wrapper at $(date)"; echo "PATH=$PATH"; echo "Node: ${nodePath}"; echo "Claude: ${claudeCmd}"; echo "Wrapper: ${wrapperPath}"; CLAUDE_CMD=${claudeCmd} CLAUDE_SEAMLESS_MODE=true CLAUDE_REMOTE_SERVER=ws://${HOST}:${PORT} CLAUDE_COLS=${cols || 80} CLAUDE_ROWS=${rows || 24} ${nodePath} ${wrapperPath}; echo "Wrapper exited with code $? at $(date)"`;

      tmuxArgs.push('/bin/bash', '-c', shellCommand);

      console.log(`[Session] Running: tmux ${tmuxArgs.join(' ')}`);

      const tmuxCmd = spawn('tmux', tmuxArgs);

      // Capture output from tmux command (for debugging)
      let tmuxOutput = '';
      let tmuxError = '';

      if (tmuxCmd.stdout) {
        tmuxCmd.stdout.on('data', (data) => {
          tmuxOutput += data.toString();
        });
      }

      if (tmuxCmd.stderr) {
        tmuxCmd.stderr.on('data', (data) => {
          tmuxError += data.toString();
        });
      }

      await new Promise((resolve, reject) => {
        tmuxCmd.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            console.error(`[Session] tmux failed with code ${code}`);
            if (tmuxOutput) console.error(`[Session] tmux stdout: ${tmuxOutput}`);
            if (tmuxError) console.error(`[Session] tmux stderr: ${tmuxError}`);
            reject(new Error(`tmux failed with code ${code}`));
          }
        });

        tmuxCmd.on('error', (err) => {
          console.error(`[Session] tmux error:`, err);
          reject(err);
        });
      });

      console.log(`[Session] Created tmux session ${tmuxSessionName} in ${resolvedPath} (running wrapper inside tmux)`);
      console.log(`[Session] Logs: ${logFile}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        sessionId: 'pending',  // Session ID will be assigned by wrapper when it connects
        tmuxSession: tmuxSessionName,
        workingDir: resolvedPath,
        logFile: logFile,
        message: `Session starting in ${resolvedPath}. Attach with: tmux attach -t ${tmuxSessionName}\nLogs: ${logFile}`
      }));

    } catch (err) {
      console.error('[Start Session] Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

// Create HTTP server for WebSocket
const httpServer = createServer((req, res) => {
  // Serve web client
  if (req.url === '/' || req.url === '/index.html') {
    import('fs').then(fs => {
      import('path').then(path => {
        import('url').then(url => {
          const __filename = url.fileURLToPath(import.meta.url);
          const __dirname = path.dirname(__filename);
          const filePath = path.join(__dirname, '..', 'public', 'index.html');

          fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
              res.writeHead(404, { 'Content-Type': 'text/plain' });
              res.end('Web client not found');
            } else {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(data);
            }
          });
        });
      });
    });
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      sessions: sessions.size,
      clients: clients.size
    }));
  } else if (req.url === '/sessions') {
    const sessionList = Array.from(sessions.values()).map(s => ({
      id: s.id,
      created: s.created,
      lastActivity: s.lastActivity,
      metadata: s.metadata
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sessions: sessionList }));
  } else if (req.url.startsWith('/browse')) {
    // File browser endpoint
    handleBrowseRequest(req, res);
  } else if (req.url === '/start-session' && req.method === 'POST') {
    // Start new session endpoint
    handleStartSession(req, res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// Create WebSocket server
const wss = new WebSocketServer({ server: httpServer });
wss.on('connection', handleConnection);

// Start server
httpServer.listen(PORT, HOST, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║   Claude Code Remote Access Server                        ║
╟────────────────────────────────────────────────────────────╢
║   WebSocket: ws://${HOST}:${PORT}                    ║
║   HTTP:      http://${HOST}:${PORT}                  ║
╟────────────────────────────────────────────────────────────╢
║   Endpoints:                                               ║
║   - GET /health    Server health check                     ║
║   - GET /sessions  List active sessions                    ║
╚════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');

  // Notify all clients
  for (const [clientId, client] of clients.entries()) {
    try {
      client.ws.send(JSON.stringify({
        type: 'server-shutdown'
      }));
      client.ws.close();
    } catch (err) {
      // Ignore
    }
  }

  httpServer.close(() => {
    console.log('[Server] Closed');
    process.exit(0);
  });
});
