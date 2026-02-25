#!/usr/bin/env node

/**
 * E2E test for AskUserQuestion answer injection with real Claude Code.
 *
 * Runs 4 scenarios:
 *   1. Single-choice question → click option button
 *   2. Multi-select single question → select multiple, submit
 *   3. Multi-select, multi-question → select options
 *   4. Single-choice → custom "Other" text response
 *
 * Each scenario launches Claude Code in a PTY with the interceptor,
 * triggers AskUserQuestion via a prompt, sends the answer from the viewer,
 * and verifies the API rewrite happened.
 *
 * Requirements:
 *   - node-pty installed (npm install node-pty)
 *   - Claude Code binary available
 *   - ~2-3 minutes total runtime (real API calls)
 *
 * Run:  npm run test:e2e
 *   or: node --test tests/ask-answer-e2e.test.js
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn, execSync } from 'child_process';
import https from 'https';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { WebSocket } from 'ws';

const require_ = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, '..');
const INTERCEPT_MODULE = path.join(PROJECT_DIR, 'src/intercept/intercept.cjs');

const TEST_PORT = 8768;
const WS_URL = `wss://localhost:${TEST_PORT}`;

// Detect Claude binary
const CLAUDE_BIN = process.env.CLAUDE_BIN || '/home/robsun/.local/bin/claude';

// Check if prerequisites are available
let pty;
let IS_BUN = false;
let SKIP_REASON = null;

try {
  pty = require_('node-pty');
} catch {
  SKIP_REASON = 'node-pty not installed';
}

if (!SKIP_REASON && !existsSync(CLAUDE_BIN)) {
  SKIP_REASON = `Claude binary not found at ${CLAUDE_BIN}`;
}

if (!SKIP_REASON) {
  const resolved = execSync(`readlink -f "${CLAUDE_BIN}"`, { encoding: 'utf8' }).trim();
  const fileInfo = execSync(`file "${resolved}"`, { encoding: 'utf8' });
  IS_BUN = fileInfo.includes('ELF');
}

/**
 * Run a single AskUserQuestion scenario against real Claude Code.
 *
 * 1. Spawns Claude in a PTY with the interceptor attached
 * 2. Connects a viewer WebSocket before typing the prompt
 * 3. Types the prompt character-by-character
 * 4. Waits for AskUserQuestion SSE event from Claude's API response
 * 5. Sends the answer via the viewer WebSocket
 * 6. Verifies the interceptor rewrote the API request
 */
