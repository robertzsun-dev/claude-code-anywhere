# Claude Code Remote Access

> 🚀 **Access your Claude Code sessions from anywhere** - View and control Claude Code sessions remotely through WebSocket

Access and control your Claude Code CLI sessions from anywhere. Perfect for:
- **Remote development**: Access Claude on your workstation from your laptop
- **Pair programming**: Share your Claude session with teammates in real-time
- **Multi-device workflows**: Start on desktop, continue on laptop
- **Web access**: Use Claude through any web browser

## Features

✨ **Core Features**:
- 🌐 **Remote Access**: Connect to Claude sessions over network (LAN/VPN/Internet)
- 👥 **Multi-Viewer**: Multiple users can view and interact with the same session
- 📜 **Session History**: 10,000-line scrollback buffer for late joiners
- 🔄 **Auto-Reconnect**: Seamless reconnection if connection drops
- 🖥️ **Web Client**: Browser-based terminal (no installation needed)
- 📦 **Seamless Mode**: Zero-config interception of `claude` command

🛠️ **Technical Features**:
- WebSocket-based real-time communication
- PTY (pseudo-terminal) for full terminal emulation
- Blessed TUI for rich terminal client
- Systemd service support for auto-start
- Docker deployment ready

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- Claude Code installed (`npm install -g @anthropic-ai/claude-code`)

### Installation

```bash
git clone https://github.com/your-username/claude-code-anywhere.git
cd claude-code-anywhere
npm install
```

### Basic Usage (3 Steps)

**1. Start the server:**
```bash
npm run server
```

The server starts on `http://localhost:8085` by default.

**2. Start a Claude session (wrapper mode):**
```bash
npm run wrapper
# Now use Claude normally - output appears locally AND remotely
```

**3. Connect from another terminal/machine:**

Option A - **Terminal client**:
```bash
npm run client              # Lists active sessions
node src/client.js <session-id>   # Connect to specific session
```

Option B - **Web browser**:
```
http://localhost:8085
```

That's it! Your Claude session is now accessible remotely.

## Seamless Mode (Automatic Interception)

**Seamless mode** makes the wrapper completely transparent - just run `claude` normally and it automatically connects to the remote server when available.

### Installation

```bash
cd shim
sudo ./install.sh
```

The installer will:
1. Create wrapper in `/usr/local/bin/claude`
2. Dynamically find original `claude` at runtime
3. Create config file `~/.claude-remote.conf`
4. Optionally install systemd service

### How It Works

```bash
# Just use claude normally
claude

# Behind the scenes:
# 1. Shim checks if server is running (< 0.5s timeout)
# 2. If yes: Routes through wrapper → remote access enabled
# 3. If no: Runs original claude directly → normal operation
```

**Benefits**:
- ✅ No workflow changes
- ✅ Automatic fallback when server offline
- ✅ Works with IDE integrations unchanged
- ✅ Survives npm updates (no hardcoded paths)

### Configuration

Edit `~/.claude-remote.conf`:
```bash
# Server URL (change for remote access)
export CLAUDE_REMOTE_SERVER=ws://localhost:8085

# Auto-connect toggle
export CLAUDE_AUTO_CONNECT=true  # Set to false to disable

# Claude remote directory
export CLAUDE_REMOTE_DIR=/path/to/claude-code-anywhere
```

Then reload: `source ~/.bashrc` (or restart terminal)

### Uninstallation

```bash
cd shim
sudo ./uninstall.sh
```

## Web Client

The built-in web client provides browser-based access with no installation required.

### Features

- 📱 **Responsive UI**: Works on desktop, tablet, and mobile
- 🎨 **Full Terminal Emulation**: Colors, formatting, ANSI codes
- ⌨️ **Interactive**: Send input, scroll history
- 🔄 **Auto-Reconnect**: Handles connection drops gracefully
- 📊 **Session List**: Browse and connect to active sessions

### Usage

1. Start server: `npm run server`
2. Open browser: `http://localhost:8085`
3. Select a session from the list
4. Interact with Claude through the terminal

