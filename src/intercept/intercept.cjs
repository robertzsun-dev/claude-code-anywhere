'use strict';

/**
 * Claude Code API Interceptor
 *
 * Loaded via: NODE_OPTIONS="--require /path/to/intercept.cjs"
 *
 * Patches globalThis.fetch to intercept Anthropic API calls,
 * capturing structured conversation data (SSE events, request metadata)
 * instead of raw terminal output. Relays events to the session server
 * over WebSocket for structured viewing.
 *
 * Design principles:
 *   - NEVER break Claude Code, even on errors
 *   - Minimal overhead (async relay, buffered events)
 *   - No user-visible output unless DEBUG is enabled
 */

// --- Quick bail-outs ---
if (process.env.CLAUDE_INTERCEPT === '0') return;

const serverUrl = process.env.CLAUDE_INTERCEPT_SERVER || process.env.CLAUDE_REMOTE_SERVER;
if (!serverUrl) return;

// Guard against NODE_OPTIONS propagation to child processes.
// NODE_OPTIONS="--require intercept.cjs" propagates to every child `node` process
// that Claude Code spawns (bash tool, etc.). We only want to intercept the main
// Claude Code process, not its children. Use a marker env var to detect re-entry.
if (process.env.__CLAUDE_INTERCEPT_ACTIVE === '1') return;
process.env.__CLAUDE_INTERCEPT_ACTIVE = '1';

const path = require('path');
const crypto = require('crypto');

// --- Configuration ---
const DEBUG = process.env.CLAUDE_INTERCEPT_DEBUG === '1';
const MAX_BUFFER = 2000;
const MAX_CONTENT_LENGTH = 4000; // truncate large content in relayed messages
const RECONNECT_DELAY = 3000;
const HEARTBEAT_INTERVAL = 15000; // send keepalive every 15s

function debug(...args) {
  if (DEBUG) process.stderr.write('[intercept] ' + args.join(' ') + '\n');
}

// --- WebSocket Relay ---
// Connects to the session server and relays structured API events
let ws = null;
let connected = false;
let sessionId = null;
let eventBuffer = [];
let reconnectTimer = null;
let heartbeatTimer = null;
let requestCounter = 0; // monotonic counter for correlating requests with responses

function loadWebSocket() {
  // Try multiple resolution strategies for the ws module
  const strategies = [
    () => require(path.join(__dirname, '..', '..', 'node_modules', 'ws')),
    () => require('ws'),
  ];

  for (const strategy of strategies) {
    try {
      return strategy();
    } catch (e) {
      // Continue to next strategy
    }
  }

  // Last resort: use native WebSocket (Node.js v22+)
  if (typeof globalThis.WebSocket === 'function') {
    return globalThis.WebSocket;
  }

  return null;
}

// Helper: bind events to either ws-package (.on) or native WebSocket (.addEventListener)
function wsOn(socket, event, handler) {
  if (typeof socket.on === 'function') {
    // ws npm package style
    socket.on(event, handler);
  } else if (typeof socket.addEventListener === 'function') {
    // Native WebSocket (browser API) style
    // Native events wrap data in an Event object
    if (event === 'message') {
      socket.addEventListener(event, (evt) => handler(evt.data));
    } else if (event === 'error') {
      socket.addEventListener(event, (evt) => handler(evt.error || new Error('WebSocket error')));
    } else {
      socket.addEventListener(event, handler);
    }
  }
}

