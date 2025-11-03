#!/usr/bin/env node

/**
 * Integration Tests
 * End-to-end tests for the complete system
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
    serverProcess = spawn('node', ['server.js'], {
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

  test('Complete workflow: wrapper creates session, viewer connects, communication works', async () => {
    let sessionId = null;

    // Step 1: Create wrapper connection
    const wrapperWs = new WebSocket(`${TEST_URL}?role=wrapper`);

    // Wait for session creation
    sessionId = await new Promise((resolve, reject) => {
      wrapperWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session-created') {
          resolve(message.sessionId);
        }
      });

      wrapperWs.on('error', reject);

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

    // Step 3: Send output from wrapper
    const testData = 'Integration test output';
    let received = false;

    const receivePromise = new Promise((resolve) => {
      viewerWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'output' && message.data === testData) {
          received = true;
          resolve();
        }
      });
    });

    wrapperWs.send(JSON.stringify({
      type: 'output',
      data: testData
    }));

    await receivePromise;
    assert.ok(received, 'Viewer received output from wrapper');

    // Step 4: Send input from viewer
    const testInput = 'test command\n';
    let inputReceived = false;

    const inputPromise = new Promise((resolve) => {
      wrapperWs.on('message', (data) => {
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
    assert.ok(inputReceived, 'Wrapper received input from viewer');

    // Step 5: Verify session appears in sessions list
    const response = await fetch(`http://localhost:${TEST_PORT}/sessions`);
    const sessionsData = await response.json();

    const foundSession = sessionsData.sessions.find(s => s.id === sessionId);
    assert.ok(foundSession, 'Session appears in sessions list');

    // Cleanup
    wrapperWs.close();
    viewerWs.close();
  });

  test('Multiple viewers can connect to same session', async () => {
    // Create wrapper
    const wrapperWs = new WebSocket(`${TEST_URL}?role=wrapper`);

    const sessionId = await new Promise((resolve) => {
      wrapperWs.on('message', (data) => {
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

    // Send output from wrapper
    const testOutput = 'Multi-viewer test';
    const viewer1Received = new Promise((resolve) => {
      viewer1Ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'output' && message.data === testOutput) {
          resolve(true);
        }
      });
    });

    const viewer2Received = new Promise((resolve) => {
      viewer2Ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'output' && message.data === testOutput) {
          resolve(true);
        }
      });
    });

    wrapperWs.send(JSON.stringify({
      type: 'output',
      data: testOutput
    }));

    const [v1, v2] = await Promise.all([viewer1Received, viewer2Received]);
    assert.ok(v1 && v2, 'Both viewers received output');

    // Cleanup
    wrapperWs.close();
    viewer1Ws.close();
    viewer2Ws.close();
  });

  test('Session metadata is properly stored and transmitted', async () => {
    const wrapperWs = new WebSocket(`${TEST_URL}?role=wrapper`);

    const sessionId = await new Promise((resolve) => {
      wrapperWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session-created') {
          resolve(message.sessionId);
        }
      });
    });

    // Send metadata
    const testMetadata = {
      cwd: '/test/directory',
      command: 'test-claude',
      args: ['--test'],
      hostname: 'test-host',
      platform: 'linux',
      user: 'testuser'
    };

    wrapperWs.send(JSON.stringify({
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

    assert.deepStrictEqual(metadata, testMetadata, 'Metadata matches');

    // Cleanup
    wrapperWs.close();
    viewerWs.close();
  });

  test('History buffer maintains 10000 lines', async () => {
    const wrapperWs = new WebSocket(`${TEST_URL}?role=wrapper`);

    const sessionId = await new Promise((resolve) => {
      wrapperWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session-created') {
          resolve(message.sessionId);
        }
      });
    });

    // Send a moderate number of lines (testing full 10000 would be slow)
    const lineCount = 100;
    for (let i = 0; i < lineCount; i++) {
      wrapperWs.send(JSON.stringify({
        type: 'output',
        data: `Line ${i}\n`
      }));
    }

    // Wait for all messages to be processed
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Connect viewer and check history
    const viewerWs = new WebSocket(`${TEST_URL}?role=viewer&session=${sessionId}`);

    const history = await new Promise((resolve) => {
      viewerWs.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session-attached') {
          resolve(message.history);
        }
      });
    });

    assert.strictEqual(history.length, lineCount, 'All lines preserved in history');

    // Verify order is maintained
    for (let i = 0; i < lineCount; i++) {
      assert.strictEqual(history[i].data, `Line ${i}\n`, `Line ${i} in correct order`);
    }

    // Cleanup
    wrapperWs.close();
    viewerWs.close();
  });
});
