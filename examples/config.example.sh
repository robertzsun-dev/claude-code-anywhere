#!/bin/bash

# Example configuration for Claude Code Remote Access
# Copy this to your ~/.bashrc or ~/.zshrc for convenience

# ═══════════════════════════════════════════════════════════
# Server Configuration
# ═══════════════════════════════════════════════════════════

# Server host and port
export CLAUDE_REMOTE_HOST=0.0.0.0
export CLAUDE_REMOTE_PORT=8085

# Full server URL (used by wrapper and client)
export CLAUDE_REMOTE_SERVER=ws://localhost:8085

# ═══════════════════════════════════════════════════════════
# Wrapper Configuration
# ═══════════════════════════════════════════════════════════

# Claude Code command (if not in PATH or using custom build)
export CLAUDE_CMD=claude

# ═══════════════════════════════════════════════════════════
# Network Scenarios
# ═══════════════════════════════════════════════════════════

# LOCAL NETWORK (same subnet)
# export CLAUDE_REMOTE_SERVER=ws://192.168.1.100:8085

# VPN NETWORK (connected via VPN)
# export CLAUDE_REMOTE_SERVER=ws://10.8.0.1:8085

# INTERNET (via reverse proxy with TLS)
# export CLAUDE_REMOTE_SERVER=wss://claude-remote.example.com

# NGROK TUNNEL
# export CLAUDE_REMOTE_SERVER=wss://abc123.ngrok.io

# SSH TUNNEL (forward remote port to local)
# ssh -L 8085:localhost:8085 user@remote-server
# export CLAUDE_REMOTE_SERVER=ws://localhost:8085

# ═══════════════════════════════════════════════════════════
# Convenience Aliases
# ═══════════════════════════════════════════════════════════

# Start the server
alias claude-server='cd ~/claude-code-anywhere && npm run server'

# Start a wrapped Claude Code session
alias claude-remote='cd ~/claude-code-anywhere && npm run wrapper'

# List active sessions
alias claude-sessions='cd ~/claude-code-anywhere && npm run client'

# Connect to a session (usage: claude-connect <session-id>)
claude-connect() {
    if [ -z "$1" ]; then
        echo "Usage: claude-connect <session-id>"
        return 1
    fi
    cd ~/claude-code-anywhere && node src/client.js "$1"
}

# Quick start everything
claude-start-all() {
    echo "Starting Claude Code Remote Access..."

    # Start server if not running
    if ! curl -s http://localhost:8085/health > /dev/null 2>&1; then
        echo "Starting server..."
        cd ~/claude-code-anywhere && npm run server > /tmp/claude-server.log 2>&1 &
        sleep 2
    fi

    # List sessions
    cd ~/claude-code-anywhere && npm run client
}

# Stop the server
claude-stop() {
    pkill -f "node src/server.js" || echo "No server running"
}

# ═══════════════════════════════════════════════════════════
# Examples
# ═══════════════════════════════════════════════════════════

# EXAMPLE 1: Local usage
# 1. claude-server                   # Start server
# 2. claude-remote                   # Start Claude Code session
# 3. claude-sessions                 # List sessions
# 4. claude-connect abc123           # Connect to session

# EXAMPLE 2: Remote usage (from another machine)
# 1. On server: claude-server
# 2. On server: claude-remote
# 3. On client: export CLAUDE_REMOTE_SERVER=ws://192.168.1.100:8085
# 4. On client: claude-connect abc123

# EXAMPLE 3: Internet usage (with ngrok)
# 1. On server: ngrok http 8085
# 2. On server: export CLAUDE_REMOTE_SERVER=wss://abc123.ngrok.io
# 3. On server: claude-remote
# 4. On client: export CLAUDE_REMOTE_SERVER=wss://abc123.ngrok.io
# 5. On client: claude-connect abc123
