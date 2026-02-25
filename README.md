# Claude Code Remote Access

> **Access your Claude Code sessions from anywhere** - View, interact with, and control Claude Code sessions remotely through your browser

Access and control your Claude Code CLI sessions from anywhere. Perfect for:
- **Remote development**: Access Claude on your workstation from your laptop
- **Pair programming**: Share your Claude session with teammates in real-time
- **Multi-device workflows**: Start on desktop, continue on laptop
- **Web access**: Use Claude through any web browser - installable as a PWA

## How It Works

Claude Code Remote Access uses **API-level interception** to capture structured conversation data directly from Claude Code's Anthropic API calls. Unlike terminal scraping, this gives you rich, structured access to every message, tool call, thinking block, and response - all rendered in a beautiful web interface.

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  Claude Code    │◄───────►│ Session Server  │◄───────►│  Web Viewer     │
│  + Interceptor  │ WebSkt  │   (server.js)   │ WebSkt  │ (Browser PWA)   │
│                 │         │                 │         │                 │
│ - Patches fetch │         │ - Session mgmt  │         │ - Structured UI │
│ - Captures API  │         │ - Event routing │         │ - Interactive   │
│ - Stdin inject  │         │ - Reconnection  │         │ - AskUser answering
└─────────────────┘         └─────────────────┘         └─────────────────┘
```

## Features

**Core Features**:
- **API Interception** - Captures structured API data (messages, tool calls, SSE events) instead of raw terminal output
- **Structured Web Viewer** - Rich browser UI with color-coded messages, collapsible thinking blocks, tool call visualization, and code formatting
- **Interactive Control** - Send input, answer AskUserQuestion prompts, interrupt, accept/reject from the browser
- **AskUserQuestion Support** - Answer single-choice, multi-select, and custom text questions directly in the web viewer with API-level injection
- **Mode Switching** - Toggle between Normal and Plan modes from the web viewer
- **Context Window Stats** - Real-time token usage, API call counts, and context utilization meter
- **Multi-Viewer** - Multiple users can view and interact with the same session simultaneously
- **Session History** - 10,000-event buffer so late joiners see full conversation context
- **Auto-Reconnect** - Seamless reconnection with PID-based session recovery
- **File Browser** - Start new sessions in any directory from the web interface
- **tmux Integration** - Browser-started sessions run in persistent tmux sessions
- **Seamless Mode** - Zero-config interception of the `claude` command
- **PWA Support** - Install as a Progressive Web App with offline caching
- **TLS/HTTPS** - Auto-detected SSL certificate support

**Technical Features**:
- WebSocket-based real-time event streaming
- API-level `fetch` patching via `--require` / `--preload` injection
- Multi-strategy stdin injection (listener call, stream push, EventEmitter)
- Event buffering (2,000 events) during WebSocket disconnects
- Heartbeat-based liveness detection (15s interval)
- Stale session reaper with PID liveness checks
- Ping/pong dead connection detection (30s sweep)
- Grace periods (5 min) for interceptor reconnection
- Three-tier reconnection: session ID → PID → new session
- Systemd service and Docker deployment support

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

**2. Run Claude with the interceptor:**
```bash
# Set the server URL and inject the interceptor
CLAUDE_INTERCEPT_SERVER=ws://localhost:8085 \
NODE_OPTIONS="--require ./src/intercept/intercept.cjs" \
claude
```

Or install the seamless shim (recommended) so you just run `claude` normally:
```bash
cd shim && sudo ./install.sh
```

**3. Open the web viewer:**
```
http://localhost:8085
```

Your Claude session appears in the sidebar. Click it to view the full structured conversation with messages, tool calls, thinking blocks, and more.

## Seamless Mode (Recommended)

**Seamless mode** makes interception completely transparent. Just run `claude` as usual and it automatically connects to the remote server when available.

### Installation

```bash
cd shim
sudo ./install.sh
```

The installer will:
1. Create a shim wrapper in `/usr/local/bin/claude`
2. Dynamically find the original `claude` binary at runtime
3. Create config file `~/.claude-remote.conf`
4. Optionally install a systemd service for the server

### How It Works

```bash
# Just use claude normally
claude