function connectRelay() {
  try {
    const WebSocket = loadWebSocket();
    if (!WebSocket) {
      debug('no WebSocket implementation available');
      return;
    }

    const url = new URL(serverUrl);
    // Normalize protocol
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    url.searchParams.set('role', 'interceptor');
    // Always send PID so server can match by PID if session ID is stale
    url.searchParams.set('pid', String(process.pid));
    // If we already have a session ID, ask to rejoin it
    if (sessionId) {
      url.searchParams.set('session', sessionId);
    }

    // ws npm package accepts options as 2nd or 3rd arg;
    // native WebSocket only accepts protocols as 2nd arg.
    // Detect which API we have and construct accordingly.
    const isNative = !WebSocket.prototype.on;
    const wsUrl = url.toString();

    if (isNative) {
      ws = new WebSocket(wsUrl);
    } else {
      const wsOptions = url.protocol === 'wss:'
        ? { rejectUnauthorized: false }
        : undefined;
      ws = wsOptions ? new WebSocket(wsUrl, wsOptions) : new WebSocket(wsUrl);
    }

    wsOn(ws, 'open', () => {
      connected = true;
      debug('connected to server', sessionId ? '(reconnecting session ' + sessionId + ')' : '(new)');
      // Unref the underlying socket so the WebSocket connection doesn't prevent
      // Claude Code from exiting when it's done. Without this, the open WebSocket
      // keeps the Node.js event loop alive and the process hangs.
      if (ws._socket && typeof ws._socket.unref === 'function') {
        ws._socket.unref();
      }
      // Flush buffered events
      const pending = eventBuffer.splice(0);
      for (const event of pending) {
        relay(event);
      }
      // Start heartbeat so the server can detect stale sessions
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        relay({ type: 'heartbeat', ts: Date.now(), pid: process.pid });
      }, HEARTBEAT_INTERVAL);
      heartbeatTimer.unref();  // Don't prevent process exit
    });

    wsOn(ws, 'message', (data) => {
      try {
        const str = typeof data === 'string' ? data : data.toString();
        const msg = JSON.parse(str);
        if (msg.type === 'session-created') {
          sessionId = msg.sessionId;
          debug('session created:', sessionId);
        } else if (msg.type === 'input') {
          debug('received remote input (not yet supported)');
        }
      } catch (e) {
        // Ignore parse errors
      }
    });

    wsOn(ws, 'close', () => {
      connected = false;
      ws = null;
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectRelay, RECONNECT_DELAY);
      reconnectTimer.unref();  // Don't prevent process exit
    });

    wsOn(ws, 'error', (err) => {
      debug('ws error:', err && err.message);
    });

  } catch (err) {
    debug('connection error:', err.message);
  }
}

function relay(event) {
  // readyState 1 = OPEN (same constant for both ws package and native WebSocket)
  if (connected && ws && ws.readyState === 1) {
    try {
      ws.send(JSON.stringify(event));
    } catch (e) {
      debug('relay send error:', e.message);
    }
  } else if (eventBuffer.length < MAX_BUFFER) {
    eventBuffer.push(event);
  }
}

// --- SSE Event Parsing ---
// Parses Server-Sent Events from a ReadableStream

function parseSSEBlock(text) {
  let eventType = '';
  const dataLines = [];

  for (const line of text.split('\n')) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
    // Ignore comments (lines starting with :) and other fields
  }

  if (eventType || dataLines.length) {
    return { event: eventType, data: dataLines.join('\n') };
  }
  return null;
}

async function processSSEStream(readableStream, reqId) {
  let reader;
  try {
    reader = readableStream.getReader();
  } catch (e) {
    debug('cannot get stream reader:', e.message);
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE events are delimited by double newlines
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const parsed = parseSSEBlock(block);
        if (parsed && parsed.event !== 'ping') {
          relay({
            type: 'sse_event',
            ts: Date.now(),
            reqId,
            event: parsed.event,
            data: parsed.data,
          });
        }
      }
    }

    // Process any trailing data
    if (buffer.trim()) {
      const parsed = parseSSEBlock(buffer);
      if (parsed && parsed.event !== 'ping') {
        relay({
          type: 'sse_event',
          ts: Date.now(),
          event: parsed.event,
          data: parsed.data,
        });
      }
    }
  } catch (err) {
    debug('stream read error:', err.message);
  } finally {
    try { reader.releaseLock(); } catch (e) {}
  }
}

// --- Request Body Analysis ---
// Extracts relevant metadata from API request bodies

