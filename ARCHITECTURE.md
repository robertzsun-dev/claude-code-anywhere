# Architecture

Detailed technical architecture for Claude Code Remote Access.

## System Overview

```
┌────────────────────────────────────────────────────────────────┐
│                    Claude Code Remote Access                    │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐         ┌──────────────┐         ┌─────────┐│
│  │   Wrapper    │◄───────►│    Server    │◄───────►│ Client  ││
│  │  (wrapper.js)│ WebSkt  │  (server.js) │ WebSkt  │(client  ││
│  │              │         │              │         │  .js)   ││
│  │  - node-pty  │         │  - WebSocket │         │ -blessed││
│  │  - Spawns    │         │  - Routing   │         │ - TUI   ││
│  │  - Captures  │         │  - History   │         │ - Input ││
│  └──────────────┘         └──────────────┘         └─────────┘│
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                  Seamless Wrapper (shim/)                │ │
│  │  - Bash script that intercepts 'claude' command         │ │
│  │  - Auto-detects server availability                     │ │
│  │  - Transparent to user                                  │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Server (server.js)

**Role**: Central WebSocket hub for session coordination

#### Responsibilities

- Accept WebSocket connections (wrappers and viewers)
- Route messages between connections
- Maintain session state and history
- Provide HTTP endpoints for session listing

#### Data Structures

```javascript
// Session Map
sessions: Map<sessionId, Session>

// Session Object
Session {
  id: string,                    // Unique session identifier
  created: Date,                 // Session creation time
  lastActivity: Date,            // Last message timestamp
  wrapperWs: WebSocket,          // Connection to wrapper
  metadata: {
    cwd: string,                 // Current working directory
    command: string,             // Command being run
    args: string[],              // Command arguments
    hostname: string,            // Machine hostname
    platform: string,            // OS platform
    user: string                 // Username
  },
  history: [                     // Output history buffer
    {
      type: string,              // 'output', 'metadata', etc.
      data: any,                 // Message data
      timestamp: Date            // When message was received
    }
  ],
  maxHistory: 10000             // Buffer size limit
}

// Client Map
clients: Map<clientId, Client>

// Client Object
Client {
  ws: WebSocket,                // WebSocket connection
  sessionId: string,            // Associated session ID
  role: 'wrapper' | 'viewer'   // Client role
}
```

#### Message Flow

```
Wrapper → Server:
  1. Connect with ?role=wrapper
  2. Receive session-created message
  3. Send output/metadata/exit messages
  4. Receive input/resize from viewers

Viewer → Server:
  1. Connect with ?role=viewer&session=ID
  2. Receive session-attached with history
  3. Receive real-time output messages
  4. Send input/resize to wrapper
```

#### Connection Lifecycle

```
┌─────────────┐
│  Connection │
│   Opened    │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ Parse URL       │
│ Extract role &  │
│ session params  │
└──────┬──────────┘
       │
       ├── role=wrapper ──────────┐
       │                          │
       │                          ▼
       │                   ┌──────────────┐
       │                   │ Create       │
       │                   │ Session      │
       │                   └──────┬───────┘
       │                          │
       │                          ▼
       │                   ┌──────────────┐
       │                   │ Send session-│
       │                   │ created msg  │
       │                   └──────┬───────┘
       │                          │
       │                          ▼
       │                   ┌──────────────┐
       │                   │ Register     │
       │                   │ client       │
       │                   └──────────────┘
       │
       ├── role=viewer ───────────┐
       │                          │
       │                          ▼
       │                   ┌──────────────┐
       │                   │ Find session │
       │                   │ by ID        │
       │                   └──────┬───────┘
       │                          │
       │                   ┌──────┴───────┐
       │                   │ Exists?      │
       │                   └──────┬───────┘
       │                          │
       │                    Yes───┼───No
       │                          │    │
       │                          │    ▼
       │                          │  Error
       │                          │  Close
       │                          │
       │                          ▼
       │                   ┌──────────────┐
       │                   │ Send session-│
       │                   │ attached +   │
       │                   │ history      │
       │                   └──────┬───────┘
       │                          │
       │                          ▼
       │                   ┌──────────────┐
       │                   │ Register     │
       │                   │ client       │
       │                   └──────────────┘
       │
       └── invalid role ──────────┐
                                  │
                                  ▼
                           ┌──────────────┐
                           │ Send error   │
                           │ Close        │
                           └──────────────┘
