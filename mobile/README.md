# Claude Remote Mobile App (Expo)

Cross-platform mobile app for receiving push notifications when Claude Code needs user input.

## Quick Start

### 1. Install dependencies

```bash
cd mobile
npm install
```

### 2. Install Expo Go on your phone

- **Android**: [Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent)
- **iOS**: [App Store](https://apps.apple.com/app/expo-go/id982107779)

### 3. Start the development server

```bash
npm start
```

### 4. Scan the QR code

Open Expo Go on your phone and scan the QR code shown in the terminal.

## Features

- **QR Code Pairing**: Scan to connect to your server instantly
- **Push Notifications**: Get notified when Claude needs input
- **Quick Responses**: Tap Yes/No/Continue without typing
- **Conversation View**: Chat-bubble style message display
- **Raw Terminal**: Toggle to see full terminal output
- **Secure Storage**: Credentials stored securely on device

## Project Structure

```
mobile/
├── App.tsx                 # Main app entry
├── app.json               # Expo configuration
├── package.json           # Dependencies
├── src/
│   ├── screens/           # App screens
│   │   ├── PairingScreen.tsx
│   │   ├── SessionListScreen.tsx
│   │   ├── SessionDetailScreen.tsx
│   │   └── SettingsScreen.tsx
│   ├── services/          # API, WebSocket, Storage
│   │   ├── api.ts
│   │   ├── websocket.ts
│   │   ├── storage.ts
│   │   ├── notifications.ts
│   │   └── utils.ts
│   └── types/             # TypeScript types
│       └── index.ts
└── assets/                # Icons and images
```

## Server Setup

Make sure your Claude Remote server is running:

```bash
# In the project root
npm run server
```

Then visit `http://your-server:8085/pair` to get the pairing QR code.

## Building for Production

### Android APK

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Build APK (no Google Play account needed)
eas build --platform android --profile preview
```

### iOS (requires Apple Developer account)

```bash
eas build --platform ios
```

## Push Notifications

For development, the app uses Expo's push notification service. In production:

### Android

1. Create a Firebase project
2. Add your `google-services.json` to the project
3. Update `app.json` with your Firebase config

### iOS

1. Create an Apple Developer account
2. Generate push notification certificates
3. Configure in Expo dashboard

## Troubleshooting

### "Network request failed" when pairing

- Ensure your phone and server are on the same network
- Check if the server URL is correct (use your computer's IP, not localhost)
- Try disabling VPN if enabled

### QR scanner not working

- Grant camera permissions when prompted
- Ensure good lighting
- Try manual code entry instead

### Push notifications not arriving

- For Expo Go, notifications work automatically
- For production builds, configure Firebase/APNs

## Development

### Run with hot reload

```bash
npm start
```

### Run on specific platform

```bash
npm run android
npm run ios
```

### Type checking

```bash
npx tsc --noEmit
```

## License

MIT License