**Keyboard Shortcuts**:
- `Ctrl+I`: Open input dialog
- `Ctrl+L`: Clear terminal
- `Scroll/Mouse`: Navigate history

## Usage

### Server

Start the session server:

```bash
npm run server

# With custom port
PORT=9000 npm run server

# With custom host (bind to all interfaces)
HOST=0.0.0.0 npm run server
```

**Environment Variables**:
- `PORT` - Server port (default: `8085`)
- `HOST` - Bind address (default: `0.0.0.0`)

**HTTP Endpoints**:
- `GET /` - Web client
- `GET /health` - Server health check
- `GET /sessions` - List active sessions (JSON)

### Wrapper (Manual Mode)

Launch Claude through the wrapper:

```bash
npm run wrapper

# With custom server
CLAUDE_REMOTE_SERVER=ws://192.168.1.100:8085 npm run wrapper

# Pass arguments to Claude
npm run wrapper -- chat
npm run wrapper -- --help
```

**Environment Variables**:
- `CLAUDE_REMOTE_SERVER` - Server URL (default: `ws://localhost:8085`)
- `CLAUDE_CMD` - Claude binary path (default: `claude`)
- `CLAUDE_SEAMLESS_MODE` - Silent mode (default: `false`)

### Client (Terminal UI)

Connect to a session:

```bash
# List sessions
npm run client

# Connect to specific session
node src/client.js <session-id>

# Custom server
node src/client.js <session-id> --server ws://192.168.1.100:8085
```

**Keyboard Controls**:
- `Ctrl+I`: Send input
- `Ctrl+L`: Clear screen
- `Ctrl+C`: Disconnect
- `Mouse`: Scroll history

## Remote Access

### Local Network (LAN)

1. **Find your machine's IP:**
```bash
# Linux/Mac
ip addr show | grep "inet " | grep -v 127.0.0.1

# Or use hostname -I
hostname -I | awk '{print $1}'
```

2. **Start server:**
```bash
npm run server
```

3. **Connect from another machine:**
```bash
# Set server URL on client machine
export CLAUDE_REMOTE_SERVER=ws://192.168.1.100:8085

# Connect
node src/client.js <session-id>

# Or use web browser
http://192.168.1.100:8085
```

### VPN Access

If you're on a VPN (e.g., WireGuard, OpenVPN):

```bash
# Find VPN IP (usually 10.x.x.x)
ip addr show tun0

# Use VPN IP as server URL
export CLAUDE_REMOTE_SERVER=ws://10.8.0.1:8085
```

### Internet Access (Advanced)

**⚠️ Security Warning**: Only use with proper authentication/encryption in production.

**Option 1: SSH Tunnel (Recommended)**
```bash
# On local machine: Forward remote port to local
ssh -L 8085:localhost:8085 user@remote-server

# Now access via localhost
export CLAUDE_REMOTE_SERVER=ws://localhost:8085
```

**Option 2: ngrok (Quick testing)**
```bash
# On server machine
ngrok http 8085

# Use the ngrok URL (changes WebSocket to wss://)
export CLAUDE_REMOTE_SERVER=wss://abc123.ngrok.io
```

**Option 3: Reverse Proxy (Production)**

See `examples/nginx.conf` for nginx configuration with TLS and authentication.

## Project Structure

```
claude-code-anywhere/
├── src/
│   ├── server.js           # WebSocket session server
│   ├── wrapper.js          # PTY wrapper for Claude Code
│   └── client.js           # Terminal UI client
│
├── shim/                   # Seamless mode wrapper
│   ├── claude              # Shim script template
│   ├── install.sh          # Installer with systemd support
│   └── uninstall.sh        # Removal script
│
├── public/                 # Web client
│   └── index.html          # Browser-based terminal
│
├── tests/                  # Test suite
│   ├── server.test.js
│   ├── wrapper.test.js
│   └── integration.test.js
│
├── examples/               # Deployment examples
│   ├── docker-compose.yml
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── claude-remote.service
│   └── config.example.sh
│
├── package.json
├── README.md              # This file
└── CLAUDE.md              # Technical documentation for AI
```