function isAnthropicMessagesAPI(url) {
  // Broad URL check: catches both direct api.anthropic.com and proxy setups.
  // Must be paired with looksLikeAnthropicRequest() body validation to avoid
  // false-positives on unrelated APIs that also have /v1/messages paths.
  return url.includes('/v1/messages');
}

function looksLikeAnthropicRequest(body) {
  // Validates that a parsed request body looks like an Anthropic Messages API call.
  // This guards against false-positives from the broad URL match above.
  return body
    && typeof body.model === 'string'
    && body.model.startsWith('claude')
    && Array.isArray(body.messages);
}

function truncate(str, max) {
  if (!str) return str;
  if (typeof str !== 'string') str = JSON.stringify(str);
  return str.length > max ? str.slice(0, max) + '...[truncated]' : str;
}

function extractRequestInfo(body) {
  const info = {
    model: body.model,
    stream: !!body.stream,
    max_tokens: body.max_tokens,
    messages_count: body.messages?.length || 0,
    has_system: !!body.system,
    tools: (body.tools || []).map(t => t.name).filter(Boolean),
  };

  // Extract the most recent user turn for display
  if (body.messages && body.messages.length > 0) {
    info.last_turn = extractLastTurn(body.messages);
  }

  return info;
}

function extractLastTurn(messages) {
  if (!messages || !messages.length) return null;

  // Walk backwards from the end to collect the last user turn
  // (may be multiple messages: tool_results followed by user text)
  const turn = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      turn.unshift(summarizeMessage(messages[i]));
    } else {
      break;
    }
  }
  return turn.length ? turn : null;
}

function summarizeMessage(msg) {
  if (typeof msg.content === 'string') {
    return {
      role: msg.role,
      type: 'text',
      text: truncate(msg.content, MAX_CONTENT_LENGTH),
    };
  }

  if (Array.isArray(msg.content)) {
    return {
      role: msg.role,
      blocks: msg.content.map(block => {
        switch (block.type) {
          case 'text':
            return { type: 'text', text: truncate(block.text, MAX_CONTENT_LENGTH) };
          case 'tool_result': {
            const content = typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content);
            return {
              type: 'tool_result',
              tool_use_id: block.tool_use_id,
              is_error: !!block.is_error,
              content: truncate(content, MAX_CONTENT_LENGTH),
            };
          }
          case 'image':
            return { type: 'image', media_type: block.source?.media_type };
          default:
            return { type: block.type || 'unknown' };
        }
      }),
    };
  }

  return { role: msg.role, type: 'unknown' };
}

// --- Fetch Interception ---
// The primary interception point. Claude Code / Anthropic SDK uses fetch().

const originalFetch = globalThis.fetch;