# Behind the scenes:
# 1. Shim checks if server is running (< 0.5s timeout, tries HTTPS then HTTP)
# 2. If yes: Injects interceptor via NODE_OPTIONS → structured data captured
# 3. If no: Runs original claude directly → normal operation
# 4. Claude's local terminal works exactly as designed (no PTY wrapping)
```

**Benefits**:
- No workflow changes - `claude` works identically
- Automatic fallback when server is offline
- Works with IDE integrations unchanged
- Survives npm updates (no hardcoded paths)
- Detects HTTPS vs HTTP automatically
- Supports both Node.js and Bun runtimes

### Configuration

Edit `~/.claude-remote.conf`:
```bash
# Server URL (change for remote access)
export CLAUDE_REMOTE_SERVER=ws://localhost:8085

# Auto-connect toggle
export CLAUDE_AUTO_CONNECT=true  # Set to false to disable

# Claude remote directory
export CLAUDE_REMOTE_DIR=/path/to/claude-code-anywhere

# Disable interception for this session
export CLAUDE_INTERCEPT=0

# Enable debug output
export CLAUDE_INTERCEPT_DEBUG=1
```

Then reload: `source ~/.bashrc` (or restart terminal)

### Uninstallation

```bash
cd shim
sudo ./uninstall.sh
```

## Web Viewer

The structured web viewer provides a rich browser-based interface for viewing and controlling Claude Code sessions. No installation required - or install it as a PWA.

### Conversation View

The viewer renders Claude Code's conversation as structured, color-coded blocks:

- **User messages** - Your prompts and responses
- **Assistant messages** - Claude's text responses with streaming display
- **Thinking blocks** - Collapsible extended thinking sections
- **Tool use** - Tool name, ID, and streamed input visualization
- **Tool results** - Output from tool executions with error highlighting
- **System messages** - Status and informational messages
- **API request cards** - Model, token limits, tool count, and last user turn

### Interactive Controls

- **Text input** - Type and send messages to Claude
- **Quick actions** - Send, Interrupt (Ctrl+C), Escape, Accept, Reject buttons
- **AskUserQuestion** - Answer interactive prompts directly:
  - Single-choice selections with clickable buttons
  - Multi-select questions with checkboxes
  - Multi-question forms
  - Custom "Other" text input
- **Mode switching** - Toggle Normal / Plan mode from the viewer

### Session Management

- **Session list** - Browse active sessions in the sidebar
- **Session metadata** - Host, working directory, session age
- **Start new sessions** - Create sessions in any directory via file browser
- **Close sessions** - End sessions from the web interface
- **Auto-refresh** - Session list updates every 10 seconds

### Context Window Statistics

- Visual context utilization meter (percentage bar)
- Input/output token counts
- Usable context remaining
- API call counter
- Tool call counter
- Expandable request details

### Starting Sessions from the Browser

1. Click **"+ Start New Session"** in the sidebar
2. Browse the filesystem to select a working directory
3. Click **"Select This Directory"** to create the session
4. The session appears in the list automatically

Sessions are created as detached tmux sessions with the interceptor injected automatically. Access tmux sessions directly with:
```bash
tmux list-sessions
tmux attach -t claude-<session-id>
```

### PWA Installation

The web viewer can be installed as a Progressive Web App:
1. Open `http://localhost:8085` in Chrome/Edge
2. Click the install icon in the address bar
3. Use it like a native app with offline support

## Architecture

### API Interceptor (`src/intercept/intercept.cjs`)

The interceptor is a CommonJS module loaded into Claude Code's Node.js process via `NODE_OPTIONS="--require ..."`. It:

