/**
 * Firebase Cloud Messaging (FCM) Push Service
 * Sends push notifications to iOS (and future Android) devices
 */

class FCMService {
    constructor(options = {}) {
        this.admin = null;
        this.initialized = false;
        this.enabled = false;

        // Try to initialize Firebase Admin SDK
        this.initialize(options);
    }

    /**
     * Initialize Firebase Admin SDK
     */
    async initialize(options = {}) {
        // Check for firebase-admin availability
        try {
            const firebaseAdmin = await import('firebase-admin');
            this.admin = firebaseAdmin.default;
        } catch (err) {
            console.log('[FCM] firebase-admin not installed. Push notifications disabled.');
            console.log('[FCM] To enable, run: npm install firebase-admin');
            return;
        }

        // Check for credentials
        const serviceAccountPath = options.serviceAccountPath || process.env.FIREBASE_SERVICE_ACCOUNT;
        const projectId = options.projectId || process.env.FIREBASE_PROJECT_ID;
        const privateKey = options.privateKey || process.env.FIREBASE_PRIVATE_KEY;
        const clientEmail = options.clientEmail || process.env.FIREBASE_CLIENT_EMAIL;

        if (serviceAccountPath) {
            // Initialize with service account file
            try {
                const fs = await import('fs');
                const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
                this.admin.initializeApp({
                    credential: this.admin.credential.cert(serviceAccount)
                });
                this.initialized = true;
                this.enabled = true;
                console.log('[FCM] Initialized with service account file');
            } catch (err) {
                console.error('[FCM] Failed to initialize with service account:', err.message);
            }
        } else if (projectId && privateKey && clientEmail) {
            // Initialize with environment variables
            try {
                this.admin.initializeApp({
                    credential: this.admin.credential.cert({
                        projectId,
                        privateKey: privateKey.replace(/\\n/g, '\n'),
                        clientEmail
                    })
                });
                this.initialized = true;
                this.enabled = true;
                console.log('[FCM] Initialized with environment variables');
            } catch (err) {
                console.error('[FCM] Failed to initialize with env vars:', err.message);
            }
        } else {
            console.log('[FCM] No Firebase credentials configured. Push notifications disabled.');
            console.log('[FCM] Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_PROJECT_ID + FIREBASE_PRIVATE_KEY + FIREBASE_CLIENT_EMAIL');
        }
    }

    /**
     * Send notification when Claude is waiting for input
     * @param {Object} device - Device from DeviceRegistry
     * @param {Object} waitingInfo - Information about what Claude is waiting for
     */
    async sendWaitingNotification(device, waitingInfo) {
        if (!this.enabled || !device.fcmToken) {
            return { success: false, error: 'FCM not enabled or no FCM token' };
        }

        const { sessionId, reason, quickActions, context } = waitingInfo;

        // Truncate context for notification
        const shortContext = context ? context.slice(-100).trim() : '';

        const message = {
            token: device.fcmToken,
            notification: {
                title: 'Claude needs input',
                body: reason || 'Claude Code is waiting for your response'
            },
            data: {
                type: 'waiting-for-input',
                sessionId: sessionId || '',
                reason: reason || '',
                quickActions: JSON.stringify(quickActions || []),
                context: shortContext
            },
            apns: {
                payload: {
                    aps: {
                        'interruption-level': 'time-sensitive',
                        sound: 'default',
                        badge: 1
                    }
                }
            },
            android: {
                priority: 'high',
                notification: {
                    channelId: 'claude-input',
                    priority: 'high',
                    defaultSound: true
                }
            }
        };

        try {
            const response = await this.admin.messaging().send(message);
            console.log(`[FCM] Sent notification to ${device.deviceId}:`, response);
            return { success: true, messageId: response };
        } catch (err) {
            console.error(`[FCM] Failed to send to ${device.deviceId}:`, err.message);

            // Handle invalid token
            if (err.code === 'messaging/invalid-registration-token' ||
                err.code === 'messaging/registration-token-not-registered') {
                return { success: false, error: 'invalid-token', shouldRemove: true };
            }

            return { success: false, error: err.message };
        }
    }

    /**
     * Send notification for session events
     * @param {Object} device - Device from DeviceRegistry
     * @param {string} eventType - Event type (session-started, session-ended, etc)
     * @param {Object} sessionInfo - Session information
     */
    async sendSessionNotification(device, eventType, sessionInfo) {
        if (!this.enabled || !device.fcmToken) {
            return { success: false, error: 'FCM not enabled or no FCM token' };
        }

        const titles = {
            'session-started': 'New Claude session',
            'session-ended': 'Claude session ended',
            'session-error': 'Claude session error'
        };

        const message = {
            token: device.fcmToken,
            notification: {
                title: titles[eventType] || 'Claude Code',
                body: sessionInfo.message || `Session ${sessionInfo.sessionId}`
            },
            data: {
                type: eventType,
                sessionId: sessionInfo.sessionId || '',
                hostname: sessionInfo.hostname || '',
                cwd: sessionInfo.cwd || ''
            },
            apns: {
                payload: {
                    aps: {
                        sound: 'default'
                    }
                }
            }
        };

        try {
            const response = await this.admin.messaging().send(message);
            return { success: true, messageId: response };
        } catch (err) {
            console.error(`[FCM] Failed to send session notification:`, err.message);
            return { success: false, error: err.message };
        }
    }

    /**
     * Send notification to multiple devices
     * @param {Array} devices - Array of devices from DeviceRegistry
     * @param {Object} notification - Notification data
     */
    async sendToMultiple(devices, notification) {
        if (!this.enabled) {
            return { success: false, error: 'FCM not enabled' };
        }

        const tokens = devices.filter(d => d.fcmToken).map(d => d.fcmToken);
        if (tokens.length === 0) {
            return { success: false, error: 'No valid FCM tokens' };
        }

        const message = {
            notification: {
                title: notification.title,
                body: notification.body
            },
            data: notification.data || {},
            apns: {
                payload: {
                    aps: {
                        'interruption-level': 'time-sensitive',
                        sound: 'default'
                    }
                }
            }
        };

        try {
            const response = await this.admin.messaging().sendEachForMulticast({
                tokens,
                ...message
            });

            const results = {
                successCount: response.successCount,
                failureCount: response.failureCount,
                invalidTokens: []
            };

            // Track invalid tokens for removal
            response.responses.forEach((resp, idx) => {
                if (!resp.success &&
                    (resp.error?.code === 'messaging/invalid-registration-token' ||
                     resp.error?.code === 'messaging/registration-token-not-registered')) {
                    results.invalidTokens.push(tokens[idx]);
                }
            });

            return { success: true, results };
        } catch (err) {
            console.error('[FCM] Failed to send multicast:', err.message);
            return { success: false, error: err.message };
        }
    }

    /**
     * Clear badge count for a device
     */
    async clearBadge(device) {
        if (!this.enabled || !device.fcmToken) {
            return { success: false };
        }

        const message = {
            token: device.fcmToken,
            apns: {
                payload: {
                    aps: {
                        badge: 0
                    }
                }
            }
        };

        try {
            await this.admin.messaging().send(message);
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    /**
     * Check if FCM is enabled and ready
     */
    isEnabled() {
        return this.enabled;
    }

    /**
     * Get service status
     */
    getStatus() {
        return {
            initialized: this.initialized,
            enabled: this.enabled
        };
    }
}

export { FCMService };
