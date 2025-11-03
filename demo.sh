#!/bin/bash

# Demo script for Claude Code Remote Access
# This shows the basic workflow

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║   Claude Code Remote Access - Demo                        ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check if server is running
echo -e "${CYAN}1. Checking if server is running...${NC}"
if curl -s http://localhost:8085/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Server is running${NC}"
else
    echo -e "${YELLOW}! Server is not running${NC}"
    echo -e "${CYAN}  Starting server...${NC}"
    npm run server > /tmp/claude-remote-server.log 2>&1 &
    SERVER_PID=$!
    echo -e "${GREEN}✓ Server started (PID: $SERVER_PID)${NC}"

    # Wait for server to be ready
    sleep 2

    # Verify
    if curl -s http://localhost:8085/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Server is healthy${NC}"
    else
        echo -e "${RED}✗ Server failed to start${NC}"
        exit 1
    fi
fi

echo ""
echo -e "${CYAN}2. Server status:${NC}"
curl -s http://localhost:8085/health | jq '.' || echo "  Could not fetch status"

echo ""
echo -e "${CYAN}3. Active sessions:${NC}"
curl -s http://localhost:8085/sessions | jq '.' || echo "  Could not fetch sessions"

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║   Next Steps                                               ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}To start a Claude Code session:${NC}"
echo -e "  ${YELLOW}npm run wrapper${NC}"
echo ""
echo -e "${GREEN}To connect to a session remotely:${NC}"
echo -e "  ${YELLOW}npm run client${NC}          # List sessions"
echo -e "  ${YELLOW}node client.js <session-id>${NC}  # Connect to a session"
echo ""
echo -e "${GREEN}To connect from another machine:${NC}"
echo -e "  ${YELLOW}export CLAUDE_REMOTE_SERVER=ws://$(hostname -I | awk '{print $1}'):8085${NC}"
echo -e "  ${YELLOW}node client.js <session-id>${NC}"
echo ""
echo -e "${CYAN}Server logs: ${NC}/tmp/claude-remote-server.log"
echo ""