## Configuration

### Server Configuration

Set via environment variables:

```bash
# Port
export PORT=8085

# Bind address
export HOST=0.0.0.0
```

### Wrapper Configuration

```bash
# Server URL
export CLAUDE_REMOTE_SERVER=ws://localhost:8085

# Claude binary path
export CLAUDE_CMD=/path/to/claude

# Silent mode (for seamless wrapper)
export CLAUDE_SEAMLESS_MODE=true
```

### Seamless Mode Configuration

Edit `~/.claude-remote.conf`:

```bash
# Server URL
export CLAUDE_REMOTE_SERVER=ws://192.168.1.100:8085

# Auto-connect toggle
export CLAUDE_AUTO_CONNECT=true

# Project directory
export CLAUDE_REMOTE_DIR=/path/to/claude-code-anywhere

# PATH priority (ensures wrapper is called first)
export PATH="/usr/local/bin:$PATH"
```

## Troubleshooting

### Server won't start

**Check port availability:**
```bash
curl http://localhost:8085/health
```

If connection refused, server isn't running. If port in use:
```bash
lsof -i:8085  # Find process using port
```

**Check firewall:**
```bash
# Linux
sudo ufw status
sudo ufw allow 8085

# Check if port is open
nc -zv localhost 8085
```

### Wrapper can't connect

**Test server connectivity:**
```bash
curl http://localhost:8085/health
```

**Check environment variable:**
```bash
echo $CLAUDE_REMOTE_SERVER
```

**Test network connectivity:**
```bash
# For remote servers
nc -zv <server-ip> 8085
```

### Client shows no output

**Verify session exists:**
```bash
curl http://localhost:8085/sessions
```

**Check if wrapper is sending output:**
- Look at the wrapper terminal - you should see output there
- If wrapper output isn't showing, check `CLAUDE_CMD` points to correct binary

### Seamless mode not working

**Verify shim is active:**
```bash
which claude  # Should show /usr/local/bin/claude
```

**Check server is running:**
```bash
curl http://localhost:8085/health
```

**Test manually:**
```bash
# Disable auto-connect and run original
CLAUDE_AUTO_CONNECT=false claude
```

**Check configuration:**
```bash
cat ~/.claude-remote.conf
```

### Network issues

**Check server is bound correctly:**
```bash
# Should show 0.0.0.0:8085 (all interfaces) or specific IP
netstat -tlnp | grep 8085
```

**Firewall:**
```bash
# Allow incoming connections
sudo ufw allow from 192.168.1.0/24 to any port 8085
```

**Test from client:**
```bash
# HTTP endpoint
curl http://<server-ip>:8085/health

# WebSocket (using websocat if installed)
websocat ws://<server-ip>:8085/health
```

## Development

### Running Tests

```bash
# All tests
npm test

# Specific test suite
npm run test:server
npm run test:wrapper
npm run test:integration

# Watch mode
npm run test:watch
```

### Project Scripts

```bash
npm run server        # Start server
npm run client        # List sessions
npm run wrapper       # Start wrapper
npm test              # Run tests
```

## Examples

See `examples/` directory for:

- **Docker**: `docker-compose.yml` and `Dockerfile`
- **Systemd**: `claude-remote.service`
- **nginx**: Reverse proxy with TLS
- **Shell helpers**: `config.example.sh`

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Write tests for new features
4. Submit a pull request

## License

MIT

## Support

- **Issues**: [GitHub Issues](https://github.com/your-username/claude-code-anywhere/issues)
- **Documentation**: See `CLAUDE.md` for technical details
- **Examples**: Check `examples/` directory

---

**Built with**:
- [ws](https://github.com/websockets/ws) - WebSocket library
- [node-pty](https://github.com/microsoft/node-pty) - PTY bindings
- [blessed](https://github.com/chjj/blessed) - Terminal UI
- [commander](https://github.com/tj/commander.js) - CLI framework

**Version**: 1.0.0  
**Node.js**: >= 18.0.0
