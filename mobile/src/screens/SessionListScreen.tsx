import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { api } from '../services/api';
import { formatRelativeTime, getSessionDisplayName } from '../services/utils';
import { Session } from '../types';
import { RootStackParamList } from '../../App';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'SessionList'>;

interface Props {
  serverUrl: string;
}

export function SessionListScreen({ serverUrl }: Props) {
  const navigation = useNavigation<NavigationProp>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    loadSessions();

    // Auto-refresh every 5 seconds
    const interval = setInterval(loadSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => navigation.navigate('Settings')}
          style={{ marginRight: 10 }}
        >
          <Text style={{ fontSize: 24 }}>⚙️</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  async function loadSessions() {
    try {
      const data = await api.fetchSessions();
      setSessions(data);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
    setIsLoading(false);
    setIsRefreshing(false);
  }

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    loadSessions();
  }, []);

  function openSession(session: Session) {
    navigation.navigate('SessionDetail', { session, serverUrl });
  }

  const waitingSessions = sessions.filter((s) => s.waitingState?.isWaiting);
  const otherSessions = sessions.filter((s) => !s.waitingState?.isWaiting);

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
      </View>
    );
  }

  if (sessions.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.emptyIcon}>💻</Text>
        <Text style={styles.emptyTitle}>No Active Sessions</Text>
        <Text style={styles.emptySubtitle}>
          Start a Claude Code session on your computer to see it here
        </Text>
        <TouchableOpacity style={styles.refreshButton} onPress={loadSessions}>
          <Text style={styles.refreshButtonText}>Refresh</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={[
        ...(waitingSessions.length > 0
          ? [{ type: 'header', title: 'Waiting for Input' }]
          : []),
        ...waitingSessions.map((s) => ({ type: 'session', session: s })),
        { type: 'header', title: 'All Sessions' },
        ...otherSessions.map((s) => ({ type: 'session', session: s })),
      ]}
      keyExtractor={(item, index) =>
        item.type === 'header' ? `header-${index}` : (item as any).session.id
      }
      renderItem={({ item }) => {
        if (item.type === 'header') {
          return <Text style={styles.sectionHeader}>{item.title}</Text>;
        }
        const session = (item as any).session as Session;
        return (
          <SessionRow session={session} onPress={() => openSession(session)} />
        );
      }}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          tintColor="#4CAF50"
        />
      }
    />
  );
}

function SessionRow({
  session,
  onPress,
}: {
  session: Session;
  onPress: () => void;
}) {
  const isWaiting = session.waitingState?.isWaiting;

  return (
    <TouchableOpacity style={styles.sessionRow} onPress={onPress}>
      <View style={[styles.statusDot, isWaiting && styles.statusDotWaiting]} />
      <View style={styles.sessionInfo}>
        <View style={styles.sessionHeader}>
          <Text style={styles.sessionName} numberOfLines={1}>
            {getSessionDisplayName(session.metadata, session.id)}
          </Text>
          {isWaiting && <Text style={styles.waitingBadge}>❗</Text>}
          {session.subscribed && <Text style={styles.subscribedBadge}>🔔</Text>}
        </View>
        <View style={styles.sessionMeta}>
          {session.metadata.hostname && (
            <Text style={styles.metaText}>🖥️ {session.metadata.hostname}</Text>
          )}
          <Text style={styles.metaText}>
            {formatRelativeTime(session.lastActivity)}
          </Text>
        </View>
        {isWaiting && session.waitingState?.reason && (
          <Text style={styles.waitingReason} numberOfLines={1}>
            {session.waitingState.reason}
          </Text>
        )}
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyIcon: {
    fontSize: 60,
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#888',
    textAlign: 'center',
    marginBottom: 30,
  },
  refreshButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 25,
  },
  refreshButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4CAF50',
    marginRight: 12,
  },
  statusDotWaiting: {
    backgroundColor: '#ff9800',
  },
  sessionInfo: {
    flex: 1,
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sessionName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    flex: 1,
  },
  waitingBadge: {
    fontSize: 14,
    marginLeft: 8,
  },
  subscribedBadge: {
    fontSize: 12,
    marginLeft: 4,
  },
  sessionMeta: {
    flexDirection: 'row',
    marginTop: 4,
  },
  metaText: {
    fontSize: 12,
    color: '#888',
    marginRight: 10,
  },
  waitingReason: {
    fontSize: 12,
    color: '#ff9800',
    marginTop: 4,
  },
  chevron: {
    fontSize: 24,
    color: '#888',
  },
});
