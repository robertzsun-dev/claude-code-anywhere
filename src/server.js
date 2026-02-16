#!/usr/bin/env node

/**
 * Claude Code Remote Access Server
 *
 * Manages Claude Code sessions and provides remote access via WebSocket.
 * Acts as a central hub for session I/O multiplexing.
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { readFileSync, existsSync } from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { readdir, stat } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// Mobile app support modules
import { DeviceRegistry } from './devices/device-registry.js';
import { FCMService } from './push/fcm-service.js';
import { createMobileRoutes } from './api/mobile-routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 8085;
const HOST = process.env.HOST || '0.0.0.0';
const USE_HTTPS = process.env.HTTPS === 'true' || existsSync(join(__dirname, '..', 'cert.pem'));

// Session storage
const sessions = new Map();
// Client connections: Map<clientId, {ws, sessionId, role}>
const clients = new Map();
// PID-to-session index: Map<pid, sessionId> for reconnection by PID
const pidIndex = new Map();

// Grace period before reaping disconnected sessions
const INTERCEPT_GRACE_PERIOD = 300_000; // 5 minutes

// WebSocket ping/pong settings
const WS_PING_INTERVAL = 30_000;  // Ping every 30s; dead if no pong by next sweep

// Stale session reaper settings
const REAPER_INTERVAL = 60_000;            // Check every 60s
const HEARTBEAT_STALE_THRESHOLD = 120_000; // No heartbeat in 2 minutes = suspect

// Mobile app infrastructure
const deviceRegistry = new DeviceRegistry({
  persistPath: process.env.DEVICE_REGISTRY_PATH || join(os.homedir(), '.claude-remote', 'devices.json')
});
const fcmService = new FCMService();

// Helper to get server URL
function getServerUrl() {
  const protocol = USE_HTTPS ? 'https' : 'http';
  // If bound to 0.0.0.0, try to get actual IP
  let actualHost = HOST;
  if (HOST === '0.0.0.0' || HOST === '::') {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          actualHost = net.address;
          break;
        }
      }
      if (actualHost !== HOST) break;
    }
  }
  return `${protocol}://${actualHost}:${PORT}`;
}

// Create mobile routes handler
const handleMobileRoute = createMobileRoutes({
  deviceRegistry,
  sessions,
  fcmService,
  getServerUrl
});

/**
 * Session structure:
 * {
 *   id: string,
 *   type: 'intercept',
 *   created: Date,
 *   lastActivity: Date,
 *   interceptorWs: WebSocket,
 *   metadata: { cwd, pid, ... },
 *   events: Array<{type, ts, ...}>,  // Structured API events (SSE, requests, responses)
 * }
 */

function createInterceptSession(interceptorWs, metadata) {
  const id = crypto.randomBytes(8).toString('hex');

  const session = {
    id,
    type: 'intercept',
    created: new Date(),
    lastActivity: new Date(),
    interceptorWs,
    metadata: metadata || {},
    events: [],      // Structured API events (SSE, requests, responses)
    maxEvents: 10000,
    // Accumulated conversation state for late-joining viewers
    conversation: [],  // Array of {role, content_blocks} representing the conversation
  };

  sessions.set(id, session);
  console.log(`[Session] Created intercept session ${id}`);
  return session;
}

// Register a PID for session lookup
function registerPid(pid, sessionId) {
  if (pid && sessionId) {
    pidIndex.set(Number(pid), sessionId);
  }
}

// Find an existing session by PID (fallback when session ID is unknown/expired)
function findSessionByPid(pid) {
  if (!pid) return null;
  const sessionId = pidIndex.get(Number(pid));
  if (sessionId && sessions.has(sessionId)) {
    return sessions.get(sessionId);
  }
  // Clean up stale index entry
  if (sessionId) pidIndex.delete(Number(pid));
  return null;
}

