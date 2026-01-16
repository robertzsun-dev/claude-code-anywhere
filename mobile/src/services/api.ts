import {
  Session,
  HistoryItem,
  PairingResponse,
  QuickAction,
  ServerConnection
} from '../types';
import { loadConnection } from './storage';

class APIService {
  private baseURL: string | null = null;
  private apiToken: string | null = null;

  async init() {
    const connection = await loadConnection();
    if (connection) {
      this.configure(connection.serverUrl, connection.apiToken);
    }
  }

  configure(serverUrl: string, apiToken: string) {
    // Use URL as-is, just ensure no trailing slash
    this.baseURL = serverUrl.replace(/\/$/, '');
    this.apiToken = apiToken;
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (this.apiToken) {
      headers['Authorization'] = `Bearer ${this.apiToken}`;
    }
    return headers;
  }

  // Pairing
  async completePairing(
    serverUrl: string,
    pairingCode: string,
    deviceName: string,
    pushToken?: string
  ): Promise<PairingResponse> {
    // Use URL as-is, just ensure no trailing slash
    const baseUrl = serverUrl.replace(/\/$/, '');

    const response = await fetch(`${baseUrl}/api/pair/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingCode,
        deviceId: generateDeviceId(),
        name: deviceName,
        platform: 'android',
        fcmToken: pushToken,
      }),
    });

    return response.json();
  }

  // Sessions
  async fetchSessions(): Promise<Session[]> {
    if (!this.baseURL) throw new Error('API not configured');

    const response = await fetch(`${this.baseURL}/api/sessions`, {
      headers: this.getHeaders(),
    });

    const data = await response.json();
    return data.sessions;
  }

  async fetchSession(id: string): Promise<Session> {
    if (!this.baseURL) throw new Error('API not configured');

    const response = await fetch(`${this.baseURL}/api/sessions/${id}`, {
      headers: this.getHeaders(),
    });

    const data = await response.json();
    return data.session;
  }

  async fetchHistory(sessionId: string, limit = 100): Promise<HistoryItem[]> {
    if (!this.baseURL) throw new Error('API not configured');

    const response = await fetch(
      `${this.baseURL}/api/sessions/${sessionId}/history?format=parsed&limit=${limit}`,
      { headers: this.getHeaders() }
    );

    const data = await response.json();
    return data.history;
  }

  // Subscriptions
  async subscribeToSession(sessionId: string): Promise<void> {
    if (!this.baseURL) throw new Error('API not configured');

    await fetch(`${this.baseURL}/api/subscribe/${sessionId}`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
  }

  async unsubscribeFromSession(sessionId: string): Promise<void> {
    if (!this.baseURL) throw new Error('API not configured');

    await fetch(`${this.baseURL}/api/subscribe/${sessionId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
  }

  // Input
  async sendInput(sessionId: string, input: string): Promise<void> {
    if (!this.baseURL) throw new Error('API not configured');

    await fetch(`${this.baseURL}/api/sessions/${sessionId}/input`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ input }),
    });
  }

  async sendQuickResponse(
    sessionId: string,
    action: QuickAction,
    customText?: string
  ): Promise<void> {
    if (!this.baseURL) throw new Error('API not configured');

    await fetch(`${this.baseURL}/api/sessions/${sessionId}/quick-response`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ action, customText }),
    });
  }

  // FCM Token
  async updatePushToken(token: string): Promise<void> {
    if (!this.baseURL) throw new Error('API not configured');

    await fetch(`${this.baseURL}/api/devices/fcm-token`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({ fcmToken: token }),
    });
  }

  // Disconnect
  async disconnect(): Promise<void> {
    if (!this.baseURL) return;

    await fetch(`${this.baseURL}/api/devices`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
  }
}

function generateDeviceId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const api = new APIService();