```

### 2. Wrapper (wrapper.js)

**Role**: Spawn Claude Code in PTY and stream I/O

#### Architecture

```javascript
┌──────────────────────────────────────────┐
│           Wrapper Process                │
├──────────────────────────────────────────┤
│                                          │
│  WebSocket Client                        │
│  ↓ ↑                                     │
│  Server Connection                       │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │  PTY (Pseudo-Terminal)             │ │
│  │  ┌──────────────────────────────┐  │ │
│  │  │  Claude Code Process         │  │ │
│  │  │  (spawned with node-pty)     │  │ │
│  │  │                              │  │ │
│  │  │  stdin  ◄───┐                │  │ │
│  │  │  stdout ────┤                │  │ │
│  │  │  stderr ────┤                │  │ │
│  │  └──────────────┴───────────────┘  │ │
│  │                 │                   │ │
│  │                 │ Terminal data     │ │
│  │                 ▼                   │ │
│  │          Forward to:                │ │
│  │          1. Local stdout            │ │
│  │          2. Server (WebSocket)      │ │
│  └────────────────────────────────────┘ │
│                                          │
│  Local Terminal (stdin)                 │
│  ↓                                       │
│  Forward to PTY                          │
│                                          │
└──────────────────────────────────────────┘
```

#### PTY Configuration

```javascript
pty.spawn(command, args, {
  name: 'xterm-256color',  // Terminal type
  cols: 80,                 // Terminal width
  rows: 24,                 // Terminal height
  cwd: process.cwd(),       // Working directory
  env: process.env          // Environment variables
});
```

#### I/O Handling

**Output** (PTY → Server):
```javascript
terminal.onData((data) => {
  // 1. Write to local stdout (user sees output)
  process.stdout.write(data);

  // 2. Send to server (remote viewers see output)
  sendToServer({
    type: 'output',
    data: data
  });
});
```

**Input** (Local/Remote → PTY):
```javascript
// Local input
process.stdin.on('data', (data) => {
  terminal.write(data);
});

// Remote input (from viewers)
ws.on('message', (message) => {
  if (message.type === 'input') {
    terminal.write(message.data);
  }
});
```

#### Seamless Mode

When `CLAUDE_SEAMLESS_MODE=true`:

```javascript
// Logging functions become no-ops
function log(...args) {
  if (!SEAMLESS_MODE) {
    console.log(...args);
  }
}

// Only Claude Code output is shown
// Wrapper messages are suppressed
```

### 3. Client (client.js)

**Role**: Remote terminal UI for viewing/controlling sessions

#### UI Layout

```
┌─────────────────────────────────────────────────────────┐
│ Session: abc123 | Host: laptop | CWD: ~/project        │ ← Status Bar
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Terminal Output Area                                   │
│  (blessed.log component)                                │
│                                                         │
│  - Scrollable (10,000 lines)                            │
│  - Auto-scroll to bottom                                │
│  - Mouse wheel support                                  │
│  - Preserves colors and formatting                      │
│                                                         │
│                                                         │
│                                                         │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ Ctrl+I: Input | Ctrl+L: Clear | Ctrl+C: Quit          │ ← Hint Bar
└─────────────────────────────────────────────────────────┘
```

#### Input Dialog

```
┌─────────────────────────────────────────────┐
│  Send Input (Enter to send, Esc to cancel)  │
├─────────────────────────────────────────────┤
│  ┌──────────────────────────────────────┐   │
│  │  your input here                     │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

#### Component Structure

```javascript
screen              // blessed.screen
├── statusBar       // blessed.box (top)
├── terminal        // blessed.log (center)
└── hintBar         // blessed.box (bottom)

// Dynamic:
inputBox            // blessed.textbox (modal)
```

#### Event Handling