// Convert intercept events to the HistoryItem format ({type, data, timestamp})
// used by the mobile app and session-attached messages.
function eventsToHistory(events) {
  const items = [];
  for (const evt of events) {
    const ts = evt.ts ? new Date(evt.ts).toISOString() : new Date().toISOString();
    switch (evt.type) {
      case 'api_request': {
        const last = evt.data?.last_turn;
        if (last) items.push({ type: 'input', data: last, timestamp: ts });
        break;
      }
      case 'sse_event': {
        if (evt.event === 'content_block_delta' && evt.data) {
          try {
            const parsed = typeof evt.data === 'string' ? JSON.parse(evt.data) : evt.data;
            const text = parsed?.delta?.text;
            if (text) items.push({ type: 'output', data: text, timestamp: ts });
          } catch (_) { /* ignore */ }
        }
        break;
      }
      case 'api_response': {
        const content = evt.data?.content;
        if (Array.isArray(content)) {
          const text = content.filter(b => b.type === 'text').map(b => b.text).join('\n');
          if (text) items.push({ type: 'output', data: text, timestamp: ts });
        }
        break;
      }
      case 'api_error':
        items.push({ type: 'output', data: `Error: ${evt.error || 'unknown'}`, timestamp: ts });
        break;
    }
  }
  return items;
}

function addToEvents(session, event) {
  session.events.push(event);
  if (session.events.length > session.maxEvents) {
    session.events = session.events.slice(-session.maxEvents);
  }
}

