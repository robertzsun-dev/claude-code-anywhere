# Claude Code Remote Access

Remote access system for Claude Code sessions. Connect to any running Claude Code session from anywhere on your network (or the internet with proper setup).

## Architecture

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  Claude Code    │◄───────►│ Session Server  │◄───────►│ Remote Client   │
│  (via Wrapper)  │  stdio  │   (WebSocket)   │ network │  (View/Control) │
│                 │         │                 │         │                 │
│  - Runs claude  │         │ - Manages I/O   │         │ - Terminal UI   │
│  - Captures I/O │         │ - Multiplexes   │         │ - Send input    │
│  - Streams data │         │ - Routes msgs   │         │ - Live updates  │
└─────────────────┘         └─────────────────┘         └─────────────────┘
```

## Features

- **Web-Based Client**: No installation needed - just open your browser!
- **Seamless Integration**: Install once, use `claude` normally - automatic remote access!
- **Remote Session Access**: Connect to Claude Code sessions from any device
- **Real-time Streaming**: See Claude Code output in real-time (10,000 line buffer)
- **Bidirectional Control**: Send input to remote sessions
- **Multiple Viewers**: Multiple clients can watch the same session
- **Session Management**: List and attach to active sessions
- **Dual Client Options**: Web browser OR terminal client
- **IDE Compatible**: Works with VSCode, JetBrains, and all IDE integrations
- **Cross-platform**: Works on Linux, macOS, and Windows

## Installation

```bash
npm install
```

## Quick Start

There are two ways to use this system:

### Option A: Seamless Mode (Recommended)

Install once, then use `claude` normally - it automatically connects to the server!

```bash
# 1. Install the seamless wrapper
cd shim
./install.sh

# 2. Start the server (in another terminal or background)
npm run server

# 3. Use claude normally!
claude
# → Automatically wrapped! Session appears in server.

# 4. Connect remotely
npm run client
```

**Benefits:**
- No workflow changes needed
- Works with IDE integrations
- Transparent - only shows Claude Code output
- Auto-detects if server is running

See [`shim/README.md`](shim/README.md) for full documentation.

### Option B: Manual Mode

Explicitly use the wrapper for each session:

```bash
# 1. Start the Server
npm run server

# 2. Start a Claude Code Session
npm run wrapper
```

The server will start on `ws://0.0.0.0:8765` by default.

This will:
- Connect to the server
- Launch Claude Code in a pseudo-terminal
- Display a session ID
- Stream all I/O to the server

Example output:
```
[Wrapper] Session created: a1b2c3d4e5f6g7h8
[Wrapper] To connect remotely: node client.js a1b2c3d4e5f6g7h8
[Wrapper] Server URL: ws://localhost:8765
```

### 3. Connect Remotely

**Option A: Web Browser (Easiest - No Installation Required!)**

Just open your browser and visit:
```
http://localhost:8765
```

Or from another machine:
```
http://192.168.1.100:8765
```

The web interface will show all active sessions - just click one to view!

**Option B: Terminal Client (Advanced)**

From anywhere on your network:

```bash
# List available sessions
npm run client

# Or connect to a specific session
node client.js a1b2c3d4e5f6g7h8
```

From a different machine:

```bash
# Set the server URL
export CLAUDE_REMOTE_SERVER=ws://192.168.1.100:8765

# Connect
node client.js a1b2c3d4e5f6g7h8
```

## Usage

### Server

```bash
# Start on default port (8765)
npm run server

# Custom host/port
HOST=0.0.0.0 PORT=9000 npm run server
```

**Environment Variables:**
- `HOST` - Bind address (default: `0.0.0.0`)
- `PORT` - Port number (default: `8765`)

**HTTP Endpoints:**
- `GET /health` - Server health check
- `GET /sessions` - List active sessions (JSON)

### Wrapper

```bash
# Start Claude Code with default settings
npm run wrapper

# Pass arguments to Claude Code
node wrapper.js --help
node wrapper.js chat

# Connect to a different server
CLAUDE_REMOTE_SERVER=ws://192.168.1.100:8765 npm run wrapper

# Use a different Claude Code command
CLAUDE_CMD=/usr/local/bin/claude npm run wrapper
```

**Environment Variables:**
- `CLAUDE_REMOTE_SERVER` - Server WebSocket URL (default: `ws://localhost:8765`)
- `CLAUDE_CMD` - Claude Code command (default: `claude`)

