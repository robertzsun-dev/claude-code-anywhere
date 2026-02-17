'use strict';

/**
 * Claude Code API Interceptor
 *
 * Loaded via: BUN_OPTIONS="--preload /path/to/intercept.cjs" (native binary / Bun)
 *         or: NODE_OPTIONS="--require /path/to/intercept.cjs" (npm install / Node.js)
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

// Guard against env var propagation to child processes.
// Both NODE_OPTIONS and BUN_OPTIONS propagate to child processes that Claude Code
// spawns (bash tool, etc.). We only want to intercept the main Claude Code process,
// not its children. Use a marker env var to detect re-entry.
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

// --- Stdin Injection ---
// Injects simple input (Enter, Escape, text) into Claude Code's stdin.
// Arrow keys / multi-byte ANSI sequences do NOT work reliably in Bun, so
// AskUserQuestion selections are handled at the API level instead (see below).

function deliverBytes(buf) {
  // Strategy 1: Call stdin 'data' listeners directly (works in Bun for single-byte).
  if (typeof process.stdin.listeners === 'function') {
    const listeners = process.stdin.listeners('data');
    if (listeners.length > 0) {
      for (const listener of listeners) {
        try { listener(buf); } catch (e) { debug('listener call error:', e.message); }
      }
      return;
    }
  }
  // Strategy 2: Push into readable stream buffer.
  if (typeof process.stdin.push === 'function') {
    try { process.stdin.push(buf); return; } catch (e) { debug('push failed:', e.message); }
  }
  // Strategy 3: EventEmitter emit.
  try { process.stdin.emit('data', buf); } catch (e) { debug('emit failed:', e.message); }
}

function injectStdin(data) {
  debug('injecting stdin:', JSON.stringify(data).slice(0, 80));
  // For simple input (text, Enter, Escape), deliver each segment separately
  const segments = [];
  let textBuf = '';
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      if (textBuf) { segments.push(textBuf); textBuf = ''; }
      segments.push(code === 0x0a ? '\r' : data[i]);
    } else {
      textBuf += data[i];
    }
  }
  if (textBuf) segments.push(textBuf);

  // Deliver text immediately, control chars after 50ms if text preceded them
  let sawText = false;
  const immediate = [], delayed = [];
  for (const seg of segments) {
    const isCtrl = seg.length === 1 && seg.charCodeAt(0) < 0x20;
    if (!isCtrl) { sawText = true; immediate.push(seg); }
    else { (sawText ? delayed : immediate).push(seg); }
  }
  for (const d of immediate) deliverBytes(Buffer.from(d));
  if (delayed.length > 0) {
    const fn = () => { for (const d of delayed) deliverBytes(Buffer.from(d)); };
    const t = setTimeout(fn, 50);
    if (t && typeof t.unref === 'function') t.unref();
  }
}

// --- AskUserQuestion: API-level answer injection ---
// Arrow keys don't work in Bun's stdin, so we handle AskUserQuestion at the
// API level: send Escape to cancel the Ink selector (generating a "declined"
// tool_result), then rewrite that tool_result in the outgoing API request
// to contain the actual answer the user selected in the web viewer.
let pendingAskAnswer = null;  // { toolUseId, answerText }

function handleAskAnswer(msg) {
  // msg: { toolUseId, questions: [{question, selectedLabel}, ...] }
  if (!msg.toolUseId || !msg.questions) {
    relay({ type: 'ask-debug', step: 'invalid-msg', detail: 'missing toolUseId or questions' });
    return;
  }

  // Build the answer text in the same format Claude Code uses
  let text = '';
  for (const q of msg.questions) {
    text += `- ${q.question}\n  → ${q.selectedLabel}\n`;
  }

  pendingAskAnswer = {
    toolUseId: msg.toolUseId,
    answerText: text.trim(),
    ts: Date.now(),
  };

  debug('stored pending ask answer for', msg.toolUseId);
  relay({ type: 'ask-debug', step: 'stored', toolUseId: msg.toolUseId,
          answerPreview: text.trim().slice(0, 120) });

  // Strategy to dismiss the AskUserQuestion UI:
  //
  // 1. Single question, single-select: Space + Enter
  //    Enter selects the highlighted option and auto-continues with a new API call.
  //
  // 2. Multi-select or multi-question: Escape + type "continue"
  //    Escape cancels the form, then we type "continue" to trigger a new API call.
  //    The fetch interceptor rewrites the tool_result with the real answer and strips
  //    the leftover "continue" text from the message.
  const questionCount = msg.questions.length || 1;
  const hasMultiSelect = !!msg.hasMultiSelect;
  const useEscapeContinue = questionCount > 1 || hasMultiSelect;
  relay({ type: 'ask-debug', step: 'dismissing-ui', count: questionCount,
          hasMultiSelect, strategy: useEscapeContinue ? 'escape+continue' : 'enter' });

  if (!useEscapeContinue) {
    // Single question single-select: Space + Enter
    deliverBytes(Buffer.from(' '));
    const t = setTimeout(() => {
      deliverBytes(Buffer.from('\r'));
      relay({ type: 'ask-debug', step: 'enter-sent' });
    }, 100);
    if (t && typeof t.unref === 'function') t.unref();
  } else {
    // Multi-select or multi-question: Escape + type "continue" to trigger API call
    deliverBytes(Buffer.from('\x1b'));
    relay({ type: 'ask-debug', step: 'escape-sent' });
    const t = setTimeout(() => {
      const continueStr = 'continue\r';
      for (let i = 0; i < continueStr.length; i++) {
        const t2 = setTimeout(() => deliverBytes(Buffer.from(continueStr[i])), i * 30);
        if (t2 && typeof t2.unref === 'function') t2.unref();
      }
      relay({ type: 'ask-debug', step: 'continue-typed' });
    }, 1500);
    if (t && typeof t.unref === 'function') t.unref();
  }
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
  const isBun = typeof Bun !== 'undefined';

  if (isBun) {
    // In Bun, the real ws npm package (from node_modules) uses Node.js internals
    // (net.Socket, tls.TLSSocket) that don't work correctly in Bun — connections
    // establish but immediately tear down. Use Bun's built-in ws polyfill instead,
    // which wraps Bun's native WebSocket and works correctly.
    try {
      return require('ws'); // Returns Bun's built-in polyfill, NOT node_modules/ws
    } catch (e) {
      // Continue
    }
    if (typeof globalThis.WebSocket === 'function') {
      return globalThis.WebSocket;
    }
    return null;
  }

  // Node.js: try the real ws npm package first (supports rejectUnauthorized, etc.)
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

    const isBun = typeof Bun !== 'undefined';
    const isNative = !WebSocket.prototype.on;
    const wsUrl = url.toString();

    if (isBun) {
      // Bun's ws polyfill (BunWebSocket) wraps Bun's native WebSocket.
      // It has .on() (extends EventEmitter) but its constructor follows
      // the native WebSocket API: new WebSocket(url, protocols).
      // It does NOT support Node.js ws options like { rejectUnauthorized }.
      // Use NODE_TLS_REJECT_UNAUTHORIZED=0 for self-signed certs instead.
      if (url.protocol === 'wss:') {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      }
      ws = new WebSocket(wsUrl);
    } else if (isNative) {
      // Native WebSocket (Node.js v22+ / browser API)
      ws = new WebSocket(wsUrl);
    } else {
      // Real ws npm package (Node.js) — supports options as 2nd arg
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
          injectStdin(msg.data);
        } else if (msg.type === 'raw-input') {
          // Deliver as a single buffer (preserves multi-byte ANSI sequences)
          deliverBytes(Buffer.from(msg.data));
        } else if (msg.type === 'ask-answer') {
          relay({ type: 'ask-debug', step: 'ws-received', toolUseId: msg.toolUseId,
                  questionCount: msg.questions?.length || 0 });
          handleAskAnswer(msg);
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

function detectMode(body) {
  const toolNames = (body.tools || []).map(t => t.name).filter(Boolean);
  if (toolNames.includes('ExitPlanMode')) return 'plan';
  if (toolNames.includes('EnterPlanMode')) return 'normal';
  return null;
}

function extractRequestInfo(body) {
  const info = {
    model: body.model,
    stream: !!body.stream,
    max_tokens: body.max_tokens,
    messages_count: body.messages?.length || 0,
    has_system: !!body.system,
    tools: (body.tools || []).map(t => t.name).filter(Boolean),
    mode: detectMode(body),
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

    // Debug: log API calls only when we have a pending answer (when it matters for rewrite)
    if (pendingAskAnswer) {
      relay({ type: 'ask-debug', step: 'api-call',
              hasPending: true,
              pendingToolUseId: pendingAskAnswer.toolUseId,
              pendingAge: Date.now() - pendingAskAnswer.ts });
    }

    // --- Rewrite "declined" AskUserQuestion answers if we have a pending response ---
    // Debug: log every API call's tool_results when we have a pending answer
    if (pendingAskAnswer) {
      const age = Date.now() - pendingAskAnswer.ts;
      // Collect all tool_results from the last user message for debugging
      const debugToolResults = [];
      if (parsedBody && parsedBody.messages) {
        for (let i = parsedBody.messages.length - 1; i >= 0; i--) {
          const m = parsedBody.messages[i];
          if (m.role !== 'user') continue;
          const blocks = Array.isArray(m.content) ? m.content : [];
          for (const b of blocks) {
            if (b.type === 'tool_result') {
              const ct = typeof b.content === 'string' ? b.content
                : Array.isArray(b.content) ? b.content.map(c => c.text || '').join(' ')
                : String(b.content || '');
              debugToolResults.push({
                tool_use_id: b.tool_use_id,
                is_error: !!b.is_error,
                content_preview: ct.slice(0, 120),
              });
            }
          }
          break; // Only last user message
        }
      }
      relay({ type: 'ask-debug', step: 'fetch-with-pending', age,
              toolUseId: pendingAskAnswer.toolUseId,
              toolResults: debugToolResults,
              messageCount: parsedBody?.messages?.length || 0 });
    }

    if (pendingAskAnswer && parsedBody && parsedBody.messages) {
      // Expire stale answers after 30s
      if (Date.now() - pendingAskAnswer.ts > 30000) {
        debug('pendingAskAnswer expired');
        relay({ type: 'ask-debug', step: 'expired', toolUseId: pendingAskAnswer.toolUseId });
        pendingAskAnswer = null;
      } else {
        const answer = pendingAskAnswer;
        let rewritten = false;
        let lastToolResult = null; // Track last tool_result as aggressive fallback

        // Helper: extract text from tool_result content (handles string and array formats)
        function getContentText(content) {
          if (typeof content === 'string') return content;
          if (Array.isArray(content)) return content.map(c => c.text || '').join(' ');
          return String(content || '');
        }

        // Walk messages backwards to find the tool_result for this AskUserQuestion.
        for (let i = parsedBody.messages.length - 1; i >= 0 && !rewritten; i--) {
          const msg = parsedBody.messages[i];
          if (msg.role !== 'user') continue;
          const content = Array.isArray(msg.content) ? msg.content : [];
          for (const block of content) {
            if (block.type !== 'tool_result') continue;
            if (!lastToolResult) lastToolResult = block; // Remember most recent

            const contentText = getContentText(block.content);
            const isTarget = block.tool_use_id === answer.toolUseId
              || /declined|interrupted/i.test(contentText);
            if (isTarget) {
              debug('rewriting tool_result (matched) for', block.tool_use_id);
              block.content = answer.answerText;
              block.is_error = false;
              rewritten = true;
              relay({ type: 'ask-debug', step: 'rewrite-matched', tool_use_id: block.tool_use_id });
              break;
            }
          }
          break; // Only check the last user message
        }

        // Aggressive fallback: if no exact match, rewrite the last tool_result
        // (it's almost certainly from the Escape we just sent)
        if (!rewritten && lastToolResult) {
          debug('rewriting tool_result (fallback) for', lastToolResult.tool_use_id,
            'content was:', getContentText(lastToolResult.content).slice(0, 80));
          lastToolResult.content = answer.answerText;
          lastToolResult.is_error = false;
          rewritten = true;
          relay({ type: 'ask-debug', step: 'rewrite-fallback', tool_use_id: lastToolResult.tool_use_id,
                  oldContent: getContentText(lastToolResult.content).slice(0, 80) });
        }

        if (rewritten) {
          // Strip artifacts from the escape+continue dismissal strategy.
          // After pressing Escape and typing "continue", the API request contains:
          //   1. "continue" text (what we typed to trigger the new API call)
          //   2. "[Request interrupted by user for tool use]" (Claude Code's cancellation notice)
          // If left in, Claude sees the rewritten answer alongside these and thinks
          // the user interrupted, responding with "looks like you interrupted" instead
          // of using the injected answer.
          for (let i = parsedBody.messages.length - 1; i >= 0; i--) {
            const m = parsedBody.messages[i];
            if (m.role !== 'user') break;
            if (Array.isArray(m.content)) {
              m.content = m.content.filter(block => {
                if (block.type === 'text') {
                  const text = block.text || '';
                  if (/^\s*continue\s*$/i.test(text)) {
                    debug('stripped "continue" text from user message');
                    return false;
                  }
                  if (/interrupted|declined/i.test(text)) {
                    debug('stripped interruption text from user message:', text.slice(0, 80));
                    return false;
                  }
                }
                return true;
              });
              // If the message is now empty, remove it entirely
              if (m.content.length === 0) {
                parsedBody.messages.splice(i, 1);
              }
            }
            // Also handle string content
            if (typeof m.content === 'string') {
              if (/^\s*continue\s*$/i.test(m.content) || /interrupted|declined/i.test(m.content)) {
                parsedBody.messages.splice(i, 1);
                debug('stripped text message:', m.content.slice(0, 80));
              }
            }
          }

          pendingAskAnswer = null;
          init = { ...init, body: JSON.stringify(parsedBody) };
          // Relay debug info so the viewer can confirm rewrite happened
          relay({ type: 'ask-rewrite', ts: Date.now(), toolUseId: answer.toolUseId,
                  answerPreview: answer.answerText.slice(0, 100) });
        } else {
          relay({ type: 'ask-debug', step: 'no-rewrite', reason: 'no tool_results found',
                  toolUseId: answer.toolUseId });
        }
        // If not rewritten (no tool_results at all), keep for next API call
      }
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
      response = await originalFetch.call(this, input, init);
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

// --- Mode Detection from Terminal Output ---
// Claude Code's Ink TUI renders a status bar containing the current mode.
// We monitor stdout.write to detect mode changes immediately (without waiting
// for the next API call). The status bar always contains "Ctx:" which we use
// as a quick gate to avoid processing unrelated output.
let lastRelayedMode = null;

const origStdoutWrite = process.stdout.write;
process.stdout.write = function(chunk, encoding, cb) {
  // Always call original first — never break Claude Code's output
  const result = origStdoutWrite.apply(this, arguments);
  try {
    const raw = typeof chunk === 'string' ? chunk : chunk.toString();
    // Quick gate: only process chunks that contain the status bar
    if (raw.includes('Ctx:')) {
      // Strip ANSI escape codes
      const clean = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
                       .replace(/\x1b\][^\x07]*\x07/g, '');
      // The status bar line contains "Model:" and "Ctx:". Check for mode indicators.
      // Plan mode adds a plan indicator; auto-accept adds "auto" or "yolo".
      let mode = 'normal';
      if (/\bplan\b/i.test(clean)) mode = 'plan';
      else if (/\bauto.accept\b|\byolo\b/i.test(clean)) mode = 'auto-accept';

      if (mode !== lastRelayedMode) {
        lastRelayedMode = mode;
        relay({ type: 'mode-change', mode, ts: Date.now() });
        debug('mode detected from stdout:', mode);
      }
    }
  } catch (e) {
    // Never break stdout
  }
  return result;
};

debug('stdout mode monitor installed');

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