function handleInterceptorMessage(ws, clientId, message) {
  const client = clients.get(clientId);
  if (!client) return;

  const session = sessions.get(client.sessionId);
  if (!session) return;

  session.lastActivity = new Date();

  switch (message.type) {
    case 'api_request':
    case 'sse_event':
    case 'api_response':
    case 'api_error': {
      // Store the event
      addToEvents(session, message);
      // Broadcast structured event to all viewers (web intercept viewer)
      broadcastToSession(session.id, message);

      // Also synthesize 'output' messages for mobile app compatibility.
      // The mobile app only handles {type:'output', data} messages.
      if (message.type === 'sse_event' && message.event === 'content_block_delta' && message.data) {
        try {
          const parsed = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
          const text = parsed?.delta?.text;
          if (text) {
            broadcastToSession(session.id, { type: 'output', data: text });
          }
        } catch (_) { /* ignore */ }
      }
      break;
    }

    case 'heartbeat': {
      // Keepalive from interceptor - update lastActivity and track PID
      session.lastHeartbeat = new Date();
      if (message.pid) {
        session.metadata.pid = message.pid;
        registerPid(message.pid, session.id);
      }
      // Don't store heartbeats in events or broadcast - they're just keepalives
      break;
    }

    case 'metadata': {
      // Update session metadata (interceptor sends cwd, hostname, etc.)
      session.metadata = { ...session.metadata, ...message.data };
      if (message.data?.pid) registerPid(message.data.pid, session.id);
      broadcastToSession(session.id, { type: 'metadata', data: session.metadata });
      break;
    }

    case 'exit': {
      console.log(`[Session] Intercept session ${session.id} ended (code: ${message.code}, signal: ${message.signal || 'none'})`);
      broadcastToSession(session.id, message);
      // Cancel any pending cleanup timer (could exist if interceptor disconnected
      // and reconnected before sending exit)
      if (session._cleanupTimer) {
        clearTimeout(session._cleanupTimer);
        session._cleanupTimer = null;
      }
      // Clean up PID index
      if (session.metadata?.pid) pidIndex.delete(Number(session.metadata.pid));
      sessions.delete(session.id);
      break;
    }

    default:
      console.warn(`[Interceptor] Unknown message type: ${message.type}`);
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

function handleViewerMessage(ws, clientId, message) {
  const client = clients.get(clientId);
  if (!client) return;

  const session = sessions.get(client.sessionId);
  if (!session) {
    ws.send(JSON.stringify({ type: 'error', error: 'Session not available' }));
    return;
  }

  if (!session.interceptorWs || session.interceptorWs.readyState !== 1) {
    ws.send(JSON.stringify({ type: 'error', error: 'Session not available' }));
    return;
  }

  switch (message.type) {
    case 'input':
      // Forward input to the interceptor for stdin injection
      session.interceptorWs.send(JSON.stringify({
        type: 'input',
        data: message.data
      }));

      // Also broadcast to other viewers
      broadcastToSession(session.id, {
        type: 'input-echo',
        data: message.data
      });
      break;

    default:
      console.warn(`[Viewer] Unknown message type: ${message.type}`);
  }
}

function handleConnection(ws, req) {
  const clientId = crypto.randomBytes(8).toString('hex');
  const url = new URL(req.url, `http://${req.headers.host}`);
  const role = url.searchParams.get('role');
  const sessionId = url.searchParams.get('session');

  console.log(`[Server] New connection: ${clientId} (role: ${role}, session: ${sessionId || 'new'})`);

  if (role === 'viewer') {
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

    // Send session info and historical events.
    // Include both `events` (structured, for web viewer) and `history`
    // (text items, for mobile app backward compat).
    const events = session.events || [];
    ws.send(JSON.stringify({
      type: 'session-attached',
      sessionId: session.id,
      sessionType: 'intercept',
      metadata: session.metadata,
      events,
      history: eventsToHistory(events),
    }));

  } else if (role === 'interceptor') {
    // This is an API interceptor (injected into Claude Code via --require)
    let session;
    const pid = url.searchParams.get('pid');

    // Support reconnection with multiple fallback strategies:
    // 1. Try matching by session ID (interceptor remembers its session)
    // 2. Try matching by PID (same process, lost session ID after server restart)
    // 3. Create new session as last resort
    if (sessionId && sessions.has(sessionId)) {
      session = sessions.get(sessionId);
      session.interceptorWs = ws;
      session.lastActivity = new Date();
      // Cancel any pending cleanup timer
      if (session._cleanupTimer) {
        clearTimeout(session._cleanupTimer);
        session._cleanupTimer = null;
      }
      console.log(`[Session] Interceptor reconnected to session ${sessionId} (by session ID)`);
      broadcastToSession(session.id, { type: 'interceptor-reconnected' });
    } else if (pid && (session = findSessionByPid(pid))) {
      session.interceptorWs = ws;
      session.lastActivity = new Date();
      if (session._cleanupTimer) {
        clearTimeout(session._cleanupTimer);
        session._cleanupTimer = null;
      }
      console.log(`[Session] Interceptor reconnected to session ${session.id} (by PID ${pid})`);
      broadcastToSession(session.id, { type: 'interceptor-reconnected' });
    } else {
      session = createInterceptSession(ws, {});
      if (pid) registerPid(pid, session.id);
    }

    clients.set(clientId, {
      ws,
      sessionId: session.id,
      role: 'interceptor'
    });

    // Send session ID back to interceptor
    ws.send(JSON.stringify({
      type: 'session-created',
      sessionId: session.id,
      serverUrl: `ws://${HOST}:${PORT}`
    }));

  } else {
    ws.send(JSON.stringify({
      type: 'error',
      error: 'Invalid role. Use ?role=viewer or ?role=interceptor'
    }));
    ws.close();
    return;
  }

  // Handle messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      const client = clients.get(clientId);

      if (client.role === 'viewer') {
        handleViewerMessage(ws, clientId, message);
      } else if (client.role === 'interceptor') {
        handleInterceptorMessage(ws, clientId, message);
      }
    } catch (err) {
      console.error(`[Server] Error handling message:`, err.message);
    }
  });

  // Handle disconnection
  ws.on('close', () => {
    console.log(`[Server] Client ${clientId} disconnected`);
    const client = clients.get(clientId);

    if (client && client.role === 'interceptor') {
      const session = sessions.get(client.sessionId);
      if (session) {
        // Only act on this disconnect if the closing WebSocket is still
        // the session's current interceptor. If a reconnect happened (creating a
        // new clientId + ws), the OLD ws will eventually fire 'close'. Without this
        // guard, the stale close handler would reap the session even though a new
        // interceptor is actively connected.
        if (session.interceptorWs !== ws) {
          console.log(`[Session] Ignoring stale interceptor disconnect for session ${session.id} (already replaced)`);
        } else {
          console.log(`[Session] Interceptor disconnected for session ${session.id}`);
          broadcastToSession(session.id, {
            type: 'wrapper-disconnected'
          });
          // Store timer so it can be cancelled on reconnection
          session._cleanupTimer = setTimeout(() => {
            if (sessions.has(client.sessionId)) {
              // Check if PID is still alive before reaping
              if (session.metadata?.pid && isPidAlive(session.metadata.pid)) {
                console.log(`[Session] PID ${session.metadata.pid} still alive, extending grace for ${session.id}`);
                session._cleanupTimer = setTimeout(() => {
                  if (sessions.has(client.sessionId)) {
                    reapSession(client.sessionId, 'grace period expired (extended)');
                  }
                }, INTERCEPT_GRACE_PERIOD);
                return;
              }
              reapSession(client.sessionId, 'grace period expired');
            }
          }, INTERCEPT_GRACE_PERIOD);
        }
      }
    }

    clients.delete(clientId);
  });

  ws.on('error', (err) => {
    console.error(`[Server] WebSocket error for ${clientId}:`, err.message);
  });
}