```javascript
// Keyboard
screen.key('C-i', openInputDialog);
screen.key('C-l', clearTerminal);
screen.key('C-c', disconnect);

// Mouse
terminal.on('mouse', handleScroll);

// WebSocket
ws.on('message', handleServerMessage);
```

### 4. Seamless Wrapper (shim/)

**Role**: Transparent Claude Code interception

#### Shim Script Logic

```bash
#!/usr/bin/env bash

# 1. Configuration
CLAUDE_ORIGINAL="/path/to/claude-original"
SERVER_URL="${CLAUDE_REMOTE_SERVER:-ws://localhost:8765}"
AUTO_CONNECT="${CLAUDE_AUTO_CONNECT:-true}"

# 2. Check if auto-connect enabled
if [ "$AUTO_CONNECT" != "true" ]; then
  exec "$CLAUDE_ORIGINAL" "$@"
fi

# 3. Check if server is running
server_running=false
if timeout 0.5 bash -c "cat < /dev/null > /dev/tcp/$host/$port 2>/dev/null"; then
  server_running=true
fi

# 4. Route based on server status
if [ "$server_running" = "true" ]; then
  # Server available: use wrapper
  export CLAUDE_CMD="$CLAUDE_ORIGINAL"
  export CLAUDE_SEAMLESS_MODE=true
  exec node /path/to/wrapper.js "$@"
else
  # Server unavailable: use original
  exec "$CLAUDE_ORIGINAL" "$@"
fi
```

#### Installation Process

```
┌─────────────────────────────────────┐
│ install.sh                          │
├─────────────────────────────────────┤
│                                     │
│ 1. Find claude binary               │
│    which claude                     │
│    → /opt/node22/bin/claude         │
│                                     │
│ 2. Backup original                  │
│    mv claude → claude-original      │
│                                     │
│ 3. Generate shim                    │
│    cat > claude << EOF              │
│    #!/usr/bin/env bash              │
│    # ... shim logic ...             │
│    EOF                              │
│                                     │
│ 4. Install shim                     │
│    mv shim → claude                 │
│    chmod +x claude                  │
│                                     │
│ 5. Create config                    │
│    cat > ~/.claude-remote.conf      │
│                                     │
│ 6. [OPTIONAL] Install systemd       │
│    Create service file              │
│    Enable and start service         │
│                                     │
└─────────────────────────────────────┘
```

## Communication Protocols

### WebSocket Messages

#### Wrapper → Server

```javascript
// Output from Claude Code
{
  type: "output",
  data: string  // Terminal output (with colors, escape codes)
}

// Session metadata
{
  type: "metadata",
  data: {
    cwd: string,
    command: string,
    args: string[],
    hostname: string,
    platform: string,
    user: string
  }
}

// Claude Code exit
{
  type: "exit",
  code: number,    // Exit code
  signal: string?  // Signal if killed
}
```

#### Viewer → Server

```javascript
// User input
{
  type: "input",
  data: string  // User typed input
}

// Terminal resize
{
  type: "resize",
  cols: number,
  rows: number
}
```

#### Server → Wrapper

```javascript
// Session created
{
  type: "session-created",
  sessionId: string,
  serverUrl: string
}

// Input from viewer
{
  type: "input",
  data: string
}

// Resize from viewer
{
  type: "resize",
  cols: number,
  rows: number
}
```

#### Server → Viewer

```javascript
// Session attached
{
  type: "session-attached",
  sessionId: string,
  metadata: object,
  history: array
}

// Real-time output
{
  type: "output",
  data: string
}

// Metadata update
{
  type: "metadata",
  data: object
}

// Session ended
{
  type: "exit",
  code: number,
  signal: string?
}

// Input echo (from other viewers)
{
  type: "input-echo",
  data: string
}

// Wrapper disconnected
{
  type: "wrapper-disconnected"
}

// Error
{
  type: "error",
  error: string
}
```

### HTTP Endpoints

```
GET /health
Returns: {
  status: "ok",
  sessions: number,
  clients: number
}

GET /sessions
Returns: {
  sessions: [
    {
      id: string,
      created: string (ISO 8601),
      lastActivity: string (ISO 8601),
      metadata: object
    }
  ]
}
```

