import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from './api';

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  let token: string | null = null;

  if (!Device.isDevice) {
    console.log('[Notifications] Must use physical device for push notifications');
    return null;
  }

  // Check existing permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Request permissions if not granted
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[Notifications] Permission not granted');
    return null;
  }

  // Get Expo push token
  // Note: Push notifications don't work in Expo Go (SDK 53+), only in dev builds
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync();
    token = tokenData.data;
    console.log('[Notifications] Push token:', token);
  } catch (err) {
    console.log('[Notifications] Could not get push token (expected in Expo Go):', err);
    return null;
  }

  // Android-specific channel setup
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('claude-input', {
      name: 'Claude Input Requests',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4CAF50',
    });
  }

  return token;
}

export function addNotificationResponseListener(
  handler: (sessionId: string) => void
) {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    if (data?.sessionId) {
      handler(data.sessionId as string);
    }
  });
}

export function addNotificationReceivedListener(
  handler: (notification: Notifications.Notification) => void
) {
  return Notifications.addNotificationReceivedListener(handler);
}

export async function updateServerPushToken(token: string) {
  try {
    await api.updatePushToken(token);
    console.log('[Notifications] Server updated with push token');
  } catch (err) {
    console.error('[Notifications] Failed to update server:', err);
  }
}

export async function clearBadge() {
  await Notifications.setBadgeCountAsync(0);
}