// --- PID Liveness Check ---
// Check if a process is still running (same-machine only)
function isPidAlive(pid) {
  try {
    process.kill(Number(pid), 0); // signal 0 = check existence, don't actually signal
    return true;
  } catch (e) {
    // ESRCH = no such process, EPERM = process exists but we can't signal it (still alive)
    return e.code === 'EPERM';
  }
}

// Clean up a session and its associated state
function reapSession(sessionId, reason) {
  const session = sessions.get(sessionId);
  if (!session) return;

  console.log(`[Session] Reaping session ${sessionId}: ${reason}`);

  // Cancel any pending cleanup timer
  if (session._cleanupTimer) {
    clearTimeout(session._cleanupTimer);
    session._cleanupTimer = null;
  }

  // Clean up PID index
  if (session.metadata?.pid) pidIndex.delete(Number(session.metadata.pid));

  // Notify viewers
  broadcastToSession(sessionId, { type: 'session-reaped', reason });

  sessions.delete(sessionId);
}

// --- WebSocket Ping/Pong ---
// Detects silently-dead connections that never fire 'close'.
// Without this, a connection that dies mid-TCP (NAT timeout, proxy kill,
// cable unplug) can keep the session alive forever.
function setupPingPong(wss) {
  // Track pong state per client
  const pongReceived = new WeakMap();

  wss.on('connection', (ws) => {
    pongReceived.set(ws, true); // assume alive at connect

    ws.on('pong', () => {
      pongReceived.set(ws, true);
    });
  });

  // Periodic ping sweep
  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (pongReceived.get(ws) === false) {
        // No pong received since last ping - connection is dead
        console.log('[Ping] Terminating dead WebSocket connection');
        ws.terminate(); // this fires the 'close' event
        continue;
      }
      pongReceived.set(ws, false);
      try {
        ws.ping();
      } catch (e) {
        // Ignore ping errors
      }
    }
  }, WS_PING_INTERVAL);

  // Clean up on server close
  wss.on('close', () => clearInterval(interval));
}

