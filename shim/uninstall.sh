#!/usr/bin/env bash

# Uninstall script for Claude Code Remote Access seamless wrapper
# This restores the original claude binary

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║   Claude Code Remote Access - Uninstall Seamless Wrapper  ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Find the current claude binary
echo -e "${CYAN}1. Finding claude binary...${NC}"
CLAUDE_BIN=$(which claude 2>/dev/null || echo "")

if [ -z "$CLAUDE_BIN" ]; then
    echo -e "${RED}✗ Claude binary not found in PATH${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Found claude at: $CLAUDE_BIN${NC}"

# Resolve symlinks
CLAUDE_REAL=$(readlink -f "$CLAUDE_BIN" 2>/dev/null || realpath "$CLAUDE_BIN" 2>/dev/null || echo "$CLAUDE_BIN")
echo -e "${GREEN}✓ Real binary: $CLAUDE_REAL${NC}"

# Check if backup exists
CLAUDE_BACKUP="${CLAUDE_REAL}-original"

if [ ! -f "$CLAUDE_BACKUP" ]; then
    echo -e "${YELLOW}! No backup found at $CLAUDE_BACKUP${NC}"
    echo -e "${YELLOW}  Wrapper may not be installed, or was installed differently${NC}"
    exit 0
fi

echo -e "${GREEN}✓ Found backup at: $CLAUDE_BACKUP${NC}"

# Restore the original binary
echo ""
echo -e "${CYAN}2. Restoring original claude binary...${NC}"

if [ -w "$CLAUDE_REAL" ]; then
    sudo_cmd=""
else
    echo -e "${YELLOW}  Need sudo to modify $CLAUDE_REAL${NC}"
    sudo_cmd="sudo"
fi

$sudo_cmd rm -f "$CLAUDE_REAL"
$sudo_cmd mv "$CLAUDE_BACKUP" "$CLAUDE_REAL"

echo -e "${GREEN}✓ Restored original claude binary${NC}"

# Verify
echo ""
echo -e "${CYAN}3. Verifying restoration...${NC}"

if [ -x "$CLAUDE_REAL" ] && [ ! -f "$CLAUDE_BACKUP" ]; then
    echo -e "${GREEN}✓ Uninstallation successful!${NC}"
else
    echo -e "${RED}✗ Verification failed${NC}"
    exit 1
fi

# Summary
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║   Uninstallation Complete!                                 ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}The original 'claude' command has been restored.${NC}"
echo ""
echo -e "${CYAN}The config file ${YELLOW}~/.claude-remote.conf${CYAN} was not removed.${NC}"
echo -e "${CYAN}You can delete it manually if you no longer need it.${NC}"
echo ""
echo -e "${CYAN}To reinstall the wrapper:${NC}"
echo -e "  ${YELLOW}cd $(dirname "$0")/.. && ./shim/install.sh${NC}"
echo ""