if (typeof originalFetch === 'function') {
  globalThis.fetch = async function interceptedFetch(input, init) {
    let url;
    try {
      url = typeof input === 'string' ? input
          : input instanceof URL ? input.toString()
          : (input && typeof input === 'object' && input.url) ? input.url
          : '';
    } catch (e) {
      url = '';
    }

    // Quick URL gate - cheap check to skip obviously unrelated requests
    if (!isAnthropicMessagesAPI(url)) {
      return originalFetch.apply(this, arguments);
    }

    // Body validation - confirm this actually looks like an Anthropic request
    // to avoid false-positives from unrelated APIs with /v1/messages paths
    let parsedBody = null;
    try {
      const bodyStr = init?.body;
      if (typeof bodyStr === 'string') {
        parsedBody = JSON.parse(bodyStr);
      }
    } catch (e) {
      debug('body parse error:', e.message);
    }

    if (!looksLikeAnthropicRequest(parsedBody)) {
      return originalFetch.apply(this, arguments);
    }

    // Assign a correlation ID so viewers can match requests with their SSE events
    const reqId = `req_${++requestCounter}_${Date.now()}`;
    debug('intercepting:', url, 'reqId:', reqId);

    // --- Capture request metadata ---
    try {
      relay({
        type: 'api_request',
        ts: Date.now(),
        reqId,
        data: extractRequestInfo(parsedBody),
      });
    } catch (e) {
      debug('request capture error:', e.message);
    }

    // --- Make the real request ---
    let response;
    try {
      response = await originalFetch.apply(this, arguments);
    } catch (err) {
      // If the actual API call fails, relay the error and re-throw
      relay({
        type: 'api_error',
        ts: Date.now(),
        reqId,
        error: err.message,
      });
      throw err;
    }

    // --- Capture response ---
    const contentType = response.headers?.get('content-type') || '';

    if (contentType.includes('text/event-stream') && response.body) {
      // Streaming SSE response - tee the stream
      try {
        const [clientStream, captureStream] = response.body.tee();

        // Process captured stream in background, tagged with reqId
        processSSEStream(captureStream, reqId).catch(err => {
          debug('SSE capture error:', err.message);
        });

        // Return a new Response with the client's stream branch
        return new Response(clientStream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch (e) {
        debug('stream tee error:', e.message);
        // Fall through to return original response
        return response;
      }
    } else if (contentType.includes('application/json')) {
      // Non-streaming JSON response - clone and capture
      try {
        const clone = response.clone();
        clone.text().then(text => {
          try {
            const data = JSON.parse(text);
            relay({
              type: 'api_response',
              ts: Date.now(),
              reqId,
              data: {
                id: data.id,
                model: data.model,
                type: data.type,
                role: data.role,
                stop_reason: data.stop_reason,
                usage: data.usage,
                content: data.content?.map(block => {
                  if (block.type === 'text') {
                    return { type: 'text', text: truncate(block.text, MAX_CONTENT_LENGTH) };
                  }
                  if (block.type === 'tool_use') {
                    return {
                      type: 'tool_use',
                      id: block.id,
                      name: block.name,
                      input: truncate(JSON.stringify(block.input), MAX_CONTENT_LENGTH),
                    };
                  }
                  return { type: block.type };
                }),
              },
            });
          } catch (e) {}
        }).catch(() => {});
      } catch (e) {
        debug('response clone error:', e.message);
      }
      return response;
    }

    // Non-API response or unknown content type
    return response;
  };

  debug('fetch interceptor installed');
} else {
  debug('globalThis.fetch not available');
}

// --- HTTPS.request Fallback Interception ---
// Some environments or SDK versions may use https.request directly

const https = require('https');
const origHttpsRequest = https.request;

https.request = function interceptedHttpsRequest(urlOrOptions, optionsOrCb, maybeCb) {
  // Parse the flexible argument signatures of https.request
  let options, callback;
  if (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL) {
    const parsedUrl = typeof urlOrOptions === 'string' ? new URL(urlOrOptions) : urlOrOptions;
    if (typeof optionsOrCb === 'function') {
      options = { hostname: parsedUrl.hostname, path: parsedUrl.pathname + parsedUrl.search };
      callback = optionsOrCb;
    } else {
      options = { ...optionsOrCb, hostname: parsedUrl.hostname, path: parsedUrl.pathname + parsedUrl.search };
      callback = maybeCb;
    }
  } else {
    options = urlOrOptions || {};
    callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb;
  }

  const host = options.hostname || options.host || '';
  const reqPath = options.path || '';
  const fullUrl = host + reqPath;

  // Quick URL gate - same broad check as the fetch interceptor
  if (!isAnthropicMessagesAPI(fullUrl)) {
    return origHttpsRequest.apply(this, arguments);
  }

  const reqId = `req_${++requestCounter}_${Date.now()}`;
  // Track whether the body validated as Anthropic so response capture can check
  let isConfirmedAnthropic = false;

  debug('intercepting https.request (tentative):', fullUrl, 'reqId:', reqId);

  // Wrap callback to capture response (only relays if body validated)
  const wrappedCallback = function (res) {
    const contentType = res.headers['content-type'] || '';
    const chunks = [];

    const origOn = res.on.bind(res);
    res.on = function (event, handler) {
      if (event === 'data') {
        return origOn('data', function (chunk) {
          if (isConfirmedAnthropic) chunks.push(chunk);
          handler(chunk);
        });
      }
      if (event === 'end') {
        return origOn('end', function () {
          if (isConfirmedAnthropic) {
            // Process captured data
            try {
              const body = Buffer.concat(chunks).toString();
              if (contentType.includes('text/event-stream')) {
                // Parse SSE events from the captured body
                const events = body.split('\n\n');
                for (const block of events) {
                  const parsed = parseSSEBlock(block);
                  if (parsed && parsed.event !== 'ping') {
                    relay({
                      type: 'sse_event',
                      ts: Date.now(),
                      reqId,
                      event: parsed.event,
                      data: parsed.data,
                    });
                  }
                }
              } else if (contentType.includes('application/json')) {
                const data = JSON.parse(body);
                relay({
                  type: 'api_response',
                  ts: Date.now(),
                  reqId,
                  data: { id: data.id, model: data.model, stop_reason: data.stop_reason, usage: data.usage },
                });
              }
            } catch (e) {
              debug('https capture error:', e.message);
            }
          }
          handler();
        });
      }
      return origOn(event, handler);
    };

    if (callback) callback(res);
  };

  // Call original with wrapped callback
  const req = origHttpsRequest.call(this, urlOrOptions,
    typeof optionsOrCb === 'function' ? wrappedCallback : optionsOrCb,
    typeof optionsOrCb === 'function' ? undefined : wrappedCallback
  );

  // Capture request body for validation + relay
  const origWrite = req.write.bind(req);
  let reqBody = '';

  req.write = function (data, encoding, cb) {
    if (data) {
      reqBody += typeof data === 'string' ? data : data.toString();
    }
    return origWrite(data, encoding, cb);
  };

  const origEnd = req.end.bind(req);
  req.end = function (data, encoding, cb) {
    if (data) {
      reqBody += typeof data === 'string' ? data : data.toString();
    }
    // Validate body and relay request info only if it looks like Anthropic
    try {
      if (reqBody) {
        const body = JSON.parse(reqBody);
        if (looksLikeAnthropicRequest(body)) {
          isConfirmedAnthropic = true;
          debug('confirmed Anthropic request:', fullUrl, 'reqId:', reqId);
          relay({
            type: 'api_request',
            ts: Date.now(),
            reqId,
            data: extractRequestInfo(body),
          });
        }
      }
    } catch (e) {}

    return origEnd(data, encoding, cb);
  };

  return req;
};

debug('https.request interceptor installed');

// --- Send initial metadata ---
relay({
  type: 'metadata',
  data: {
    interceptor: true,
    pid: process.pid,
    cwd: process.cwd(),
    hostname: require('os').hostname(),
    user: process.env.USER || process.env.USERNAME || 'unknown',
    platform: process.platform,
    nodeVersion: process.version,
  },
});

// --- Initialize ---
connectRelay();
debug('intercept module loaded, server:', serverUrl);

// --- Cleanup & Exit Handling ---
// We need to signal the server reliably when Claude Code exits, whether
// that's a normal exit, SIGINT (Ctrl+C), or SIGTERM (kill).
let exitSent = false;

function sendExitEvent(code, signal) {
  if (exitSent) return;
  exitSent = true;
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  try {
    relay({ type: 'exit', code: code || 0, signal: signal || null });
    // Synchronous close attempt for ws package (has no effect on native WebSocket)
    if (ws && typeof ws.close === 'function') ws.close();
  } catch (e) {}
}

process.on('exit', (code) => {
  sendExitEvent(code, null);
});

// SIGINT (Ctrl+C) - Claude Code handles this itself, but we want to
// send our exit event before the process terminates
process.on('SIGINT', () => {
  sendExitEvent(130, 'SIGINT');
  // Don't call process.exit() - let Claude Code's own handler run
});

// SIGTERM (kill) - send exit event, then let the default handler terminate
process.on('SIGTERM', () => {
  sendExitEvent(143, 'SIGTERM');
});
