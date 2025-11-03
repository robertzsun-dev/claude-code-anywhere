#!/usr/bin/env node

/**
 * Server Tests
 * Tests for the WebSocket session server
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { WebSocket } from 'ws';
import { spawn } from 'child_process';

const TEST_PORT = 8766;
const TEST_URL = `ws://localhost:${TEST_PORT}`;

describe('Server Tests', () => {
  let serverProcess;

  before(async () => {
    // Start server for testing
    serverProcess = spawn('node', ['server.js'], {
      env: { ...process.env, PORT: TEST_PORT, HOST: 'localhost' }
    });

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  after(() => {
    // Stop server
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  test('Server health endpoint returns OK', async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/health`);
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.strictEqual(data.status, 'ok');
    assert.strictEqual(typeof data.sessions, 'number');
    assert.strictEqual(typeof data.clients, 'number');
  });

  test('Server sessions endpoint returns empty array initially', async () => {
    const response = await fetch(`http://localhost:${TEST_PORT}/sessions`);
    const data = await response.json();

    assert.strictEqual(response.status, 200);
    assert.ok(Array.isArray(data.sessions));
  });

  test('WebSocket connection as wrapper creates session', (t, done) => {
    const ws = new WebSocket(`${TEST_URL}?role=wrapper`);
    let sessionId = null;

    ws.on('open', () => {
      assert.ok(true, 'WebSocket connection opened');
    });

    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());

      if (message.type === 'session-created') {
        sessionId = message.sessionId;
        assert.ok(sessionId, 'Session ID received');
        assert.strictEqual(typeof sessionId, 'string');
        assert.ok(sessionId.length > 0);
        ws.close();
      }
    });

    ws.on('close', () => {
      assert.ok(sessionId, 'Session was created before close');
      done();
    });

    ws.on('error', (err) => {
      assert.fail(`WebSocket error: ${err.message}`);
      done();
    });
  });

  test('Viewer can list sessions', async (t) => {
    // First create a session
    const wrapperWs = new WebSocket(`${TEST_URL}?role=wrapper`);

    await new Promise((resolve) => {
      wrapperWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session-created') {
          resolve();
        }
      });
    });

    // Wait a bit for session to register
    await new Promise(resolve => setTimeout(resolve, 500));

    // Now check sessions list
    const response = await fetch(`http://localhost:${TEST_PORT}/sessions`);
    const data = await response.json();

    assert.ok(Array.isArray(data.sessions));
    assert.ok(data.sessions.length > 0, 'At least one session exists');
    assert.ok(data.sessions[0].id, 'Session has ID');
    assert.ok(data.sessions[0].created, 'Session has created timestamp');

    wrapperWs.close();
  });

  test('Viewer can attach to session', async (t) => {
    // Create a wrapper session
    const wrapperWs = new WebSocket(`${TEST_URL}?role=wrapper`);
    let sessionId = null;

    await new Promise((resolve) => {
      wrapperWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session-created') {
          sessionId = message.sessionId;
          resolve();
        }
      });
    });

    assert.ok(sessionId, 'Got session ID from wrapper');

    // Now connect as viewer
    const viewerWs = new WebSocket(`${TEST_URL}?role=viewer&session=${sessionId}`);
    let attached = false;

    await new Promise((resolve, reject) => {
      viewerWs.on('message', (data) => {
        const message = JSON.parse(data.toString());

        if (message.type === 'session-attached') {
          attached = true;
          assert.strictEqual(message.sessionId, sessionId);
          assert.ok(message.metadata, 'Session has metadata');
          assert.ok(Array.isArray(message.history), 'Session has history');
          resolve();
        } else if (message.type === 'error') {
          reject(new Error(message.error));
        }
      });

      viewerWs.on('error', reject);
    });

    assert.ok(attached, 'Viewer attached to session');

    wrapperWs.close();
    viewerWs.close();
  });

  test('Messages broadcast from wrapper to viewers', async (t) => {
    // Create wrapper session
    const wrapperWs = new WebSocket(`${TEST_URL}?role=wrapper`);
    let sessionId = null;

    await new Promise((resolve) => {
      wrapperWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session-created') {
          sessionId = message.sessionId;
          resolve();
        }
      });
    });

    // Connect viewer
    const viewerWs = new WebSocket(`${TEST_URL}?role=viewer&session=${sessionId}`);

    await new Promise((resolve) => {
      viewerWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session-attached') {
          resolve();
        }
      });
    });

    // Send output from wrapper
    const testOutput = 'Hello from test!';
    let receivedOutput = false;

    const outputPromise = new Promise((resolve) => {
      viewerWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'output' && message.data === testOutput) {
          receivedOutput = true;
          resolve();
        }
      });
    });

    wrapperWs.send(JSON.stringify({
      type: 'output',
      data: testOutput
    }));

    await outputPromise;
    assert.ok(receivedOutput, 'Viewer received output from wrapper');

    wrapperWs.close();
    viewerWs.close();
  });

  test('Session history is preserved and sent to new viewers', async (t) => {
    // Create wrapper and send some output
    const wrapperWs = new WebSocket(`${TEST_URL}?role=wrapper`);
    let sessionId = null;

    await new Promise((resolve) => {
      wrapperWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session-created') {
          sessionId = message.sessionId;
          resolve();
        }
      });
    });

    // Send multiple outputs
    const outputs = ['Line 1', 'Line 2', 'Line 3'];
    for (const output of outputs) {
      wrapperWs.send(JSON.stringify({
        type: 'output',
        data: output
      }));
    }

    // Wait for messages to be processed
    await new Promise(resolve => setTimeout(resolve, 500));

    // Now connect as viewer
    const viewerWs = new WebSocket(`${TEST_URL}?role=viewer&session=${sessionId}`);
    let history = null;

    await new Promise((resolve) => {
      viewerWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session-attached') {
          history = message.history;
          resolve();
        }
      });
    });

    assert.ok(Array.isArray(history), 'History is an array');
    assert.strictEqual(history.length, outputs.length, 'All outputs in history');

    // Verify each output
    for (let i = 0; i < outputs.length; i++) {
      assert.strictEqual(history[i].type, 'output');
      assert.strictEqual(history[i].data, outputs[i]);
    }

    wrapperWs.close();
    viewerWs.close();
  });

  test('Invalid role returns error', (t, done) => {
    const ws = new WebSocket(`${TEST_URL}?role=invalid`);

    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      assert.strictEqual(message.type, 'error');
      assert.ok(message.error.includes('Invalid role'));
    });

    ws.on('close', () => {
      done();
    });
  });

  test('Viewer cannot attach to non-existent session', (t, done) => {
    const ws = new WebSocket(`${TEST_URL}?role=viewer&session=nonexistent`);

    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      assert.strictEqual(message.type, 'error');
      assert.ok(message.error.includes('not found'));
    });

    ws.on('close', () => {
      done();
    });
  });
});