## State Management

### Server State

```javascript
// In-memory state (does not persist across restarts)
const sessions = new Map();  // sessionId → Session
const clients = new Map();   // clientId → Client
```

### Session Lifecycle

```
1. CREATE
   Wrapper connects → Server creates session
   ↓
2. ACTIVE
   Wrapper sends output → Server broadcasts to viewers
   Viewers send input → Server forwards to wrapper
   ↓
3. TERMINATE
   a. Wrapper sends exit → Server notifies viewers → Delete session
   b. Wrapper disconnects → Wait 30s → Delete session
   c. All clients disconnect → Delete session (configurable)
```

### History Management

```javascript
// History buffer is circular
addToHistory(session, type, data) {
  session.history.push({ type, data, timestamp });

  // Trim if exceeds maxHistory
  if (session.history.length > session.maxHistory) {
    session.history = session.history.slice(-session.maxHistory);
  }
}
```

## Security Model

### Current Security

- ✅ No credentials stored
- ✅ WebSocket origin checking (basic)
- ⚠️ No authentication
- ⚠️ No encryption (ws://)
- ⚠️ No access control

### Recommended Security (Production)

```
┌──────────────────────────────────────────┐
│ Internet                                 │
└──────────┬───────────────────────────────┘
           │ HTTPS/WSS (encrypted)
           ▼
┌──────────────────────────────────────────┐
│ nginx (Reverse Proxy)                    │
│ - TLS termination                        │
│ - Basic auth / JWT validation            │
│ - Rate limiting                          │
│ - Request logging                        │
└──────────┬───────────────────────────────┘
           │ HTTP/WS (localhost only)
           ▼
┌──────────────────────────────────────────┐
│ Server (localhost:8765)                  │
│ - Session management                     │
│ - Message routing                        │
└──────────────────────────────────────────┘
```

## Performance Characteristics

### Latency

- **Local network**: < 50ms
- **Internet**: < 200ms (depends on connection)
- **Message overhead**: ~100 bytes (JSON)

### Memory

- **Server**: ~10MB base + 1-2MB per session
- **Wrapper**: ~50MB (node-pty overhead)
- **Client**: ~30MB (blessed UI)

### Scalability

- **Concurrent sessions**: ~1000 (single server)
- **Viewers per session**: Limited by bandwidth
- **History per session**: 10,000 lines (~1MB)

### Optimizations

- History buffer uses slice() for O(1) trim
- WebSocket binary mode (future)
- Compression for history (future)
- Redis for session storage (future)

## Future Architecture

### Planned Improvements

1. **Session Persistence**
   ```
   Server → Redis → Sessions survive restart
   ```

2. **Multi-Server**
   ```
   nginx → [Server1, Server2, Server3]
           ↓
         Redis (shared state)
   ```

3. **Web Client**
   ```
   Browser → HTTPS → Server
   (xterm.js for terminal rendering)
   ```

4. **Authentication**
   ```
   Client → JWT token → Server validates
   ```

## Diagrams

### Deployment Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Production Setup                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────┐                                        │
│  │   Internet  │                                        │
│  └──────┬──────┘                                        │
│         │ HTTPS/WSS                                     │
│         ▼                                               │
│  ┌─────────────┐                                        │
│  │   nginx     │ (Reverse Proxy)                       │
│  │   - TLS     │                                        │
│  │   - Auth    │                                        │
│  └──────┬──────┘                                        │
│         │ HTTP/WS (localhost)                           │
│         ▼                                               │
│  ┌─────────────┐                                        │
│  │   Server    │ (Port 8765)                           │
│  │  systemd    │                                        │
│  └──────┬──────┘                                        │
│         │                                               │
│         ├──────────┬──────────┐                        │
│         │          │          │                        │
│         ▼          ▼          ▼                        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                 │
│  │Wrapper 1│ │Wrapper 2│ │Wrapper N│                 │
│  └─────────┘ └─────────┘ └─────────┘                 │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

**Last Updated**: 2025-11-03
**Version**: 1.0.0
