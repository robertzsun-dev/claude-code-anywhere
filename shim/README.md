# Seamless Claude Code Wrapper

This directory contains the seamless wrapper system that makes Claude Code automatically connect to the remote access server without changing your workflow.

## What It Does

The seamless wrapper intercepts the `claude` command and:

1. **Checks if the session server is running**
2. **If yes**: Launches claude through the remote access wrapper (enables remote viewing/control)
3. **If no**: Runs the original claude command normally

This means you can:
- Type `claude` as usual
- IDE integrations work unchanged
- All sessions automatically become remotely accessible (when server is running)
- No change needed to your workflow

## Installation

### Automatic Install

```bash
cd ~/claude-code-anywhere/shim
./install.sh
```

This will:
1. Find your current `claude` binary
2. Rename it to `claude-original`
3. Install the wrapper shim as `claude`
4. Create a config file at `~/.claude-remote.conf`
5. **Optionally** install the server as a systemd service (auto-start on boot)

### What Gets Changed

**Before installation:**
```
/opt/node22/bin/claude  → Real claude binary
```

**After installation:**
```
/opt/node22/bin/claude           → Shim script (checks for server)
/opt/node22/bin/claude-original  → Real claude binary (renamed)
```

The shim is transparent - it passes all arguments and behaves exactly like claude.

## Usage

### Normal Usage (no changes needed!)

```bash
# Just use claude as normal
claude

# With arguments
claude chat

# IDE integration - works unchanged
# VSCode, JetBrains, etc. all work normally
```

### Behavior

**When server is running:**
```bash
# Terminal 1: Start server
cd ~/claude-code-anywhere
npm run server

# Terminal 2: Use claude normally
claude
# → Automatically wrapped, session appears in server!

# Terminal 3: Connect remotely
npm run client
node client.js <session-id>
```

**When server is NOT running:**
```bash
# Server not running
claude
# → Runs original claude directly, no remote access
```

### Configuration

Edit `~/.claude-remote.conf`:

```bash
# Server URL
export CLAUDE_REMOTE_SERVER=ws://localhost:8765

# Auto-connect (set to false to disable wrapper)
export CLAUDE_AUTO_CONNECT=true

# Claude remote directory
export CLAUDE_REMOTE_DIR=~/claude-code-anywhere
```

Then source it in your shell config:

```bash
# Add to ~/.bashrc or ~/.zshrc
source ~/.claude-remote.conf
```

### Disable Auto-Connect

If you want to temporarily disable the wrapper:

```bash
# Disable for current session
export CLAUDE_AUTO_CONNECT=false
claude

# Or permanently in ~/.claude-remote.conf
export CLAUDE_AUTO_CONNECT=false
```

## IDE Integration

The seamless wrapper works with all IDE integrations because it transparently replaces the `claude` command.

### VSCode

No changes needed - Claude Code extension will work normally:
- Command palette: "Claude Code"
- Terminal integration
- All features work and become remotely accessible

### JetBrains (IntelliJ, PyCharm, etc.)

No changes needed - the Claude Code plugin will work normally and sessions become remotely accessible.

### Terminal-based IDEs (vim, emacs, etc.)

No changes needed - any tool that launches `claude` will work normally.

## How It Works

### The Shim Script

```bash
#!/usr/bin/env bash

# 1. Check if server is running (quick TCP connection test)
if timeout 0.5 bash -c "cat < /dev/null > /dev/tcp/localhost/8765 2>/dev/null"; then
    server_running=true
fi

# 2. Route based on server status
if [ "$server_running" = "true" ]; then
    # Run through wrapper (enables remote access)
    export CLAUDE_SEAMLESS_MODE=true
    exec node wrapper.js "$@"
else
    # Run original claude directly
    exec claude-original "$@"
fi
```

### Seamless Mode

When launched through the shim, the wrapper runs in "seamless mode":
- No wrapper status messages shown
- Only Claude Code's actual output is displayed
- Session ID logged to server (visible in `npm run client`)
- Completely transparent to the user

### Performance

- Server check: < 0.5 seconds timeout
- If server running: Same performance as manual wrapper
- If server not running: Same as original claude (no overhead)

## Systemd Service (Optional)

During installation, you can optionally install the server as a systemd service for automatic startup:

### Benefits

- **Auto-start on boot**: Server starts automatically when system boots
- **Automatic restart**: If server crashes, systemd restarts it
- **Easy management**: Use standard systemd commands
- **Logging**: Integrated with journald

