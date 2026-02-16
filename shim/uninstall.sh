#!/usr/bin/env bash

# Uninstall script for Claude Code API Interceptor shim
# Removes the shim from /usr/local/bin

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║   Claude Code API Interceptor - Uninstall                  ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

WRAPPER_PATH="/usr/local/bin/claude"

# Check if shim exists
echo -e "${CYAN}1. Checking for shim installation...${NC}"

if [ ! -f "$WRAPPER_PATH" ]; then
    echo -e "${YELLOW}! Shim not found at $WRAPPER_PATH${NC}"
    echo -e "${YELLOW}  Shim may not be installed${NC}"
    echo ""
    echo -e "${CYAN}Current claude location:${NC}"
    which claude 2>/dev/null && echo -e "${GREEN}  Found at: $(which claude)${NC}" || echo -e "${RED}  Not found in PATH${NC}"
    echo ""
    exit 0
fi

echo -e "${GREEN}  Found shim at: $WRAPPER_PATH${NC}"

# Check if it's our shim (look for our signature)
if grep -q "Interceptor Shim" "$WRAPPER_PATH" 2>/dev/null || grep -q "CLAUDE_INTERCEPT_SERVER" "$WRAPPER_PATH" 2>/dev/null; then
    echo -e "${GREEN}  Confirmed this is our interceptor shim${NC}"
elif grep -q "Claude Code Remote Access" "$WRAPPER_PATH" 2>/dev/null; then
    echo -e "${GREEN}  Confirmed this is a Claude Remote Access shim${NC}"
else
    echo -e "${YELLOW}! File exists but doesn't appear to be our shim${NC}"
    echo -e "${YELLOW}  Proceeding with caution...${NC}"
fi

# Remove the shim
echo ""
echo -e "${CYAN}2. Removing shim...${NC}"
echo -e "${YELLOW}  This requires sudo access${NC}"

if sudo rm -f "$WRAPPER_PATH"; then
    echo -e "${GREEN}  Shim removed successfully${NC}"
else
    echo -e "${RED}  Failed to remove shim${NC}"
    exit 1
fi

# Verify removal
echo ""
echo -e "${CYAN}3. Verifying removal...${NC}"

if [ ! -f "$WRAPPER_PATH" ]; then
    echo -e "${GREEN}  Shim successfully removed${NC}"

    # Show where claude is now
    CURRENT_CLAUDE=$(which claude 2>/dev/null || echo "")
    if [ -n "$CURRENT_CLAUDE" ]; then
        echo -e "${GREEN}  Claude now points to: $CURRENT_CLAUDE${NC}"
    else
        echo -e "${YELLOW}! Warning: 'claude' command not found in PATH${NC}"
        echo -e "${YELLOW}  You may need to reinstall Claude Code${NC}"
    fi
else
    echo -e "${RED}  Verification failed - shim still exists${NC}"
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
            echo -e "${GREEN}  Service stopped${NC}"
        fi

        # Disable service if enabled
        if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
            echo -e "${YELLOW}  Disabling service...${NC}"
            sudo systemctl disable "$SERVICE_NAME"
            echo -e "${GREEN}  Service disabled${NC}"
        fi

        # Remove service file
        echo -e "${YELLOW}  Removing service file...${NC}"
        sudo rm -f "/etc/systemd/system/$SERVICE_NAME"
        sudo systemctl daemon-reload

        echo -e "${GREEN}  Systemd service removed${NC}"
        SYSTEMD_REMOVED=true
    else
        echo -e "${YELLOW}Skipped systemd service removal${NC}"
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
echo -e "${GREEN}The interceptor shim has been removed from $WRAPPER_PATH${NC}"
echo -e "${GREEN}'claude' command now uses the original binary directly${NC}"
if [ "$SYSTEMD_REMOVED" = true ]; then
    echo -e "${GREEN}The systemd service has been removed${NC}"
fi
echo ""
echo -e "${CYAN}Notes:${NC}"
echo -e "  - The config file ${YELLOW}~/.claude-remote.conf${NC} was not removed"
echo -e "  - You can delete it manually if you no longer need it"
echo -e "  - The original Claude Code installation is untouched"
echo ""
echo -e "${CYAN}To reinstall:${NC}"
echo -e "  ${YELLOW}cd $(dirname "$0") && ./install.sh${NC}"
echo ""
