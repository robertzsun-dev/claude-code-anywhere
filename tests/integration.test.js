#!/usr/bin/env node

/**
 * Integration Tests
 * End-to-end tests for the intercept-based system
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'child_process';
import { WebSocket } from 'ws';

const TEST_PORT = 8767;
const TEST_URL = `ws://localhost:${TEST_PORT}`;

describe('Integration Tests', () => {
  let serverProcess;

  before(async () => {
    // Start server for integration testing
    serverProcess = spawn('node', ['src/server.js'], {
      env: { ...process.env, PORT: TEST_PORT, HOST: 'localhost' },
      stdio: 'pipe'
    });

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  after(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  test('Complete workflow: interceptor creates session, viewer connects, input forwarding works', async () => {
    let sessionId = null;

    // Step 1: Create interceptor connection
    const interceptorWs = new WebSocket(`${TEST_URL}?role=interceptor&pid=88888`);

    // Wait for session creation
    sessionId = await new Promise((resolve, reject) => {
      interceptorWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session-created') {
          resolve(message.sessionId);
        }
      });

      interceptorWs.on('error', reject);

      setTimeout(() => reject(new Error('Timeout waiting for session')), 5000);
    });

    assert.ok(sessionId, 'Session created');

    // Step 2: Connect viewer to session
    const viewerWs = new WebSocket(`${TEST_URL}?role=viewer&session=${sessionId}`);

    await new Promise((resolve, reject) => {
      viewerWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session-attached') {
          resolve();
        } else if (message.type === 'error') {
          reject(new Error(message.error));
        }
      });

      viewerWs.on('error', reject);

      setTimeout(() => reject(new Error('Timeout attaching viewer')), 5000);
    });

    // Step 3: Send API event from interceptor
    const testEvent = {
      type: 'api_request',
      ts: Date.now(),
      data: { model: 'claude-sonnet-4-5-20250929', messages_count: 1 }
    };
    let received = false;

    const receivePromise = new Promise((resolve) => {
      viewerWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'api_request') {
          received = true;
          resolve();
        }
      });
    });

    interceptorWs.send(JSON.stringify(testEvent));

    await receivePromise;
    assert.ok(received, 'Viewer received API event from interceptor');

    // Step 4: Send input from viewer to interceptor
    const testInput = 'test command\n';
    let inputReceived = false;

    const inputPromise = new Promise((resolve) => {
      interceptorWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'input' && message.data === testInput) {
          inputReceived = true;
          resolve();
        }
      });
    });

    viewerWs.send(JSON.stringify({
      type: 'input',
      data: testInput
    }));

    await inputPromise;
    assert.ok(inputReceived, 'Interceptor received input from viewer');

    // Step 5: Verify session appears in sessions list
    const response = await fetch(`http://localhost:${TEST_PORT}/sessions`);
    const sessionsData = await response.json();

    const foundSession = sessionsData.sessions.find(s => s.id === sessionId);
    assert.ok(foundSession, 'Session appears in sessions list');

    // Cleanup
    interceptorWs.close();
    viewerWs.close();
  });

  test('Multiple viewers can connect to same session', async () => {
    // Create interceptor
    const interceptorWs = new WebSocket(`${TEST_URL}?role=interceptor&pid=88887`);

    const sessionId = await new Promise((resolve) => {
      interceptorWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session-created') {
          resolve(message.sessionId);
        }
      });
    });

    // Connect two viewers
    const viewer1Ws = new WebSocket(`${TEST_URL}?role=viewer&session=${sessionId}`);
    const viewer2Ws = new WebSocket(`${TEST_URL}?role=viewer&session=${sessionId}`);

    await Promise.all([
      new Promise((resolve) => {
        viewer1Ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'session-attached') resolve();
        });
      }),
      new Promise((resolve) => {
        viewer2Ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'session-attached') resolve();
        });
      })
    ]);

    // Send API event from interceptor
    const testEvent = {
      type: 'sse_event',
      ts: Date.now(),
      event: 'content_block_delta',
      data: JSON.stringify({ delta: { type: 'text_delta', text: 'Hello' } })
    };

    const viewer1Received = new Promise((resolve) => {
      viewer1Ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'sse_event') {
          resolve(true);
        }
      });
    });

    const viewer2Received = new Promise((resolve) => {
      viewer2Ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'sse_event') {
          resolve(true);
        }
      });
    });

    interceptorWs.send(JSON.stringify(testEvent));

    const [v1, v2] = await Promise.all([viewer1Received, viewer2Received]);
    assert.ok(v1 && v2, 'Both viewers received event');

    // Cleanup
    interceptorWs.close();
    viewer1Ws.close();
    viewer2Ws.close();
  });

  test('Session metadata is properly stored and transmitted', async () => {
    const interceptorWs = new WebSocket(`${TEST_URL}?role=interceptor&pid=88886`);

    const sessionId = await new Promise((resolve) => {
      interceptorWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session-created') {
          resolve(message.sessionId);
        }
      });
    });

    // Send metadata
    const testMetadata = {
      cwd: '/test/directory',
      hostname: 'test-host',
      platform: 'linux',
      user: 'testuser',
      pid: 88886
    };

    interceptorWs.send(JSON.stringify({
      type: 'metadata',
      data: testMetadata
    }));

    // Wait for metadata to propagate
    await new Promise(resolve => setTimeout(resolve, 500));

    // Connect viewer and check metadata
    const viewerWs = new WebSocket(`${TEST_URL}?role=viewer&session=${sessionId}`);

    const metadata = await new Promise((resolve) => {
      viewerWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session-attached') {
          resolve(message.metadata);
        }
      });
    });

    assert.strictEqual(metadata.cwd, testMetadata.cwd);
    assert.strictEqual(metadata.hostname, testMetadata.hostname);
    assert.strictEqual(metadata.user, testMetadata.user);

    // Cleanup
    interceptorWs.close();
    viewerWs.close();
  });

  test('Events buffer preserves all events for late-joining viewers', async () => {
    const interceptorWs = new WebSocket(`${TEST_URL}?role=interceptor&pid=88885`);

    const sessionId = await new Promise((resolve) => {
      interceptorWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session-created') {
          resolve(message.sessionId);
        }
      });
    });

    // Send a batch of events before any viewer connects
    const eventCount = 50;
    for (let i = 0; i < eventCount; i++) {
      interceptorWs.send(JSON.stringify({
        type: 'sse_event',
        ts: Date.now(),
        event: 'content_block_delta',
        data: JSON.stringify({ delta: { type: 'text_delta', text: `chunk ${i}` } })
      }));
    }

    // Wait for all messages to be processed
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Connect viewer and check events
    const viewerWs = new WebSocket(`${TEST_URL}?role=viewer&session=${sessionId}`);

    const events = await new Promise((resolve) => {
      viewerWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session-attached') {
          resolve(message.events);
        }
      });
    });

    assert.strictEqual(events.length, eventCount, 'All events preserved');

    // Cleanup
    interceptorWs.close();
    viewerWs.close();
  });
});