async function runScenario(prompt, answerFn) {
  const env = {
    ...process.env,
    CLAUDE_INTERCEPT_SERVER: WS_URL,
    CLAUDE_INTERCEPT_DEBUG: '1',
    __CLAUDE_INTERCEPT_ACTIVE: '',
    CLAUDE_AUTO_CONNECT: 'false',
    TERM: 'xterm-256color',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    PATH: (process.env.PATH || '').split(':').filter(p => !p.includes('.claude-shim')).join(':'),
    CLAUDECODE: '',
    CLAUDE_CODE_ENTRYPOINT: '',
  };
  if (IS_BUN) {
    env.BUN_OPTIONS = `--preload ${INTERCEPT_MODULE}`;
  } else {
    env.NODE_OPTIONS = `--require ${INTERCEPT_MODULE}`;
  }

  // Snapshot existing session IDs so we can detect the NEW session from this scenario
  const existingSessionIds = new Set();
  try {
    const data = await new Promise((resolve, reject) => {
      https.get(`https://localhost:${TEST_PORT}/sessions`, { rejectUnauthorized: false }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve(d));
      }).on('error', reject);
    });
    const parsed = JSON.parse(data);
    for (const s of (parsed.sessions || [])) existingSessionIds.add(s.id);
  } catch {}

  const claudePty = pty.spawn(CLAUDE_BIN, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    cwd: PROJECT_DIR,
    env,
  });

  let ptyOutput = '';
  claudePty.onData((data) => { ptyOutput += data; });

  const exitPromise = new Promise(resolve => {
    claudePty.onExit(({ exitCode }) => resolve(exitCode));
  });

  // Wait for a NEW session to appear (not one from a previous test)
  let sessionId = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const data = await new Promise((resolve, reject) => {
        https.get(`https://localhost:${TEST_PORT}/sessions`, { rejectUnauthorized: false }, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => resolve(d));
        }).on('error', reject);
      });
      const parsed = JSON.parse(data);
      const newSession = (parsed.sessions || []).find(s => !existingSessionIds.has(s.id));
      if (newSession) {
        sessionId = newSession.id;
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  assert.ok(sessionId, 'New interceptor session should appear on server');

  // Connect viewer BEFORE typing prompt (so we don't miss SSE events)
  const viewerWs = new WebSocket(`${WS_URL}?role=viewer&session=${sessionId}`, { rejectUnauthorized: false });
  await new Promise((resolve, reject) => {
    viewerWs.on('open', resolve);
    viewerWs.on('error', reject);
  });

  // Wait for Claude's status bar (indicates TUI is fully initialized)
  const readyDeadline = Date.now() + 15000;
  while (Date.now() < readyDeadline) {
    const stripped = ptyOutput.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    if (stripped.includes('Model:') && stripped.includes('Ctx:')) break;
    await new Promise(r => setTimeout(r, 300));
  }
  await new Promise(r => setTimeout(r, 2000));

  // Type the prompt character-by-character (like a real user)
  for (let i = 0; i < prompt.length; i++) {
    claudePty.write(prompt[i]);
    await new Promise(r => setTimeout(r, 30));
  }
  await new Promise(r => setTimeout(r, 200));
  claudePty.write('\r');

  // Watch for AskUserQuestion SSE event and send the answer
  let askToolUseId = null;
  let askInput = '';
  let answered = false;
  let rewriteEvent = null;
  let apiCallsAfterAnswer = 0;
  let claudeResponseAfterAnswer = '';

  await new Promise((resolve) => {
    const onMessage = (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'ask-rewrite') {
        rewriteEvent = msg;
      }

      if (msg.type === 'sse_event' && msg.data) {
        // Detect AskUserQuestion tool_use start
        if (msg.event === 'content_block_start' && msg.data.includes('AskUserQuestion')) {
          try {
            const parsed = JSON.parse(msg.data);
            if (parsed.content_block?.name === 'AskUserQuestion') {
              askToolUseId = parsed.content_block.id;
              askInput = '';
            }
          } catch {}
        }

        // Accumulate tool input JSON
        if (askToolUseId && !answered && msg.event === 'content_block_delta') {
          try {
            const parsed = JSON.parse(msg.data);
            if (parsed.delta?.partial_json) {
              askInput += parsed.delta.partial_json;
            }
          } catch {}
        }

        // message_stop: AskUserQuestion is complete, send answer
        if (msg.event === 'message_stop' && askToolUseId && !answered) {
          answered = true;
          setTimeout(() => {
            const answer = answerFn(askToolUseId, askInput);
            viewerWs.send(JSON.stringify(answer));
          }, 2000);
        }

        // Capture Claude's text response after the answer
        if (answered && msg.event === 'content_block_delta') {
          try {
            const parsed = JSON.parse(msg.data);
            if (parsed.delta?.text) {
              claudeResponseAfterAnswer += parsed.delta.text;
            }
          } catch {}
        }
      }

      if (msg.type === 'api_request' && answered) {
        apiCallsAfterAnswer++;
      }

      // Resolve once rewrite succeeded and we have some response
      if (rewriteEvent && (claudeResponseAfterAnswer.length > 20 || apiCallsAfterAnswer > 0)) {
        setTimeout(() => {
          viewerWs.removeListener('message', onMessage);
          resolve();
        }, 5000);
      }
    };

    viewerWs.on('message', onMessage);
    setTimeout(resolve, 120000);
  });

  // Cleanup
  viewerWs.close();
  claudePty.kill();
  await new Promise(r => setTimeout(r, 2000));

  return { askToolUseId, answered, rewriteEvent, apiCallsAfterAnswer, claudeResponseAfterAnswer };
}

// Answer functions

function singleChoiceAnswer(toolUseId, inputJson) {
  let parsed = {};
  try { parsed = JSON.parse(inputJson); } catch {}
  const q = parsed.questions?.[0] || {};
  const options = q.options || [];
  return {
    type: 'ask-answer',
    toolUseId,
    questions: [{
      question: q.question || 'What is your favorite programming language?',
      selectedLabel: options[1]?.label || 'JavaScript',
    }],
  };
}

function singleMultiSelectAnswer(toolUseId, inputJson) {
  let parsed = {};
  try { parsed = JSON.parse(inputJson); } catch {}
  const q = parsed.questions?.[0] || {};
  const options = q.options || [];
  const labels = options.slice(0, 2).map(o => o.label);
  return {
    type: 'ask-answer',
    toolUseId,
    hasMultiSelect: true,
    questions: [{
      question: q.question || 'Which features do you want?',
      selectedLabel: labels.join(', ') || 'Python, JavaScript',
    }],
  };
}

function multiSelectAnswer(toolUseId, inputJson) {
  let parsed = {};
  try { parsed = JSON.parse(inputJson); } catch {}
  const questions = parsed.questions || [];

  const hasMultiSelect = questions.some(q => q.multiSelect);
  const answers = questions.map((q, idx) => {
    const options = q.options || [];
    if (q.multiSelect) {
      const labels = options.slice(0, 2).map(o => o.label);
      return { question: q.question, selectedLabel: labels.join(', ') };
    }
    const opt = options[Math.min(idx, options.length - 1)];
    return { question: q.question, selectedLabel: opt?.label || 'Option 1' };
  });

  if (answers.length === 0) {
    answers.push({ question: 'Unknown question', selectedLabel: 'Option A, Option B' });
  }

  return { type: 'ask-answer', toolUseId, questions: answers, hasMultiSelect };
}

