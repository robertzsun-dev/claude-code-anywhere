/**
 * Mobile API Routes
 * REST endpoints for iOS/Android mobile app
 */

/**
 * Parse JSON body from request
 */
async function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (err) {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

/**
 * Send JSON response
 */
function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end(JSON.stringify(data));
}

/**
 * Extract bearer token from Authorization header
 */
function extractBearerToken(req) {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
        return auth.slice(7);
    }
    return null;
}

/**
 * Create mobile route handler
 * @param {Object} deps - Dependencies (deviceRegistry, sessions, fcmService, etc)
 */
function createMobileRoutes(deps) {
    const { deviceRegistry, sessions, fcmService, getServerUrl } = deps;

    return async function handleMobileRoute(req, res) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const path = url.pathname;
        const method = req.method;

        // Handle CORS preflight
        if (method === 'OPTIONS') {
            sendJson(res, 204, {});
            return true;
        }

        // =========================================
        // Pairing Endpoints (no auth required)
        // =========================================

        // POST /api/pair/initiate - Generate pairing code
        if (method === 'POST' && path === '/api/pair/initiate') {
            const serverUrl = getServerUrl ? getServerUrl() : `ws://${req.headers.host}`;
            const pairing = deviceRegistry.initiatePairing(serverUrl);
            sendJson(res, 200, pairing);
            return true;
        }

        // GET /api/pair/qr - Get QR code data for current pairing
        if (method === 'GET' && path === '/api/pair/qr') {
            const serverUrl = getServerUrl ? getServerUrl() : `ws://${req.headers.host}`;
            const pairing = deviceRegistry.initiatePairing(serverUrl);
            sendJson(res, 200, {
                qrData: pairing.qrData,
                pairingCode: pairing.pairingCode,
                expiresAt: pairing.expiresAt
            });
            return true;
        }

        // POST /api/pair/complete - Complete pairing with code
        if (method === 'POST' && path === '/api/pair/complete') {
            try {
                const body = await parseJsonBody(req);
                const { pairingCode, deviceId, name, platform, fcmToken } = body;

                if (!pairingCode) {
                    sendJson(res, 400, { error: 'Missing pairing code' });
                    return true;
                }

                const result = deviceRegistry.completePairing(pairingCode, {
                    deviceId,
                    name,
                    platform,
                    fcmToken
                });

                if (result.success) {
                    sendJson(res, 200, result);
                } else {
                    sendJson(res, 400, { error: result.error });
                }
            } catch (err) {
                sendJson(res, 400, { error: err.message });
            }
            return true;
        }

        // =========================================
        // Authenticated Endpoints
        // =========================================

        const token = extractBearerToken(req);
        const device = token ? deviceRegistry.getDeviceByToken(token) : null;

        // Check auth for protected routes
        const protectedPaths = [
            '/api/devices',
            '/api/sessions',
            '/api/subscribe',
            '/api/unsubscribe',
            '/api/input'
        ];

        if (protectedPaths.some(p => path.startsWith(p))) {
            if (!device) {
                sendJson(res, 401, { error: 'Unauthorized' });
                return true;
            }
            deviceRegistry.updateLastSeen(device.deviceId);
        }

        // PUT /api/devices/fcm-token - Update FCM token
        if (method === 'PUT' && path === '/api/devices/fcm-token') {
            try {
                const body = await parseJsonBody(req);
                const result = deviceRegistry.updateFcmToken(device.deviceId, body.fcmToken);
                sendJson(res, result.success ? 200 : 400, result);
            } catch (err) {
                sendJson(res, 400, { error: err.message });
            }
            return true;
        }

        // DELETE /api/devices - Unpair device
        if (method === 'DELETE' && path === '/api/devices') {
            const result = deviceRegistry.removeDevice(device.deviceId);
            sendJson(res, result.success ? 200 : 400, result);
            return true;
        }

        // GET /api/devices - Get current device info
        if (method === 'GET' && path === '/api/devices') {
            sendJson(res, 200, { device: deviceRegistry.sanitizeDevice(device) });
            return true;
        }

        // GET /api/sessions - List all sessions
        if (method === 'GET' && path === '/api/sessions') {
            const sessionList = [];
            for (const [id, session] of sessions) {
                sessionList.push({
                    id,
                    created: session.created,
                    lastActivity: session.lastActivity,
                    metadata: session.metadata,
                    waitingState: null,
                    subscribed: device.subscribedSessions.has(id)
                });
            }
            sendJson(res, 200, { sessions: sessionList });
            return true;
        }

        // GET /api/sessions/:id - Get session details
        const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
        if (method === 'GET' && sessionMatch) {
            const sessionId = sessionMatch[1];
            const session = sessions.get(sessionId);

            if (!session) {
                sendJson(res, 404, { error: 'Session not found' });
                return true;
            }

            sendJson(res, 200, {
                session: {
                    id: sessionId,
                    created: session.created,
                    lastActivity: session.lastActivity,
                    metadata: session.metadata,
                    waitingState: null,
                    subscribed: device.subscribedSessions.has(sessionId)
                }
            });
            return true;
        }

        // GET /api/sessions/:id/history - Get session history
        const historyMatch = path.match(/^\/api\/sessions\/([^/]+)\/history$/);
        if (method === 'GET' && historyMatch) {
            const sessionId = historyMatch[1];
            const session = sessions.get(sessionId);

            if (!session) {
                sendJson(res, 404, { error: 'Session not found' });
                return true;
            }

            const format = url.searchParams.get('format') || 'raw';
            const limit = parseInt(url.searchParams.get('limit') || '100');

            let history = session.history.slice(-limit);

            if (format === 'parsed') {
                // Return simplified parsed history for conversation view
                history = history.map(h => ({
                    type: h.type,
                    data: stripAnsiCodes(h.data),
                    timestamp: h.timestamp
                }));
            }

            sendJson(res, 200, { history });
            return true;
        }

        // POST /api/subscribe/:sessionId - Subscribe to session notifications
        const subscribeMatch = path.match(/^\/api\/subscribe\/([^/]+)$/);
        if (method === 'POST' && subscribeMatch) {
            const sessionId = subscribeMatch[1];
            const session = sessions.get(sessionId);

            if (!session) {
                sendJson(res, 404, { error: 'Session not found' });
                return true;
            }

            const result = deviceRegistry.subscribeToSession(device.deviceId, sessionId);
            sendJson(res, result.success ? 200 : 400, result);
            return true;
        }

        // DELETE /api/subscribe/:sessionId - Unsubscribe from session
        const unsubscribeMatch = path.match(/^\/api\/subscribe\/([^/]+)$/);
        if (method === 'DELETE' && unsubscribeMatch) {
            const sessionId = unsubscribeMatch[1];
            const result = deviceRegistry.unsubscribeFromSession(device.deviceId, sessionId);
            sendJson(res, result.success ? 200 : 400, result);
            return true;
        }

        // POST /api/sessions/:id/input - Send input to session
        const inputMatch = path.match(/^\/api\/sessions\/([^/]+)\/input$/);
        if (method === 'POST' && inputMatch) {
            const sessionId = inputMatch[1];
            const session = sessions.get(sessionId);

            if (!session) {
                sendJson(res, 404, { error: 'Session not found' });
                return true;
            }

            if (!session.interceptorWs) {
                sendJson(res, 400, { error: 'Session has no active interceptor' });
                return true;
            }

            try {
                const body = await parseJsonBody(req);
                const { input, action } = body;

                let data = input || '';

                // Handle quick actions
                if (action) {
                    switch (action) {
                        case 'yes':
                            data = 'y\n';
                            break;
                        case 'no':
                            data = 'n\n';
                            break;
                        case 'continue':
                        case 'enter':
                            data = '\n';
                            break;
                        case 'cancel':
                            data = '\x03'; // Ctrl+C
                            break;
                        default:
                            data = input || '';
                    }
                }

                // Send to interceptor for stdin injection
                session.interceptorWs.send(JSON.stringify({
                    type: 'input',
                    data
                }));

                // Clear badge
                if (fcmService && fcmService.isEnabled()) {
                    fcmService.clearBadge(device);
                }

                sendJson(res, 200, { success: true });
            } catch (err) {
                sendJson(res, 400, { error: err.message });
            }
            return true;
        }

        // POST /api/sessions/:id/quick-response - Send quick response
        const quickMatch = path.match(/^\/api\/sessions\/([^/]+)\/quick-response$/);
        if (method === 'POST' && quickMatch) {
            const sessionId = quickMatch[1];
            const session = sessions.get(sessionId);

            if (!session) {
                sendJson(res, 404, { error: 'Session not found' });
                return true;
            }

            if (!session.interceptorWs) {
                sendJson(res, 400, { error: 'Session has no active interceptor' });
                return true;
            }

            try {
                const body = await parseJsonBody(req);
                const { action, customText } = body;

                let data = '';
                switch (action) {
                    case 'yes':
                        data = 'y\n';
                        break;
                    case 'no':
                        data = 'n\n';
                        break;
                    case 'continue':
                    case 'enter':
                        data = '\n';
                        break;
                    case 'cancel':
                        data = '\x03';
                        break;
                    case 'custom':
                        data = (customText || '') + '\n';
                        break;
                    default:
                        sendJson(res, 400, { error: 'Invalid action' });
                        return true;
                }

                session.interceptorWs.send(JSON.stringify({
                    type: 'input',
                    data
                }));

                if (fcmService && fcmService.isEnabled()) {
                    fcmService.clearBadge(device);
                }

                sendJson(res, 200, { success: true, action, sent: data });
            } catch (err) {
                sendJson(res, 400, { error: err.message });
            }
            return true;
        }

        // GET /api/fcm/status - Check FCM status
        if (method === 'GET' && path === '/api/fcm/status') {
            sendJson(res, 200, fcmService ? fcmService.getStatus() : { enabled: false });
            return true;
        }

        // Route not handled
        return false;
    };
}

/**
 * Strip ANSI escape codes from text
 */
function stripAnsiCodes(text) {
    if (!text) return '';
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
               .replace(/\x1b\][^\x07]*\x07/g, '');
}

export { createMobileRoutes, parseJsonBody, sendJson, extractBearerToken, stripAnsiCodes };
