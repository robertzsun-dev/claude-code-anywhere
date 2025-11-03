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

# Remove systemd service (if installed)
echo ""
echo -e "${CYAN}4. Checking for systemd service...${NC}"

SERVICE_NAME="claude-remote-server.service"
SYSTEMD_REMOVED=false

if command -v systemctl &> /dev/null && [ -f "/etc/systemd/system/$SERVICE_NAME" ]; then
    echo -e "${YELLOW}Found systemd service: $SERVICE_NAME${NC}"
    echo ""
    read -p "Remove systemd service? [Y/n] " -n 1 -r
    echo ""

    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        echo -e "${CYAN}Removing systemd service...${NC}"

        # Stop service if running
        if systemctl is-active --quiet "$SERVICE_NAME"; then
            echo -e "${YELLOW}  Stopping service...${NC}"
            sudo systemctl stop "$SERVICE_NAME"
            echo -e "${GREEN}✓ Service stopped${NC}"
        fi

        # Disable service if enabled
        if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
            echo -e "${YELLOW}  Disabling service...${NC}"
            sudo systemctl disable "$SERVICE_NAME"
            echo -e "${GREEN}✓ Service disabled${NC}"
        fi

        # Remove service file
        echo -e "${YELLOW}  Removing service file...${NC}"
        sudo rm -f "/etc/systemd/system/$SERVICE_NAME"

        # Reload systemd
        sudo systemctl daemon-reload

        echo -e "${GREEN}✓ Systemd service removed${NC}"
        SYSTEMD_REMOVED=true
    else
        echo -e "${YELLOW}Skipped systemd service removal${NC}"
        echo -e "${YELLOW}To remove manually later:${NC}"
        echo -e "${YELLOW}  sudo systemctl stop $SERVICE_NAME${NC}"
        echo -e "${YELLOW}  sudo systemctl disable $SERVICE_NAME${NC}"
        echo -e "${YELLOW}  sudo rm /etc/systemd/system/$SERVICE_NAME${NC}"
        echo -e "${YELLOW}  sudo systemctl daemon-reload${NC}"
    fi
else
    echo -e "${YELLOW}No systemd service found${NC}"
fi

# Summary
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║   Uninstallation Complete!                                 ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo -e "${GREEN}The original 'claude' command has been restored.${NC}"
if [ "$SYSTEMD_REMOVED" = true ]; then
    echo -e "${GREEN}The systemd service has been removed.${NC}"
fi
echo ""
echo -e "${CYAN}The config file ${YELLOW}~/.claude-remote.conf${CYAN} was not removed.${NC}"
echo -e "${CYAN}You can delete it manually if you no longer need it.${NC}"
echo ""
echo -e "${CYAN}To reinstall the wrapper:${NC}"
echo -e "  ${YELLOW}cd $(dirname "$0")/.. && ./shim/install.sh${NC}"
echo ""
