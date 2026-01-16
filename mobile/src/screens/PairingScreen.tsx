import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';

import { api } from '../services/api';
import { saveConnection } from '../services/storage';
import { registerForPushNotifications } from '../services/notifications';
import { ServerConnection } from '../types';

interface Props {
  onPaired: (connection: ServerConnection) => void;
}

export function PairingScreen({ onPaired }: Props) {
  const [serverUrl, setServerUrl] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  async function handlePair() {
    if (!serverUrl || pairingCode.length !== 6) {
      Alert.alert('Error', 'Please enter server URL and 6-digit pairing code');
      return;
    }

    setIsLoading(true);

    try {
      // Get push token first
      const pushToken = await registerForPushNotifications();

      // Complete pairing
      const deviceName = Device.deviceName || 'Android Device';
      const response = await api.completePairing(
        serverUrl,
        pairingCode,
        deviceName,
        pushToken || undefined
      );

      if (response.success && response.apiToken && response.device) {
        const connection: ServerConnection = {
          serverUrl,
          apiToken: response.apiToken,
          deviceId: response.device.deviceId,
          deviceName: response.device.name,
          pairedAt: response.device.pairedAt,
        };

        await saveConnection(connection);
        onPaired(connection);
      } else {
        Alert.alert('Pairing Failed', response.error || 'Unknown error');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to connect to server');
    }

    setIsLoading(false);
  }

  async function openScanner() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Permission Denied', 'Camera permission is required to scan QR codes');
        return;
      }
    }
    setShowScanner(true);
  }

  function handleBarCodeScanned({ data }: { data: string }) {
    setShowScanner(false);
    try {
      const qrData = JSON.parse(data);
      if (qrData.serverUrl && qrData.pairingCode) {
        setServerUrl(qrData.serverUrl);
        setPairingCode(qrData.pairingCode);
      }
    } catch {
      Alert.alert('Invalid QR Code', 'Please scan a valid Claude Remote QR code');
    }
  }

  if (showScanner) {
    return (
      <View style={styles.scannerContainer}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          barcodeScannerSettings={{
            barcodeTypes: ['qr'],
          }}
          onBarcodeScanned={handleBarCodeScanned}
        />
        <View style={styles.scannerOverlay}>
          <View style={styles.scannerFrame} />
          <Text style={styles.scannerText}>Point at QR code</Text>
        </View>
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => setShowScanner(false)}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.icon}>📱</Text>
          <Text style={styles.title}>Connect to Server</Text>
          <Text style={styles.subtitle}>
            Pair with your Claude Code Remote server to receive notifications
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Server URL</Text>
          <TextInput
            style={styles.input}
            placeholder="ws://192.168.1.100:8085"
            placeholderTextColor="#666"
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <Text style={styles.label}>Pairing Code</Text>
          <TextInput
            style={styles.input}
            placeholder="123456"
            placeholderTextColor="#666"
            value={pairingCode}
            onChangeText={setPairingCode}
            keyboardType="number-pad"
            maxLength={6}
          />

          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handlePair}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Connect</Text>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.button, styles.secondaryButton]}
            onPress={openScanner}
          >
            <Text style={styles.secondaryButtonText}>📷 Scan QR Code</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Get the pairing code from:</Text>
          <Text style={styles.footerUrl}>http://your-server:8085/pair</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  scrollContent: {
    flexGrow: 1,
    padding: 20,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  icon: {
    fontSize: 60,
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#888',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  form: {
    marginBottom: 40,
  },
  label: {
    fontSize: 14,
    color: '#888',
    marginBottom: 8,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    padding: 15,
    fontSize: 16,
    color: '#fff',
    marginBottom: 20,
  },
  button: {
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: '#4CAF50',
  },
  secondaryButton: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  secondaryButtonText: {
    color: '#fff',
    fontSize: 16,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  dividerText: {
    color: '#888',
    paddingHorizontal: 10,
  },
  footer: {
    alignItems: 'center',
  },
  footerText: {
    color: '#888',
    fontSize: 14,
  },
  footerUrl: {
    color: '#64b5f6',
    fontSize: 14,
    marginTop: 5,
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 10,
  },
  scannerText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 20,
  },
  cancelButton: {
    position: 'absolute',
    top: 50,
    left: 20,
    padding: 10,
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
  },
});
