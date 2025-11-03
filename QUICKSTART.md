# Quick Start Guide

Get up and running with Claude Code Remote Access in 5 minutes!

## Prerequisites

- Node.js 18+ installed
- `claude` command available (Claude Code CLI)
- Network connectivity between machines (if remote access)

## Installation

```bash
# Clone the repository
git clone <your-repo> claude-code-anywhere
cd claude-code-anywhere

# Install dependencies
npm install
```

## Quick Start Options

**Option A: Seamless Mode (Recommended)** - Install once, use `claude` normally
**Option B: Manual Mode** - Explicitly start wrapper for each session

---

## Option A: Seamless Mode (Recommended)

The easiest way! Install once and forget about it.

### 1. Install Seamless Wrapper

```bash
cd shim
./install.sh
```

During installation, you'll be asked:
- **Install systemd service?** [y/N] - Answer **y** for auto-start on boot
- **Enable on boot?** [Y/n] - Answer **Y** (default)
- **Start now?** [Y/n] - Answer **Y** (default)

### 2. Use Claude Normally!

```bash
claude
# → Automatically wrapped and remotely accessible!
```

### 3. Connect Remotely (Optional)

**Option A: Web Browser (Easiest)**

Just open your browser:
```
http://localhost:8765
```

Click any session to view!

**Option B: Terminal Client**

```bash
npm run client
node client.js <session-id>
```

**That's it!** The server auto-starts on boot, and every `claude` session is remotely accessible.

See [SEAMLESS-MODE.md](SEAMLESS-MODE.md) for full documentation.

---

## Option B: Manual Mode

For more control over when sessions are remotely accessible.

### 3-Step Setup

### Step 1: Start the Server

On the machine that will host the session server:

```bash
npm run server
```

You should see:
```
╔════════════════════════════════════════════════════════════╗
║   Claude Code Remote Access Server                        ║
╟────────────────────────────────────────────────────────────╢
║   WebSocket: ws://0.0.0.0:8765                            ║
║   HTTP:      http://0.0.0.0:8765                          ║
╚════════════════════════════════════════════════════════════╝
```

### Step 2: Start a Claude Code Session

On the same machine (or another machine with network access):

```bash
npm run wrapper
```

You'll see:
```
[Wrapper] Connected to server
[Wrapper] Session created: a1b2c3d4e5f6g7h8
[Wrapper] To connect remotely: node client.js a1b2c3d4e5f6g7h8
[Wrapper] Server URL: ws://localhost:8765
```

**Copy the session ID** (e.g., `a1b2c3d4e5f6g7h8`)

### Step 3: Connect from Another Machine

On any machine with network access to the server:

```bash
# List available sessions
npm run client

# Or connect directly to a session
node client.js a1b2c3d4e5f6g7h8
```

If connecting from a different machine:

```bash
# Set server URL
export CLAUDE_REMOTE_SERVER=ws://192.168.1.100:8765

# Connect
node client.js a1b2c3d4e5f6g7h8
```

## Usage

### In the Client UI

Once connected, you'll see Claude Code's output in real-time.

**Keyboard shortcuts:**
- **Ctrl+I** - Open input dialog to send commands
- **Ctrl+L** - Clear the terminal
- **Ctrl+C** - Disconnect
- **Mouse** - Scroll through output

### Managing Sessions

```bash
# List all active sessions
npm run client

# Connect to a specific session
node client.js <session-id>

# Check server health
curl http://localhost:8765/health

# List sessions via HTTP
curl http://localhost:8765/sessions | jq
```

## Common Scenarios

### Local Testing

All on one machine:

1. **Terminal 1:** `npm run server`
2. **Terminal 2:** `npm run wrapper`
3. **Terminal 3:** `npm run client` (to list), then `node client.js <session-id>`

### Remote Access on LAN

Server on `192.168.1.100`, client on `192.168.1.200`:

**On 192.168.1.100:**
```bash
npm run server
npm run wrapper
```

**On 192.168.1.200:**
```bash
export CLAUDE_REMOTE_SERVER=ws://192.168.1.100:8765
npm run client
node client.js <session-id>
```

### VPN Access

If connected via VPN (e.g., WireGuard, OpenVPN):

**On VPN server (10.8.0.1):**
```bash
npm run server
npm run wrapper
```

**On VPN client (10.8.0.2):**
```bash
export CLAUDE_REMOTE_SERVER=ws://10.8.0.1:8765
node client.js <session-id>
```

### Internet Access (via ngrok)

**On server:**
```bash
# Start server
npm run server

# In another terminal, start ngrok
ngrok http 8765
```

ngrok will give you a URL like: `https://abc123.ngrok.io`

**Use this URL:**
```bash
export CLAUDE_REMOTE_SERVER=wss://abc123.ngrok.io
npm run wrapper
```

**On client (anywhere):**
```bash
export CLAUDE_REMOTE_SERVER=wss://abc123.ngrok.io
node client.js <session-id>
```

## Troubleshooting

### "Cannot find module"

```bash
npm install
```

### "ECONNREFUSED"

Server isn't running or firewall is blocking:

```bash
# Check if server is running
curl http://localhost:8765/health

# Check firewall (Linux)
sudo ufw status
sudo ufw allow 8765
```

### Can't connect from remote machine

1. **Check server is listening on 0.0.0.0** (not 127.0.0.1)
2. **Firewall rules** - allow port 8765
3. **Network connectivity** - ping the server
4. **Correct URL** - make sure using server's IP

### No output in client

- Client only shows output from when it connects
- Try sending input with **Ctrl+I** to trigger output
- Check wrapper is still running

## Next Steps

- Read the [full README](README.md) for detailed documentation
- Check [examples/](examples/) for deployment configurations
- Set up systemd service for automatic startup
- Configure nginx reverse proxy for TLS
- Add authentication for production use

## Tips

- **Multiple viewers**: Multiple clients can connect to the same session
- **Session persistence**: Sessions stay active even if clients disconnect
- **Local interaction**: The wrapper also shows output locally
- **Background sessions**: Run wrapper with `nohup` or `screen`
- **Aliases**: Source `examples/config.example.sh` for convenient aliases

## Security Warning

⚠️ **This is a basic implementation without authentication!**

For production use:
- Use VPN for network access
- Add TLS (`wss://`) for encryption
- Implement authentication (JWT, API keys)
- Use firewall rules to restrict access
- Consider end-to-end encryption

## Getting Help

Issues? Check:
1. Server logs: Check terminal where server is running
2. Wrapper logs: Check terminal where wrapper is running
3. Network: `curl http://server-ip:8765/health`
4. Firewall: Make sure port 8765 is open

Still stuck? Open an issue on GitHub!