function customOtherAnswer(toolUseId, inputJson) {
  let parsed = {};
  try { parsed = JSON.parse(inputJson); } catch {}
  const q = parsed.questions?.[0] || {};
  return {
    type: 'ask-answer',
    toolUseId,
    questions: [{
      question: q.question || 'What is your favorite programming language?',
      selectedLabel: 'Haskell - because I love pure functional programming and monads',
    }],
  };
}

// Verify Claude's response doesn't contain interruption/declined language.
// The claudeResponseAfterAnswer may start with internal JSON metadata like
// {"isNewTopic": false, "title": null} which we strip before checking.
function assertNoInterruptionLanguage(responseText) {
  if (!responseText) return; // No response captured yet, nothing to check
  // Strip leading JSON metadata blocks
  const cleaned = responseText.replace(/^\s*\{[^}]*\}\s*/g, '').toLowerCase();
  if (!cleaned) return;
  const badPatterns = [/\binterrupt/i, /\bdeclined?\b/i, /\blet me know what you'd like/i];
  for (const pattern of badPatterns) {
    assert.ok(
      !pattern.test(cleaned),
      `Claude should not mention interruption, got: "${cleaned.slice(0, 200)}"`
    );
  }
}

// Test suite

describe('AskUserQuestion E2E', { skip: SKIP_REASON || false, timeout: 600000 }, () => {
  let serverProcess;

  before(async () => {
    serverProcess = spawn('node', [path.join(PROJECT_DIR, 'src/server.js')], {
      env: { ...process.env, PORT: String(TEST_PORT) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Wait for server ready
    const deadline = Date.now() + 8000;
    await new Promise((resolve) => {
      let ready = false;
      serverProcess.stdout.on('data', (d) => {
        const line = d.toString();
        if (!ready && (line.includes('Endpoints') || line.includes('health'))) {
          ready = true;
          resolve();
        }
      });
      const check = setInterval(() => {
        if (Date.now() > deadline) { clearInterval(check); resolve(); }
      }, 200);
    });

    await new Promise(r => setTimeout(r, 1000));
  });

  after(() => {
    if (serverProcess) serverProcess.kill();
  });

  test('Single-choice: click option button', { timeout: 120000 }, async () => {
    const result = await runScenario(
      'Use the AskUserQuestion tool to ask me: "What is your favorite programming language?" with options: Python ("Great for data science"), JavaScript ("Universal web language"), Rust ("Fast and safe"), Go ("Simple and concurrent"). header: "Language", multiSelect: false. Only call the tool, nothing else.',
      singleChoiceAnswer
    );

    assert.ok(result.askToolUseId, 'AskUserQuestion should be detected');
    assert.ok(result.answered, 'Answer should have been sent');
    assert.ok(result.rewriteEvent, 'API rewrite should have succeeded');
    assertNoInterruptionLanguage(result.claudeResponseAfterAnswer);
  });

  test('Multi-select single question: select multiple options and submit', { timeout: 120000 }, async () => {
    const result = await runScenario(
      'Use AskUserQuestion with exactly 1 question. The question: "Which programming languages do you use regularly?" multiSelect: true, header: "Languages", options: Python ("Data science and scripting"), JavaScript ("Web development"), Rust ("Systems programming"), Go ("Cloud services"). Only call the tool, nothing else.',
      singleMultiSelectAnswer
    );

    assert.ok(result.askToolUseId, 'AskUserQuestion should be detected');
    assert.ok(result.answered, 'Answer should have been sent');
    assert.ok(result.rewriteEvent, 'API rewrite should have succeeded');
    assertNoInterruptionLanguage(result.claudeResponseAfterAnswer);
  });

  test('Multi-select multi-question: select multiple options', { timeout: 120000 }, async () => {
    const result = await runScenario(
      'Use AskUserQuestion with 2 questions. Q1: "Which languages do you use?" multiSelect: true, header: "Languages", options: Python ("Versatile"), JavaScript ("Web"), Rust ("Fast"), Go ("Simple"). Q2: "Experience level?" multiSelect: false, header: "Level", options: Beginner ("New"), Intermediate ("Some"), Expert ("Years"). Only call the tool.',
      multiSelectAnswer
    );

    assert.ok(result.askToolUseId, 'AskUserQuestion should be detected');
    assert.ok(result.answered, 'Answer should have been sent');
    assert.ok(result.rewriteEvent, 'API rewrite should have succeeded');
    assertNoInterruptionLanguage(result.claudeResponseAfterAnswer);
  });

  test('Custom "Other" text response', { timeout: 120000 }, async () => {
    const result = await runScenario(
      'Use AskUserQuestion to ask: "What programming language should we use?" with options: Python ("Popular"), Java ("Enterprise"), TypeScript ("Modern web"). multiSelect: false, header: "Lang". Only call the tool.',
      customOtherAnswer
    );

    assert.ok(result.askToolUseId, 'AskUserQuestion should be detected');
    assert.ok(result.answered, 'Answer should have been sent');
    assert.ok(result.rewriteEvent, 'API rewrite should have succeeded');
    assertNoInterruptionLanguage(result.claudeResponseAfterAnswer);
  });
});
