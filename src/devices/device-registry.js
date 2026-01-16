/**
 * Device Registry
 * Manages mobile device pairing, authentication, and session subscriptions
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Generate a random 6-digit pairing code
function generatePairingCode() {
    return crypto.randomInt(100000, 999999).toString();
}

// Generate a unique device ID
function generateDeviceId() {
    return crypto.randomBytes(16).toString('hex');
}

// Generate a secure API token
function generateApiToken() {
    return crypto.randomBytes(32).toString('hex');
}

class DeviceRegistry {
    constructor(options = {}) {
        this.devices = new Map(); // deviceId -> Device
        this.pendingPairings = new Map(); // pairingCode -> PendingPairing
        this.tokenToDevice = new Map(); // apiToken -> deviceId
        this.pairingCodeExpiry = options.pairingCodeExpiry || 5 * 60 * 1000; // 5 minutes
        this.persistPath = options.persistPath || null;

        // Load persisted devices if path provided
        if (this.persistPath) {
            this.loadFromDisk();
        }

        // Clean up expired pairing codes periodically
        this.cleanupInterval = setInterval(() => this.cleanupExpiredPairings(), 60000);
    }

    /**
     * Initiate a pairing process
     * @returns {Object} { pairingCode, expiresAt, qrData }
     */
    initiatePairing(serverUrl) {
        const pairingCode = generatePairingCode();
        const expiresAt = new Date(Date.now() + this.pairingCodeExpiry);

        this.pendingPairings.set(pairingCode, {
            pairingCode,
            createdAt: new Date(),
            expiresAt
        });

        // QR code data includes server URL and pairing code
        const qrData = JSON.stringify({
            serverUrl,
            pairingCode,
            expiresAt: expiresAt.toISOString()
        });

        return {
            pairingCode,
            expiresAt,
            qrData
        };
    }

    /**
     * Complete device pairing
     * @param {string} pairingCode - 6-digit code
     * @param {Object} deviceInfo - Device information from mobile app
     * @returns {Object} { success, device, apiToken, error }
     */
    completePairing(pairingCode, deviceInfo) {
        const pending = this.pendingPairings.get(pairingCode);

        if (!pending) {
            return { success: false, error: 'Invalid pairing code' };
        }

        if (new Date() > pending.expiresAt) {
            this.pendingPairings.delete(pairingCode);
            return { success: false, error: 'Pairing code expired' };
        }

        // Create new device
        const deviceId = deviceInfo.deviceId || generateDeviceId();
        const apiToken = generateApiToken();

        const device = {
            deviceId,
            name: deviceInfo.name || 'Unknown Device',
            platform: deviceInfo.platform || 'ios',
            fcmToken: deviceInfo.fcmToken || null,
            apiToken,
            pairedAt: new Date(),
            lastSeen: new Date(),
            subscribedSessions: new Set()
        };

        this.devices.set(deviceId, device);
        this.tokenToDevice.set(apiToken, deviceId);
        this.pendingPairings.delete(pairingCode);

        this.persist();

        return {
            success: true,
            device: this.sanitizeDevice(device),
            apiToken
        };
    }

    /**
     * Get device by ID
     */
    getDevice(deviceId) {
        return this.devices.get(deviceId);
    }

    /**
     * Get device by API token
     */
    getDeviceByToken(apiToken) {
        const deviceId = this.tokenToDevice.get(apiToken);
        return deviceId ? this.devices.get(deviceId) : null;
    }

    /**
     * Update device FCM token
     */
    updateFcmToken(deviceId, fcmToken) {
        const device = this.devices.get(deviceId);
        if (!device) {
            return { success: false, error: 'Device not found' };
        }

        device.fcmToken = fcmToken;
        device.lastSeen = new Date();
        this.persist();

        return { success: true };
    }

    /**
     * Update device last seen timestamp
     */
    updateLastSeen(deviceId) {
        const device = this.devices.get(deviceId);
        if (device) {
            device.lastSeen = new Date();
        }
    }

    /**
     * Subscribe device to session notifications
     */
    subscribeToSession(deviceId, sessionId) {
        const device = this.devices.get(deviceId);
        if (!device) {
            return { success: false, error: 'Device not found' };
        }

        device.subscribedSessions.add(sessionId);
        device.lastSeen = new Date();
        this.persist();

        return { success: true };
    }

    /**
     * Unsubscribe device from session notifications
     */
    unsubscribeFromSession(deviceId, sessionId) {
        const device = this.devices.get(deviceId);
        if (!device) {
            return { success: false, error: 'Device not found' };
        }

        device.subscribedSessions.delete(sessionId);
        device.lastSeen = new Date();
        this.persist();

        return { success: true };
    }

    /**
     * Get all devices subscribed to a session
     */
    getDevicesForSession(sessionId) {
        const devices = [];
        for (const device of this.devices.values()) {
            if (device.subscribedSessions.has(sessionId) && device.fcmToken) {
                devices.push(device);
            }
        }
        return devices;
    }

    /**
     * Unpair/remove a device
     */
    removeDevice(deviceId) {
        const device = this.devices.get(deviceId);
        if (!device) {
            return { success: false, error: 'Device not found' };
        }

        this.tokenToDevice.delete(device.apiToken);
        this.devices.delete(deviceId);
        this.persist();

        return { success: true };
    }

    /**
     * List all paired devices
     */
    listDevices() {
        return Array.from(this.devices.values()).map(d => this.sanitizeDevice(d));
    }

    /**
     * Clean up expired pairing codes
     */
    cleanupExpiredPairings() {
        const now = new Date();
        for (const [code, pending] of this.pendingPairings) {
            if (now > pending.expiresAt) {
                this.pendingPairings.delete(code);
            }
        }
    }

    /**
     * Sanitize device object for external use (remove sensitive fields)
     */
    sanitizeDevice(device) {
        return {
            deviceId: device.deviceId,
            name: device.name,
            platform: device.platform,
            pairedAt: device.pairedAt,
            lastSeen: device.lastSeen,
            subscribedSessions: Array.from(device.subscribedSessions)
        };
    }

    /**
     * Persist devices to disk
     */
    persist() {
        if (!this.persistPath) return;

        const data = {
            devices: Array.from(this.devices.entries()).map(([id, device]) => ({
                ...device,
                subscribedSessions: Array.from(device.subscribedSessions)
            })),
            tokens: Array.from(this.tokenToDevice.entries())
        };

        try {
            const dir = path.dirname(this.persistPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error('[DeviceRegistry] Failed to persist:', err.message);
        }
    }

    /**
     * Load devices from disk
     */
    loadFromDisk() {
        if (!this.persistPath || !fs.existsSync(this.persistPath)) return;

        try {
            const data = JSON.parse(fs.readFileSync(this.persistPath, 'utf8'));

            for (const device of data.devices || []) {
                device.pairedAt = new Date(device.pairedAt);
                device.lastSeen = new Date(device.lastSeen);
                device.subscribedSessions = new Set(device.subscribedSessions);
                this.devices.set(device.deviceId, device);
            }

            for (const [token, deviceId] of data.tokens || []) {
                this.tokenToDevice.set(token, deviceId);
            }

            console.log(`[DeviceRegistry] Loaded ${this.devices.size} devices from disk`);
        } catch (err) {
            console.error('[DeviceRegistry] Failed to load from disk:', err.message);
        }
    }

    /**
     * Clean up on shutdown
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.persist();
    }
}

export { DeviceRegistry, generatePairingCode, generateDeviceId, generateApiToken };
