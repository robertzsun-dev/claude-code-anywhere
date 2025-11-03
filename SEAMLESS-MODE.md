# Seamless Mode Guide

The seamless wrapper makes Claude Code remote access completely transparent - install once, then use `claude` normally and all sessions automatically become remotely accessible!

## What is Seamless Mode?

Seamless mode intercepts the `claude` command and automatically wraps it for remote access when the session server is running.

**Normal workflow (without seamless mode):**
```bash
# Must remember to use wrapper
npm run wrapper
# Or
node wrapper.js
```

**Seamless workflow (with seamless mode):**
```bash
# Just use claude as always!
claude
# → Automatically wrapped if server is running
```

## How It Works

```
┌──────────────────────────────────────────────────────────┐
│  You type: claude                                        │
└────────────────┬─────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────┐
│  Shim script checks: Is server running?                   │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  YES                              NO                       │
│  ├─ Run via wrapper.js            ├─ Run claude directly  │
│  ├─ Enable remote access          └─ No overhead          │
│  └─ Session appears in server                             │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## Installation

### 1. Install the Shim

```bash
cd ~/claude-code-anywhere/shim
./install.sh
```

This will:
- Find your `claude` binary (e.g., `/opt/node22/bin/claude`)
- Rename it to `claude-original`
- Install the shim script as `claude`
- Create config file at `~/.claude-remote.conf`

### 2. Source Configuration (Optional)

Add to your `~/.bashrc` or `~/.zshrc`:

```bash
source ~/.claude-remote.conf
```

This sets:
- `CLAUDE_REMOTE_SERVER` - Server URL
- `CLAUDE_AUTO_CONNECT` - Enable/disable auto-wrapping
- `CLAUDE_REMOTE_DIR` - Installation directory

### 3. Start the Server

```bash
cd ~/claude-code-anywhere
npm run server
```

### 4. Use Claude Normally!

```bash
# Just type claude
claude

# With arguments
claude chat

# From IDE
# → All IDEs work unchanged!
```

## Usage Examples

### Example 1: Daily Development

```bash
# Terminal 1: Start server (once, can run in background)
npm run server

# Terminal 2: Use claude normally
cd my-project
claude
# → Session created automatically!

# Terminal 3: Connect remotely (optional)
npm run client
node client.js <session-id>
```

### Example 2: Remote Pair Programming

```bash
# Developer 1's machine (192.168.1.100)
npm run server
claude chat
# → Session created

# Developer 2's machine (192.168.1.200)
export CLAUDE_REMOTE_SERVER=ws://192.168.1.100:8085
npm run client
node client.js <session-id>
# → Both can see and interact!
```

### Example 3: IDE Integration

No changes needed! Your IDE integration just works:

**VSCode:**
- Use Claude Code extension normally
- Sessions automatically appear in server
- Can watch from another machine

**JetBrains (IntelliJ, PyCharm):**
- Use Claude Code plugin normally
- Sessions automatically available remotely

**Terminal-based (vim, emacs):**
- Launch claude from editor
- Works exactly as before

## Configuration

### Server URL

By default, connects to `ws://localhost:8085`.

To use a remote server:

```bash
# Edit ~/.claude-remote.conf
export CLAUDE_REMOTE_SERVER=ws://192.168.1.100:8085
```

Or set for a single session:

```bash
CLAUDE_REMOTE_SERVER=ws://192.168.1.100:8085 claude
```

### Disable Auto-Connect

To disable automatic wrapping:

```bash
# Temporarily
CLAUDE_AUTO_CONNECT=false claude

# Permanently - edit ~/.claude-remote.conf
export CLAUDE_AUTO_CONNECT=false
```

When disabled, `claude` runs normally without remote access.

### Custom Installation Directory

If you installed claude-code-anywhere elsewhere:

```bash
# Edit ~/.claude-remote.conf
export CLAUDE_REMOTE_DIR=/path/to/claude-code-anywhere
```

## Behavior

### When Server is Running

```bash
$ claude

# Behind the scenes:
# 1. Shim checks server (< 0.5s)
# 2. Server is running
# 3. Launches: node wrapper.js [args]
# 4. Wrapper runs: claude-original [args]
# 5. Only Claude Code output shown (no wrapper messages)
# 6. Session appears in server!
```

### When Server is NOT Running

```bash
$ claude

# Behind the scenes:
# 1. Shim checks server (< 0.5s timeout)
# 2. Server not running
# 3. Launches: claude-original [args] directly
# 4. No overhead, normal claude behavior
# 5. No remote access
```

### Performance

- **Server check**: < 0.5 second timeout
- **If server running**: Same as manual wrapper (~50ms overhead)
- **If server not running**: Same as original claude (minimal overhead)

## Troubleshooting

### "Session not appearing in server"

Check if wrapper is actually being used:

```bash
# Set verbose mode temporarily
CLAUDE_SEAMLESS_MODE=false claude

# Should see:
# [Wrapper] Connecting to server: ws://localhost:8085
# [Wrapper] Session created: abc123...
```

### "Command too slow"

The shim does a 0.5s timeout check. To make it faster:

```bash
# Edit the installed shim
sudo nano /opt/node22/bin/claude

# Change timeout:
timeout 0.1 bash -c ...  # Instead of 0.5
```

### "IDE not working"

Restart the IDE after installing the shim.

### "Want to see wrapper messages"

Temporarily disable seamless mode:

```bash
CLAUDE_SEAMLESS_MODE=false claude
```

## Uninstallation

```bash
cd ~/claude-code-anywhere/shim
./uninstall.sh
```

This restores the original `claude` command.

## Advanced

### Multiple Servers

You can connect to different servers for different projects:

```bash
# Project A
cd ~/project-a
export CLAUDE_REMOTE_SERVER=ws://server-a:8085
claude

# Project B
cd ~/project-b
export CLAUDE_REMOTE_SERVER=ws://server-b:8085
claude
```

### Background Server

Run server in background:

```bash
# Using nohup
nohup npm run server > /tmp/claude-server.log 2>&1 &

# Using systemd
sudo systemctl start claude-remote@$USER.service

# Using screen
screen -dmS claude-server npm run server
```

### Auto-start Server

Add to your shell config (`~/.bashrc` or `~/.zshrc`):

```bash
# Auto-start server if not running
if ! curl -sf http://localhost:8085/health > /dev/null 2>&1; then
    cd ~/claude-code-anywhere && nohup npm run server > /tmp/claude-server.log 2>&1 &
fi
```

## Comparison

### Without Seamless Mode

```bash
# Must remember special command
npm run wrapper

# IDE integration requires configuration
# Different workflow for remote sessions
# Two commands to remember: claude vs wrapper
```

### With Seamless Mode

```bash
# Just use claude
claude

# IDE integration unchanged
# Same workflow, automatic remote access
# One command: claude
```

## Security

The shim script:
- Only checks for server on localhost by default
- Doesn't pass credentials in process args
- Uses `exec` to replace itself (no extra process)
- Transparent to the user

For remote servers:
- Use VPN for network security
- Use `wss://` (TLS) for encryption
- Add firewall rules to restrict access

## Summary

**Before seamless mode:**
```bash
npm run server          # Terminal 1
npm run wrapper         # Terminal 2
npm run client          # Terminal 3
```

**After seamless mode:**
```bash
npm run server          # Terminal 1 (or background)
claude                  # Terminal 2 - just works!
npm run client          # Terminal 3 (optional)
```

Install once, use forever! 🎉