1. **Patches `globalThis.fetch`** to intercept Anthropic API calls
2. **Parses SSE streams** in real-time from streaming responses
3. **Extracts metadata** - model, token limits, tools, system prompts
4. **Relays structured events** to the session server over WebSocket
5. **Injects stdin input** from remote viewers into Claude Code's process
6. **Rewrites AskUserQuestion responses** at the API level for interactive answering
7. **Applies viewer mode instructions** to system prompts (Normal/Plan)

**Design principles**:
- Never break Claude Code, even on errors
- Minimal overhead (async relay, buffered events)
- No user-visible output unless DEBUG is enabled
- Child process isolation (prevents re-entry via marker env var)

**Event types captured**:
| Event | Description |
|-------|-------------|
| `api_request` | Request metadata (model, tokens, tools, last user turn) |
| `sse_event` | Server-Sent Events from streaming responses |
| `api_response` | Non-streaming JSON responses |
| `api_error` | API call failures |
| `metadata` | Process info (PID, CWD, hostname, user, platform) |
| `heartbeat` | Periodic keepalive (every 15s) |
| `exit` | Process termination with code/signal |

### Session Server (`src/server.js`)

The central WebSocket hub that manages sessions and routes events:

- **Session lifecycle** - Create, reconnect, grace period, reap
- **Three-tier reconnection** - Session ID → PID lookup → new session
- **PID liveness checking** - `process.kill(pid, 0)` to detect zombie sessions
- **Stale session reaper** - Periodic sweep (60s) for zombie cleanup
- **Ping/pong** - 30s sweep to detect silently-dead WebSocket connections
- **Grace period** - 5 minutes for interceptor reconnection before reaping
- **Event history** - Circular buffer of 10,000 events per session
- **TLS support** - Auto-detects `cert.pem`/`key.pem` for HTTPS/WSS

### Web Viewer (`public/intercept.html`)

Single-page structured viewer with:
- Real-time WebSocket event rendering
- Conversation-style message layout
- Interactive AskUserQuestion answering
- Session management sidebar
- Context window statistics
- File browser modal for session creation
- Service worker for offline PWA support

## Usage

### Server

```bash
npm run server

# Custom port
PORT=9000 npm run server

# Bind to all interfaces
HOST=0.0.0.0 npm run server

# Enable HTTPS (auto-detected if cert.pem/key.pem exist)
HTTPS=true npm run server
```

**Environment Variables**:
- `PORT` - Server port (default: `8085`)
- `HOST` - Bind address (default: `0.0.0.0`)
- `HTTPS` - Force HTTPS mode (default: auto-detect certificates)

**HTTP Endpoints**:
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Web viewer (structured viewer) |
| GET | `/health` | Health check `{status, sessions, clients}` |
| GET | `/sessions` | List active sessions (JSON) |
| GET | `/browse?path=<path>` | Browse filesystem (directory contents) |
| POST | `/start-session` | Create tmux session `{workingDir, command, cols, rows}` |
| DELETE | `/sessions/<id>` | Close and reap a session |

### Interceptor (Manual Mode)

If not using the shim, inject the interceptor manually:

```bash
# Basic usage
CLAUDE_INTERCEPT_SERVER=ws://localhost:8085 \
NODE_OPTIONS="--require /path/to/intercept.cjs" \
claude

# With remote server
CLAUDE_INTERCEPT_SERVER=ws://192.168.1.100:8085 \
NODE_OPTIONS="--require ./src/intercept/intercept.cjs" \
claude

# With HTTPS
CLAUDE_INTERCEPT_SERVER=wss://myserver:8085 \
NODE_TLS_REJECT_UNAUTHORIZED=0 \
NODE_OPTIONS="--require ./src/intercept/intercept.cjs" \
claude

# Debug mode
CLAUDE_INTERCEPT_DEBUG=1 \
CLAUDE_INTERCEPT_SERVER=ws://localhost:8085 \
NODE_OPTIONS="--require ./src/intercept/intercept.cjs" \
claude
```

