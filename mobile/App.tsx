import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { registerRootComponent } from 'expo';
import { ActivityIndicator, View } from 'react-native';

import { PairingScreen } from './src/screens/PairingScreen';
import { SessionListScreen } from './src/screens/SessionListScreen';
import { SessionDetailScreen } from './src/screens/SessionDetailScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

import { loadConnection } from './src/services/storage';
import { api } from './src/services/api';
import {
  registerForPushNotifications,
  addNotificationResponseListener,
  updateServerPushToken,
} from './src/services/notifications';
import { ServerConnection, Session } from './src/types';

export type RootStackParamList = {
  Pairing: undefined;
  SessionList: undefined;
  SessionDetail: { session: Session; serverUrl: string };
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [connection, setConnection] = useState<ServerConnection | null>(null);

  useEffect(() => {
    initApp();
  }, []);

  async function initApp() {
    // Load saved connection
    const savedConnection = await loadConnection();
    if (savedConnection) {
      setConnection(savedConnection);
      api.configure(savedConnection.serverUrl, savedConnection.apiToken);

      // Register for push notifications
      const pushToken = await registerForPushNotifications();
      if (pushToken) {
        updateServerPushToken(pushToken);
      }
    }
    setIsLoading(false);

    // Handle notification taps
    addNotificationResponseListener((sessionId) => {
      // Navigation will be handled by the screen
      console.log('[App] Notification tapped for session:', sessionId);
    });
  }

  function handlePaired(newConnection: ServerConnection) {
    setConnection(newConnection);
    api.configure(newConnection.serverUrl, newConnection.apiToken);
  }

  function handleDisconnected() {
    setConnection(null);
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a2e' }}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#1a1a2e' },
          headerTintColor: '#fff',
          contentStyle: { backgroundColor: '#1a1a2e' },
        }}
      >
        {connection ? (
          <>
            <Stack.Screen
              name="SessionList"
              options={{ title: 'Sessions' }}
            >
              {(props) => (
                <SessionListScreen
                  {...props}
                  serverUrl={connection.serverUrl}
                />
              )}
            </Stack.Screen>
            <Stack.Screen
              name="SessionDetail"
              component={SessionDetailScreen}
              options={{ title: 'Session' }}
            />
            <Stack.Screen
              name="Settings"
              options={{ title: 'Settings' }}
            >
              {(props) => (
                <SettingsScreen
                  {...props}
                  connection={connection}
                  onDisconnect={handleDisconnected}
                />
              )}
            </Stack.Screen>
          </>
        ) : (
          <Stack.Screen
            name="Pairing"
            options={{ headerShown: false }}
          >
            {(props) => (
              <PairingScreen {...props} onPaired={handlePaired} />
            )}
          </Stack.Screen>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

registerRootComponent(App);
