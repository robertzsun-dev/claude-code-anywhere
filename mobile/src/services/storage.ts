import * as SecureStore from 'expo-secure-store';
import { ServerConnection } from '../types';

const CONNECTION_KEY = 'server_connection';

export async function saveConnection(connection: ServerConnection): Promise<void> {
  await SecureStore.setItemAsync(CONNECTION_KEY, JSON.stringify(connection));
}

export async function loadConnection(): Promise<ServerConnection | null> {
  const data = await SecureStore.getItemAsync(CONNECTION_KEY);
  if (!data) return null;
  return JSON.parse(data);
}

export async function clearConnection(): Promise<void> {
  await SecureStore.deleteItemAsync(CONNECTION_KEY);
}