**Environment Variables**:
| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_INTERCEPT_SERVER` | - | WebSocket server URL (required) |
| `CLAUDE_INTERCEPT` | - | Set to `0` to disable interception |
| `CLAUDE_INTERCEPT_DEBUG` | - | Set to `1` for debug output to stderr |
| `NODE_OPTIONS` | - | Inject with `--require ./src/intercept/intercept.cjs` |

## Remote Access

### Local Network (LAN)

1. **Find your machine's IP:**
```bash
hostname -I | awk '{print $1}'
```

2. **Start server:**
```bash
npm run server
```

3. **Open from another machine:**
```
http://192.168.1.100:8085
```

### VPN Access

```bash
# Find VPN IP (usually 10.x.x.x)
ip addr show tun0

# Use VPN IP as server URL
export CLAUDE_INTERCEPT_SERVER=ws://10.8.0.1:8085
```

### Internet Access (Advanced)

**Warning**: Use with proper authentication/encryption in production.

**Option 1: SSH Tunnel (Recommended)**
```bash
# Forward remote port to local
ssh -L 8085:localhost:8085 user@remote-server

# Access via localhost
http://localhost:8085
```

**Option 2: ngrok (Quick testing)**
```bash
ngrok http 8085
# Use the ngrok URL
export CLAUDE_INTERCEPT_SERVER=wss://abc123.ngrok.io
```

**Option 3: Reverse Proxy (Production)**

See `examples/nginx.conf` for nginx with TLS and authentication.

### HTTPS / TLS

The server auto-detects TLS certificates:

```bash
# Generate self-signed certificates
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# Place cert.pem and key.pem in the project root
# Server automatically enables HTTPS/WSS
npm run server
# → "HTTPS enabled (certificates found)"
```

The shim auto-detects whether the server is using HTTPS and adjusts the WebSocket protocol accordingly (`ws://` vs `wss://`).

## Project Structure

```
claude-code-anywhere/
├── src/
│   ├── server.js                  # WebSocket session server (HTTP/HTTPS)
│   └── intercept/
│       └── intercept.cjs          # API interceptor (fetch patching, SSE parsing)
│
├── public/                        # Web viewer (PWA)
│   ├── intercept.html             # Structured conversation viewer
│   ├── index.html                 # Terminal viewer (xterm.js)
│   ├── manifest.json              # PWA manifest
│   ├── service-worker.js          # Offline caching service worker
│   ├── icon-192.png               # PWA icon (192x192)
│   └── icon-512.png               # PWA icon (512x512)
│
├── shim/                          # Seamless mode
│   ├── claude                     # Shim script (interceptor injection)
│   ├── install.sh                 # Installer with systemd support
│   └── uninstall.sh               # Removal script
│
├── tests/                         # Test suite
│   ├── server.test.js             # Server unit tests
│   ├── integration.test.js        # Integration tests
│   └── ask-answer-e2e.test.js     # AskUserQuestion E2E tests
│
├── examples/                      # Deployment examples
│   ├── docker-compose.yml         # Docker Compose stack
│   ├── Dockerfile                 # Container definition
│   ├── nginx.conf                 # Reverse proxy with TLS
│   ├── claude-remote.service      # Systemd service file
│   └── config.example.sh          # Shell configuration helpers
│
├── package.json
├── README.md
└── CLAUDE.md                      # Technical docs for AI context
```

## Configuration

### Server

```bash
export PORT=8085                   # Server port
export HOST=0.0.0.0                # Bind address
export HTTPS=true                  # Force HTTPS (or place cert.pem/key.pem in project root)
```

### Interceptor

```bash
export CLAUDE_INTERCEPT_SERVER=ws://localhost:8085   # Server URL
export CLAUDE_INTERCEPT=0                            # Disable interception
export CLAUDE_INTERCEPT_DEBUG=1                      # Debug output to stderr
```

### Seamless Mode

Edit `~/.claude-remote.conf`:

```bash
export CLAUDE_REMOTE_SERVER=ws://192.168.1.100:8085  # Server URL
export CLAUDE_AUTO_CONNECT=true                      # Auto-connect toggle
export CLAUDE_REMOTE_DIR=/path/to/claude-code-anywhere  # Project directory
```

