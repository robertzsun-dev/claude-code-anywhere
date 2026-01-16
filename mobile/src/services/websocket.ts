import { WebSocketMessage } from '../types';

type MessageHandler = (message: WebSocketMessage) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private serverUrl: string | null = null;
  private sessionId: string | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnected = false;

  connect(serverUrl: string, sessionId?: string) {
    this.disconnect();

    this.serverUrl = serverUrl;
    this.sessionId = sessionId || null;

    let url = serverUrl;
    if (sessionId) {
      url += `?role=viewer&session=${sessionId}`;
    } else {
      url += '?role=viewer';
    }

    console.log('[WebSocket] Connecting to:', url);

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('[WebSocket] Connected');
      this.isConnected = true;
    };

    this.ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        this.messageHandlers.forEach((handler) => handler(message));
      } catch (err) {
        console.error('[WebSocket] Parse error:', err);
      }
    };

    this.ws.onclose = () => {
      console.log('[WebSocket] Disconnected');
      this.isConnected = false;
      this.scheduleReconnect();
    };

    this.ws.onerror = (error) => {
      console.error('[WebSocket] Error:', error);
    };
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
  }

  send(message: WebSocketMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  sendInput(data: string) {
    this.send({ type: 'input', data });
  }

  sendResize(cols: number, rows: number) {
    this.send({ type: 'resize', cols, rows });
  }

  onMessage(handler: MessageHandler) {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimeout) return;

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.serverUrl) {
        this.connect(this.serverUrl, this.sessionId || undefined);
      }
    }, 5000);
  }

  getIsConnected() {
    return this.isConnected;
  }
}

export const websocket = new WebSocketService();
