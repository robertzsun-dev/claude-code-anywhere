#!/usr/bin/env bash

# Uninstall script for Claude Code Remote Access seamless wrapper
# This removes the wrapper from /usr/local/bin

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

WRAPPER_PATH="/usr/local/bin/claude"

# Check if wrapper exists
echo -e "${CYAN}1. Checking for wrapper installation...${NC}"

if [ ! -f "$WRAPPER_PATH" ]; then
    echo -e "${YELLOW}! Wrapper not found at $WRAPPER_PATH${NC}"
    echo -e "${YELLOW}  Wrapper may not be installed${NC}"
    echo ""
    echo -e "${CYAN}Current claude location:${NC}"
    which claude 2>/dev/null && echo -e "${GREEN}✓ Found at: $(which claude)${NC}" || echo -e "${RED}✗ Not found in PATH${NC}"
    echo ""
    exit 0
fi

echo -e "${GREEN}✓ Found wrapper at: $WRAPPER_PATH${NC}"

# Check if it's our wrapper (look for our signature)
if grep -q "Claude Code Remote Access Wrapper" "$WRAPPER_PATH" 2>/dev/null; then
    echo -e "${GREEN}✓ Confirmed this is our wrapper${NC}"
else
    echo -e "${YELLOW}! File exists but doesn't appear to be our wrapper${NC}"
    echo -e "${YELLOW}  Proceeding with caution...${NC}"
fi

# Remove the wrapper
echo ""
echo -e "${CYAN}2. Removing wrapper...${NC}"
echo -e "${YELLOW}  This requires sudo access${NC}"

if sudo rm -f "$WRAPPER_PATH"; then
    echo -e "${GREEN}✓ Wrapper removed successfully${NC}"
else
    echo -e "${RED}✗ Failed to remove wrapper${NC}"
    exit 1
fi

# Verify removal
echo ""
echo -e "${CYAN}3. Verifying removal...${NC}"

if [ ! -f "$WRAPPER_PATH" ]; then
    echo -e "${GREEN}✓ Wrapper successfully removed${NC}"

    # Show where claude is now
    CURRENT_CLAUDE=$(which claude 2>/dev/null || echo "")
    if [ -n "$CURRENT_CLAUDE" ]; then
        echo -e "${GREEN}✓ Claude now points to: $CURRENT_CLAUDE${NC}"
    else
        echo -e "${YELLOW}! Warning: 'claude' command not found in PATH${NC}"
        echo -e "${YELLOW}  You may need to reinstall Claude Code${NC}"
    fi
else
    echo -e "${RED}✗ Verification failed - wrapper still exists${NC}"
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
echo -e "${GREEN}The wrapper has been removed from $WRAPPER_PATH${NC}"
echo -e "${GREEN}'claude' command now uses the original binary${NC}"
if [ "$SYSTEMD_REMOVED" = true ]; then
    echo -e "${GREEN}The systemd service has been removed${NC}"
fi
echo ""
echo -e "${CYAN}Notes:${NC}"
echo -e "  - The config file ${YELLOW}~/.claude-remote.conf${NC} was not removed"
echo -e "  - You can delete it manually if you no longer need it"
echo -e "  - The original Claude Code installation is untouched"
echo -e "  - npm updates to Claude Code will work normally"
echo ""
echo -e "${CYAN}To reinstall the wrapper:${NC}"
echo -e "  ${YELLOW}cd $(dirname "$0")/.. && sudo ./shim/install.sh${NC}"
echo ""
