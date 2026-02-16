# Claude Code API Interceptor Shim

This directory contains the shim system that transparently intercepts Claude Code's API calls for remote viewing and control.

## How It Works

The shim intercepts the `claude` command and:

1. **Checks if the session server is running** (< 0.5s health check)
2. **If yes**: Injects the API interceptor via `NODE_OPTIONS="--require intercept.cjs"`
3. **If no**: Runs the original `claude` command directly

Unlike the old PTY wrapper approach, the interceptor:
- Runs inside Claude Code's own Node.js process (no wrapper process)
- Captures structured API data (requests, SSE events, responses)
- Supports remote input via stdin injection
- Leaves Claude Code's terminal UI completely untouched
- Survives Claude Code UI upgrades

## Installation

```bash
cd ~/claude-code-anywhere/shim
./install.sh
```

This will:
1. Install the shim to `/usr/local/bin/claude`
2. Create a config file at `~/.claude-remote.conf`
3. Optionally add shell integration to your rc file

### What Gets Changed

The shim is installed to `/usr/local/bin/claude`, which takes priority in PATH over the real claude binary. No renaming of the original binary is needed.

```
/usr/local/bin/claude  → Shim script (checks for server, injects interceptor)
/path/to/real/claude   → Original binary (found dynamically via PATH)
```

## Usage

```bash
# Just use claude as normal
claude

# With arguments
claude chat

# IDE integration works unchanged
```

### Behavior

**When server is running:**
- Shim detects server via health check
- Injects `intercept.cjs` via `NODE_OPTIONS`
- Claude Code runs normally with interceptor capturing API traffic
- Session appears in the web viewer at `http://localhost:8085`
- Remote users can view output and send input

**When server is NOT running:**
- Shim runs original claude directly
- Zero overhead, no interception

### Configuration

Edit `~/.claude-remote.conf`:

```bash
# Auto-connect to server (set to false to disable)
export CLAUDE_AUTO_CONNECT=true

# Claude remote directory
export CLAUDE_REMOTE_DIR=~/claude-code-anywhere

# Debug interceptor
# export CLAUDE_INTERCEPT_DEBUG=1
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CLAUDE_AUTO_CONNECT` | `true` | Enable/disable auto-connect |
| `CLAUDE_REMOTE_SERVER` | auto-detected | Server URL (`ws://` or `wss://`) |
| `CLAUDE_REMOTE_DIR` | `~/claude-code-anywhere` | Project directory |
| `CLAUDE_INTERCEPT` | (unset) | Set to `0` to disable interception |
| `CLAUDE_INTERCEPT_DEBUG` | (unset) | Set to `1` for debug output |
| `CLAUDE_ORIGINAL` | (auto-detected) | Override path to original claude binary |

## Uninstallation

```bash
cd ~/claude-code-anywhere/shim
./uninstall.sh
```

This will:
1. Remove the shim from `/usr/local/bin/claude`
2. Optionally remove the systemd service
3. Leave config file and original claude untouched

## Files

- `claude` - Template shim script
- `install.sh` - Installation script
- `uninstall.sh` - Uninstallation script
- `README.md` - This file

## Troubleshooting

### "claude: command not found"

The original binary may not be in PATH after removing the shim:
```bash
which claude
echo $PATH
```

### Server check too slow

Adjust the timeout in the installed shim at `/usr/local/bin/claude`:
```bash
timeout 0.5 bash -c ...
# Change 0.5 to a lower value like 0.1
```

### Debug the interceptor

```bash
export CLAUDE_INTERCEPT_DEBUG=1
claude
# Watch stderr for interceptor debug messages
```

### Temporarily disable interception

```bash
# For one session
CLAUDE_INTERCEPT=0 claude

# Or disable auto-connect
CLAUDE_AUTO_CONNECT=false claude
```
