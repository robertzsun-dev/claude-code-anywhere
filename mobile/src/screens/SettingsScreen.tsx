import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Linking,
  ScrollView,
} from 'react-native';

import { api } from '../services/api';
import { clearConnection } from '../services/storage';
import { ServerConnection } from '../types';

interface Props {
  connection: ServerConnection;
  onDisconnect: () => void;
}

export function SettingsScreen({ connection, onDisconnect }: Props) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  async function handleDisconnect() {
    Alert.alert(
      'Disconnect?',
      'You will no longer receive notifications from this server.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setIsDisconnecting(true);
            try {
              await api.disconnect();
            } catch (err) {
              // Ignore errors
            }
            await clearConnection();
            onDisconnect();
          },
        },
      ]
    );
  }

  function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }

  return (
    <ScrollView style={styles.container}>
      {/* Server Section */}
      <Text style={styles.sectionHeader}>Server</Text>
      <View style={styles.section}>
        <View style={styles.row}>
          <Text style={styles.statusIcon}>✓</Text>
          <View style={styles.rowContent}>
            <Text style={styles.rowTitle}>Connected</Text>
            <Text style={styles.rowSubtitle}>{connection.serverUrl}</Text>
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.icon}>📱</Text>
          <View style={styles.rowContent}>
            <Text style={styles.rowTitle}>{connection.deviceName}</Text>
            <Text style={styles.rowSubtitle}>
              Paired {formatDate(connection.pairedAt)}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.disconnectButton}
          onPress={handleDisconnect}
          disabled={isDisconnecting}
        >
          <Text style={styles.disconnectText}>
            {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* About Section */}
      <Text style={styles.sectionHeader}>About</Text>
      <View style={styles.section}>
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Version</Text>
          <Text style={styles.rowValue}>1.0.0</Text>
        </View>

        <TouchableOpacity
          style={styles.row}
          onPress={() =>
            Linking.openURL('https://github.com/anthropics/claude-code')
          }
        >
          <Text style={styles.icon}>🔗</Text>
          <Text style={styles.linkText}>Claude Code on GitHub</Text>
        </TouchableOpacity>
      </View>

      {/* Debug Info */}
      <Text style={styles.sectionHeader}>Debug</Text>
      <View style={styles.section}>
        <View style={styles.debugRow}>
          <Text style={styles.debugLabel}>Device ID</Text>
          <Text style={styles.debugValue}>{connection.deviceId}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  section: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10,
    marginHorizontal: 15,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  rowContent: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 16,
    color: '#fff',
  },
  rowSubtitle: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  rowValue: {
    fontSize: 16,
    color: '#888',
    marginLeft: 'auto',
  },
  statusIcon: {
    fontSize: 18,
    color: '#4CAF50',
    marginRight: 12,
  },
  icon: {
    fontSize: 18,
    marginRight: 12,
  },
  linkText: {
    fontSize: 16,
    color: '#64b5f6',
  },
  disconnectButton: {
    padding: 15,
    alignItems: 'center',
  },
  disconnectText: {
    fontSize: 16,
    color: '#f44336',
  },
  debugRow: {
    padding: 15,
  },
  debugLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  debugValue: {
    fontSize: 12,
    color: '#666',
    fontFamily: 'monospace',
  },
});