### Client

```bash
# List available sessions
npm run client

# Connect to a session
node client.js <session-id>

# Connect to a different server
node client.js <session-id> --server ws://192.168.1.100:8765
```

**Keyboard Shortcuts (in client UI):**
- `Ctrl+I` - Send input to the session
- `Ctrl+L` - Clear terminal output
- `Ctrl+C` - Disconnect and quit
- `Mouse Scroll` - Scroll through output

## Network Setup

### Local Network (VPN)

If you're on a VPN or local network:

1. Start the server on a machine accessible to all clients
2. Note the server's IP address (e.g., `192.168.1.100`)
3. Set `CLAUDE_REMOTE_SERVER=ws://192.168.1.100:8765` on wrapper and client machines

### Internet Access (Cloud/Tunnel)

For internet access, you have several options:

#### Option 1: Reverse Proxy with nginx

```nginx
server {
    listen 443 ssl;
    server_name claude-remote.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:8765;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Then use: `CLAUDE_REMOTE_SERVER=wss://claude-remote.example.com`

#### Option 2: SSH Tunnel

On the client machine:

```bash
# Forward local port 8765 to remote server
ssh -L 8765:localhost:8765 user@remote-server

# Then connect normally
node client.js <session-id>
```

#### Option 3: ngrok/Cloudflare Tunnel

```bash
# Using ngrok
ngrok http 8765

# Then use the provided URL
CLAUDE_REMOTE_SERVER=wss://abc123.ngrok.io npm run wrapper
```

## Security Considerations

⚠️ **Important**: This is a basic implementation without authentication. For production use, you should:

1. **Add Authentication**: Implement token-based auth or OAuth
2. **Use TLS**: Always use `wss://` (WebSocket Secure) over the internet
3. **Firewall**: Restrict server access to known IPs
4. **VPN**: Use a VPN for secure network tunneling
5. **Session Encryption**: Encrypt session data end-to-end

## Advanced Usage

### Multiple Sessions

You can run multiple Claude Code sessions simultaneously:

```bash
# Terminal 1
npm run wrapper

# Terminal 2
npm run wrapper

# Terminal 3 - list sessions
npm run client
```

### Session Metadata

The wrapper sends metadata about each session:
- Working directory
- Hostname
- Username
- Platform
- Command and arguments

This helps identify sessions when listing them.

### Background Sessions

Run sessions in the background:

```bash
# Using nohup
nohup npm run wrapper > /dev/null 2>&1 &

# Using screen
screen -dmS claude-session npm run wrapper

# Using tmux
tmux new-session -d -s claude-session 'npm run wrapper'
```

## Troubleshooting

### "Cannot find module 'ws'"

Run `npm install` to install dependencies.

### "ECONNREFUSED" when connecting

Make sure the server is running and accessible. Check:
- Server is started (`npm run server`)
- Firewall allows port 8765
- Server URL is correct

### Terminal size issues

The wrapper automatically handles terminal resizing. If you have issues:
- The client sends resize events to the wrapper
- Make sure your terminal emulator supports SIGWINCH

### No output in client

If you connect to a session and see no output:
- The client shows history from when it was created
- Recent output is buffered (last 1000 lines)
- Try sending input to trigger output

## Development

### Project Structure

```
claude-code-remote-access/
├── server.js      - WebSocket server for session management
├── wrapper.js     - PTY wrapper for Claude Code
├── client.js      - Remote client with terminal UI
├── package.json   - Dependencies and scripts
└── README.md      - This file
```

### Dependencies

- `ws` - WebSocket server and client
- `node-pty` - Pseudo-terminal for spawning Claude Code
- `blessed` - Terminal UI framework
- `commander` - CLI argument parsing
- `chalk` - Terminal colors

## License

MIT

## Contributing

Contributions welcome! Feel free to:
- Add authentication
- Improve the UI
- Add session recording/playback
- Implement end-to-end encryption
- Add mobile client support

## Future Enhancements

- [ ] Authentication (JWT, OAuth)
- [ ] TLS/SSL support
- [ ] Session recording and playback
- [ ] Web-based client (browser UI)
- [ ] Mobile app support
- [ ] End-to-end encryption
- [ ] Session sharing with permissions
- [ ] Multi-server federation
- [ ] Session persistence across restarts
- [ ] Bandwidth optimization