## WebSocket Protocol

### Message Flow

```
Interceptor → Server → Viewer
   api_request  ────────►  (render request card)
   sse_event    ────────►  (stream assistant text, thinking, tool use)
   api_response ────────►  (render final response)
   metadata     ────────►  (update session info)
   heartbeat    ───X        (server-only, not forwarded)
   exit         ────────►  (session ended)

Viewer → Server → Interceptor
   input        ────────►  (stdin injection)
   raw-input    ────────►  (raw bytes for ANSI sequences)
   ask-answer   ────────►  (API-level answer rewrite)
   set-mode     ────────►  (system prompt patching)
   close-session ──X        (server closes session directly)
```

### Server → Viewer Notifications

| Message | Trigger |
|---------|---------|
| `session-attached` | Viewer connects (includes event history) |
| `session-list` | Viewer connects without session ID |
| `interceptor-reconnected` | Interceptor reconnects after disconnect |
| `wrapper-disconnected` | Interceptor disconnects |
| `session-reaped` | Session cleaned up |
| `input-echo` | Input from another viewer |
| `server-shutdown` | Server shutting down |

## Troubleshooting

### Server won't start

```bash
# Check port availability
curl http://localhost:8085/health

# Find process using port
lsof -i:8085

# Check firewall
sudo ufw allow 8085
```

### Interceptor won't connect

```bash
# Test server connectivity
curl http://localhost:8085/health

# Check environment
echo $CLAUDE_INTERCEPT_SERVER

# Enable debug mode
CLAUDE_INTERCEPT_DEBUG=1 claude
```

### Web viewer shows no sessions

```bash
# Verify sessions exist
curl http://localhost:8085/sessions

# Check interceptor is running (debug mode shows connection)
CLAUDE_INTERCEPT_DEBUG=1 claude
```

### Seamless mode not working

```bash
# Verify shim is active
which claude  # Should show /usr/local/bin/claude

# Check server is running
curl http://localhost:8085/health

# Test manually (bypass shim)
CLAUDE_INTERCEPT=0 claude

# Check configuration
cat ~/.claude-remote.conf
```

### HTTPS issues

```bash
# Verify certificates exist
ls -la cert.pem key.pem

# Test HTTPS endpoint
curl -k https://localhost:8085/health

# Allow self-signed certs for interceptor
NODE_TLS_REJECT_UNAUTHORIZED=0 claude
```

### Network issues

```bash
# Check server binding
netstat -tlnp | grep 8085

# Allow LAN connections
sudo ufw allow from 192.168.1.0/24 to any port 8085

# Test from client
curl http://<server-ip>:8085/health
```

## Development

### Running Tests

```bash
# All tests
npm test

# Server tests
npm run test:server

# Integration tests
npm run test:integration

# AskUserQuestion E2E tests (requires Claude Code)
npm run test:e2e

# Watch mode
npm run test:watch
```

### Testing the interceptor

```bash
# Verify interceptor module loads without errors
npm run intercept
```

### Project Scripts

```bash
npm run server          # Start the session server
npm run intercept       # Test interceptor module loading
npm test                # Run all tests
npm run test:watch      # Watch mode
npm run test:server     # Server tests only
npm run test:integration  # Integration tests
npm run test:e2e        # E2E tests with real Claude Code
```

## Deployment

See `examples/` directory for production deployment configurations:

- **Docker**: `Dockerfile` and `docker-compose.yml` with health checks
- **Systemd**: `claude-remote.service` with security hardening
- **nginx**: Reverse proxy with TLS termination and WebSocket upgrade
- **Shell helpers**: `config.example.sh` for environment setup

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
- **Technical Docs**: See `CLAUDE.md` for detailed architecture
- **Deployment**: Check `examples/` directory

---

**Built with**:
- [ws](https://github.com/websockets/ws) - WebSocket library

**Version**: 1.0.0
**Node.js**: >= 18.0.0
