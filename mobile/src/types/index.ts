export interface Session {
  id: string;
  created: string;
  lastActivity: string;
  metadata: SessionMetadata;
  waitingState?: WaitingState;
  subscribed: boolean;
}

export interface SessionMetadata {
  cwd?: string;
  hostname?: string;
  user?: string;
  cols?: number;
  rows?: number;
  command?: string;
}

export interface WaitingState {
  sessionId: string;
  isWaiting: boolean;
  reason?: string;
  bufferLength?: number;
}

export interface HistoryItem {
  type: string;
  data: string;
  timestamp: string;
}

export interface ServerConnection {
  serverUrl: string;
  apiToken: string;
  deviceId: string;
  deviceName: string;
  pairedAt: string;
}

export interface PairingInfo {
  pairingCode: string;
  expiresAt: string;
  qrData: string;
}

export interface PairingResponse {
  success: boolean;
  device?: {
    deviceId: string;
    name: string;
    platform: string;
    pairedAt: string;
  };
  apiToken?: string;
  error?: string;
}

export interface WebSocketMessage {
  type: string;
  data?: string;
  sessionId?: string;
  metadata?: SessionMetadata;
  history?: HistoryItem[];
  reason?: string;
  quickActions?: string[];
  context?: string;
  cols?: number;
  rows?: number;
  code?: number;
  signal?: string;
  error?: string;
}

export type QuickAction = 'yes' | 'no' | 'continue' | 'cancel' | 'custom';
