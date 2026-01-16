import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';

import { api } from '../services/api';
import { websocket } from '../services/websocket';
import { stripAnsi, formatTime } from '../services/utils';
import { HistoryItem, WebSocketMessage, QuickAction, Session } from '../types';
import { RootStackParamList } from '../../App';

type RouteProps = RouteProp<RootStackParamList, 'SessionDetail'>;

interface Message {
  id: string;
  type: 'output' | 'input';
  content: string;
  timestamp: string;
}

export function SessionDetailScreen() {
  const route = useRoute<RouteProps>();
  const { session, serverUrl } = route.params;

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [rawOutput, setRawOutput] = useState('');
  const [isWaiting, setIsWaiting] = useState(session.waitingState?.isWaiting ?? false);
  const [waitingReason, setWaitingReason] = useState(session.waitingState?.reason);

  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    loadHistory();
    connectWebSocket();

    return () => {
      websocket.disconnect();
    };
  }, []);

  async function loadHistory() {
    try {
      const history = await api.fetchHistory(session.id);
      const parsed = parseHistory(history);
      setMessages(parsed);
      setRawOutput(history.map((h) => stripAnsi(h.data)).join(''));
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }

  function connectWebSocket() {
    websocket.connect(serverUrl, session.id);

    websocket.onMessage((msg: WebSocketMessage) => {
      switch (msg.type) {
        case 'output':
          if (msg.data) {
            const clean = stripAnsi(msg.data);
            setRawOutput((prev) => prev + clean);
            addMessage('output', clean);
          }
          break;

        case 'input-echo':
          if (msg.data) {
            addMessage('input', msg.data);
          }
          break;

        case 'waiting-for-input':
          setIsWaiting(true);
          setWaitingReason(msg.reason);
          break;

        case 'waiting-cleared':
          setIsWaiting(false);
          setWaitingReason(undefined);
          break;

        case 'session-attached':
          if (msg.history) {
            const parsed = parseHistory(msg.history);
            setMessages(parsed);
            setRawOutput(msg.history.map((h) => stripAnsi(h.data)).join(''));
          }
          break;
      }
    });
  }

  function parseHistory(history: HistoryItem[]): Message[] {
    return history
      .filter((h) => h.data.trim())
      .map((h, i) => ({
        id: `${i}-${h.timestamp}`,
        type: h.type === 'input' || h.type === 'input-echo' ? 'input' : 'output',
        content: stripAnsi(h.data),
        timestamp: h.timestamp,
      }));
  }

  function addMessage(type: 'output' | 'input', content: string) {
    const newMessage: Message = {
      id: `${Date.now()}-${Math.random()}`,
      type,
      content,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, newMessage]);
  }

  async function sendInput(text: string) {
    if (!text.trim()) return;

    try {
      await api.sendInput(session.id, text + '\n');
      setInputText('');
    } catch (err) {
      Alert.alert('Error', 'Failed to send input');
    }
  }

  async function sendQuickAction(action: QuickAction) {
    try {
      await api.sendQuickResponse(session.id, action);
    } catch (err) {
      Alert.alert('Error', 'Failed to send response');
    }
  }

  function scrollToEnd() {
    flatListRef.current?.scrollToEnd({ animated: true });
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {/* View Toggle */}
      <View style={styles.toggleContainer}>
        <TouchableOpacity
          style={[styles.toggleButton, !showRaw && styles.toggleButtonActive]}
          onPress={() => setShowRaw(false)}
        >
          <Text style={[styles.toggleText, !showRaw && styles.toggleTextActive]}>
            Conversation
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, showRaw && styles.toggleButtonActive]}
          onPress={() => setShowRaw(true)}
        >
          <Text style={[styles.toggleText, showRaw && styles.toggleTextActive]}>
            Raw
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {showRaw ? (
        <FlatList
          style={styles.rawContainer}
          data={[rawOutput]}
          renderItem={({ item }) => (
            <Text style={styles.rawText}>{item}</Text>
          )}
          keyExtractor={() => 'raw'}
          onContentSizeChange={scrollToEnd}
        />
      ) : (
        <FlatList
          ref={flatListRef}
          style={styles.messageList}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View
              style={[
                styles.messageBubble,
                item.type === 'input' && styles.inputBubble,
              ]}
            >
              <Text style={styles.messageAuthor}>
                {item.type === 'input' ? 'You' : '✨ Claude'}
              </Text>
              <Text style={styles.messageContent}>{item.content}</Text>
              <Text style={styles.messageTime}>
                {formatTime(item.timestamp)}
              </Text>
            </View>
          )}
          onContentSizeChange={scrollToEnd}
          contentContainerStyle={styles.messageListContent}
        />
      )}

      {/* Quick Actions */}
      {isWaiting && (
        <View style={styles.quickActions}>
          {waitingReason && (
            <Text style={styles.waitingReason}>❗ {waitingReason}</Text>
          )}
          <View style={styles.quickButtonsRow}>
            <TouchableOpacity
              style={[styles.quickButton, styles.yesButton]}
              onPress={() => sendQuickAction('yes')}
            >
              <Text style={styles.quickButtonText}>Yes</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.quickButton, styles.noButton]}
              onPress={() => sendQuickAction('no')}
            >
              <Text style={styles.quickButtonText}>No</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.quickButton, styles.continueButton]}
              onPress={() => sendQuickAction('continue')}
            >
              <Text style={styles.quickButtonText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Input Bar */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.textInput}
          placeholder="Type response..."
          placeholderTextColor="#666"
          value={inputText}
          onChangeText={setInputText}
          onSubmitEditing={() => sendInput(inputText)}
          returnKeyType="send"
        />
        <TouchableOpacity
          style={[styles.sendButton, !inputText && styles.sendButtonDisabled]}
          onPress={() => sendInput(inputText)}
          disabled={!inputText}
        >
          <Text style={styles.sendButtonText}>➤</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  toggleContainer: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  toggleButtonActive: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  toggleText: {
    color: '#888',
    fontSize: 14,
  },
  toggleTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    padding: 10,
  },
  messageBubble: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: 12,
    marginVertical: 4,
    maxWidth: '85%',
  },
  inputBubble: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(76, 175, 80, 0.3)',
  },
  messageAuthor: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  messageContent: {
    fontSize: 15,
    color: '#fff',
    lineHeight: 20,
  },
  messageTime: {
    fontSize: 10,
    color: '#666',
    marginTop: 4,
    textAlign: 'right',
  },
  rawContainer: {
    flex: 1,
    backgroundColor: '#000',
    padding: 10,
  },
  rawText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    color: '#0f0',
    lineHeight: 16,
  },
  quickActions: {
    backgroundColor: 'rgba(255, 152, 0, 0.1)',
    padding: 10,
  },
  waitingReason: {
    color: '#ff9800',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 10,
  },
  quickButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  quickButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    marginHorizontal: 5,
  },
  yesButton: {
    backgroundColor: 'rgba(76, 175, 80, 0.3)',
  },
  noButton: {
    backgroundColor: 'rgba(244, 67, 54, 0.3)',
  },
  continueButton: {
    backgroundColor: 'rgba(33, 150, 243, 0.3)',
  },
  quickButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  inputBar: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
  },
  textInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    fontSize: 16,
    color: '#fff',
  },
  sendButton: {
    marginLeft: 10,
    backgroundColor: '#4CAF50',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#333',
  },
  sendButtonText: {
    fontSize: 20,
    color: '#fff',
  },
});