### Installation

When running `./install.sh`, answer **yes** when asked:

```
Install systemd service? [y/N] y
Enable service to start on boot? [Y/n] Y
Start service now? [Y/n] Y
```

### Service Commands

```bash
# Status
sudo systemctl status claude-remote-server.service

# Start/stop/restart
sudo systemctl start claude-remote-server.service
sudo systemctl stop claude-remote-server.service
sudo systemctl restart claude-remote-server.service

# Enable/disable auto-start on boot
sudo systemctl enable claude-remote-server.service
sudo systemctl disable claude-remote-server.service

# View logs
sudo journalctl -u claude-remote-server.service -f
```

### Manual Installation

If you skipped systemd during install, you can manually install it later:

```bash
# Copy the service file
sudo cp ~/claude-code-anywhere/examples/claude-remote.service \
  /etc/systemd/system/claude-remote-server.service

# Edit paths if needed
sudo nano /etc/systemd/system/claude-remote-server.service

# Reload systemd
sudo systemctl daemon-reload

# Enable and start
sudo systemctl enable claude-remote-server.service
sudo systemctl start claude-remote-server.service
```

## Uninstallation

```bash
cd ~/claude-code-anywhere/shim
./uninstall.sh
```

This will:
1. Remove the shim script
2. Restore `claude-original` to `claude`
3. **Optionally** remove the systemd service (if installed)
4. Return to original setup

The config file (`~/.claude-remote.conf`) is preserved.

## Advanced Configuration

### Remote Server

To use a remote server:

```bash
# Edit ~/.claude-remote.conf
export CLAUDE_REMOTE_SERVER=ws://192.168.1.100:8765

# All claude sessions now connect to remote server
```

### Multiple Environments

You can have different configs for different projects:

```bash
# Project-specific config
cd ~/my-project
cat > .claude-remote.conf << EOF
export CLAUDE_REMOTE_SERVER=ws://project-server:8765
export CLAUDE_AUTO_CONNECT=true
EOF

# Use in this directory
source .claude-remote.conf
claude
```

### Debugging

To see what the shim is doing:

```bash
# Check server connectivity
timeout 0.5 bash -c "cat < /dev/null > /dev/tcp/localhost/8765 2>/dev/null" && echo "Server running" || echo "Server not running"

# Check which claude is being used
which claude
readlink -f $(which claude)

# Verify backup exists
ls -la /opt/node22/bin/claude*
```

## Troubleshooting

### "claude: command not found"

The shim may not be in PATH. Check:

```bash
which claude
# Should show: /opt/node22/bin/claude or similar

echo $PATH
# Should include /opt/node22/bin
```

### Server check too slow

The shim checks server connectivity with 0.5s timeout. To adjust:

Edit the installed shim and change:
```bash
timeout 0.5 bash -c ...
# to
timeout 0.1 bash -c ...
```

### Wrapper messages showing

Make sure `CLAUDE_SEAMLESS_MODE=true` is set in the shim script.

### IDE not picking up changes

Restart the IDE after installation.

## Files

- `claude` - Template shim script
- `install.sh` - Installation script
- `uninstall.sh` - Uninstallation script
- `README.md` - This file

## Security Notes

The shim script:
- Only checks localhost by default
- Doesn't expose credentials
- Passes all args transparently
- Uses `exec` to replace itself (no wrapper process remains)

For remote servers, use:
- VPN for secure connections
- TLS (`wss://`) for encrypted transport
- Firewall rules to restrict access

## Examples

### Example 1: Local Development

```bash
# Start server
npm run server

# Use claude normally (auto-wrapped)
claude

# Connect from another terminal
npm run client
```

### Example 2: Remote Team Collaboration

```bash
# On server (192.168.1.100)
npm run server

# On developer machine
export CLAUDE_REMOTE_SERVER=ws://192.168.1.100:8765
claude

# Teammate connects remotely
export CLAUDE_REMOTE_SERVER=ws://192.168.1.100:8765
npm run client
node client.js <session-id>
```

### Example 3: Selective Enabling

```bash
# Normally disabled
export CLAUDE_AUTO_CONNECT=false

# Enable for specific session
CLAUDE_AUTO_CONNECT=true claude
```

## Future Enhancements

Potential improvements:
- [ ] Auto-start server if not running
- [ ] Session persistence/reconnection
- [ ] Multiple server support (round-robin)
- [ ] Health check caching
- [ ] Background server status daemon