// --- Stale Session Reaper ---
// Periodically checks for zombie intercept sessions with no recent heartbeat
// and no live WebSocket connection.
function startSessionReaper() {
  setInterval(() => {
    const now = Date.now();

    for (const [sessionId, session] of sessions.entries()) {
      // Check if the interceptor WebSocket is still connected
      const wsAlive = session.interceptorWs && session.interceptorWs.readyState === 1;
      if (wsAlive) continue; // Connection is fine, skip

      // WebSocket is not connected. Check heartbeat staleness.
      const lastHb = session.lastHeartbeat ? session.lastHeartbeat.getTime() : 0;
      const lastAct = session.lastActivity ? session.lastActivity.getTime() : 0;
      const lastSeen = Math.max(lastHb, lastAct);
      const staleDuration = now - lastSeen;

      if (staleDuration < HEARTBEAT_STALE_THRESHOLD) continue; // Recently active

      // Session is stale. Check if the process is still alive.
      if (session.metadata?.pid && isPidAlive(session.metadata.pid)) {
        // Process alive but WebSocket down. Don't reap yet - the interceptor
        // should reconnect soon. Log it so we can debug if it doesn't.
        if (staleDuration > INTERCEPT_GRACE_PERIOD) {
          console.log(`[Reaper] Session ${sessionId} PID ${session.metadata.pid} alive but no WS for ${Math.round(staleDuration / 1000)}s`);
        }
        continue;
      }

      // Process is dead (or PID unknown) and no WebSocket. Reap it.
      if (session._cleanupTimer) {
        clearTimeout(session._cleanupTimer);
        session._cleanupTimer = null;
      }
      reapSession(sessionId, `stale (no heartbeat for ${Math.round(staleDuration / 1000)}s, PID ${session.metadata?.pid || 'unknown'} not alive)`);
    }
  }, REAPER_INTERVAL);
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

      // Spawn Claude Code inside a tmux session with the intercept module loaded.
      // The interceptor runs in-process via NODE_OPTIONS --require, capturing
      // structured API events and enabling remote stdin injection.
      const interceptPath = new URL('./intercept/intercept.cjs', import.meta.url).pathname;

      // Get full paths to node and claude binaries
      const nodePath = process.execPath;
      const nodeBinDir = dirname(nodePath);
      const claudeCmd = join(nodeBinDir, 'claude');

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

      // Run claude directly with the intercept module injected via NODE_OPTIONS
      const wsProtocol = USE_HTTPS ? 'wss' : 'ws';
      const tlsReject = USE_HTTPS ? 'NODE_TLS_REJECT_UNAUTHORIZED=0 ' : '';
      const shellCommand = `export PATH="${nodeBinDir}:$PATH"; ${tlsReject}CLAUDE_INTERCEPT_SERVER=${wsProtocol}://${HOST}:${PORT} NODE_OPTIONS="--require ${interceptPath}" exec ${claudeCmd}`;

      tmuxArgs.push('/bin/bash', '-l', '-c', shellCommand);

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

      console.log(`[Session] Created tmux session ${tmuxSessionName} in ${resolvedPath}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        sessionId: 'pending',  // Session ID will be assigned by interceptor when it connects
        tmuxSession: tmuxSessionName,
        workingDir: resolvedPath,
        message: `Session starting in ${resolvedPath}. Attach with: tmux attach -t ${tmuxSessionName}`
      }));

    } catch (err) {
      console.error('[Start Session] Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

// Create HTTP/HTTPS server for WebSocket
let httpServer;
if (USE_HTTPS) {
  const certPath = join(__dirname, '..', 'cert.pem');
  const keyPath = join(__dirname, '..', 'key.pem');

  if (existsSync(certPath) && existsSync(keyPath)) {
    const options = {
      cert: readFileSync(certPath),
      key: readFileSync(keyPath)
    };
    httpServer = createHttpsServer(options, (req, res) => {
      handleHttpRequest(req, res);
    });
    console.log('🔒 HTTPS enabled (certificates found)');
  } else {
    console.warn('⚠️  HTTPS requested but certificates not found, falling back to HTTP');
    httpServer = createServer((req, res) => {
      handleHttpRequest(req, res);
    });
  }
} else {
  httpServer = createServer((req, res) => {
    handleHttpRequest(req, res);
  });
}

async function handleHttpRequest(req, res) {
  // Handle mobile API routes first
  if (req.url.startsWith('/api/')) {
    const handled = await handleMobileRoute(req, res);
    if (handled) return;
  }

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
  } else if (req.url === '/pair' || req.url === '/pair.html') {
    // Serve pairing page for mobile app setup
    import('fs').then(fs => {
      import('path').then(path => {
        const filePath = path.join(__dirname, '..', 'public', 'pair.html');
        fs.readFile(filePath, 'utf8', (err, data) => {
          if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Pairing page not found');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
          }
        });
      });
    });
  } else if (req.url === '/intercept' || req.url === '/intercept.html') {
    // Serve structured intercept viewer
    import('fs').then(fs => {
      import('path').then(pathMod => {
        const filePath = pathMod.join(__dirname, '..', 'public', 'intercept.html');
        fs.readFile(filePath, 'utf8', (err, data) => {
          if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Intercept viewer not found');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
          }
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
      type: s.type || 'intercept',
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
}

// Create WebSocket server
const wss = new WebSocketServer({ server: httpServer });
wss.on('connection', handleConnection);

// Detect silently-dead WebSocket connections via ping/pong
setupPingPong(wss);

// Periodically reap zombie sessions
startSessionReaper();

// Start server
httpServer.listen(PORT, HOST, () => {
  const wsProtocol = USE_HTTPS ? 'wss' : 'ws';
  const httpProtocol = USE_HTTPS ? 'https' : 'http';
  const secureIcon = USE_HTTPS ? '🔒 ' : '';

  console.log(`
╔════════════════════════════════════════════════════════════╗
║   ${secureIcon}Claude Code Remote Access Server                        ║
╟────────────────────────────────────────────────────────────╢
║   WebSocket: ${wsProtocol}://${HOST}:${PORT}                    ║
║   HTTP:      ${httpProtocol}://${HOST}:${PORT}                  ║
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

  // Clean up device registry (persists devices to disk)
  deviceRegistry.destroy();

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
