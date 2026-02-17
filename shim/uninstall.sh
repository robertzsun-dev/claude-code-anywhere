#!/usr/bin/env bash

# Uninstall script for Claude Code API Interceptor shim
# Removes the shim from ~/.claude-shim/bin and cleans up config

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

SHIM_DIR="$HOME/.claude-shim/bin"
SHIM_PATH="${SHIM_DIR}/claude"

# Step 1: Find shim
echo -e "${CYAN}1. Checking for shim installation...${NC}"

FOUND_SHIM=false

# Check the standard location
if [ -f "$SHIM_PATH" ] && grep -q "Interceptor Shim" "$SHIM_PATH" 2>/dev/null; then
    echo -e "${GREEN}  Found shim at: $SHIM_PATH${NC}"
    FOUND_SHIM=true
fi

# Also scan PATH for any shim (in case it was installed elsewhere)
while IFS= read -r candidate; do
    if [ "$candidate" != "$SHIM_PATH" ] && [ -f "$candidate" ] && grep -q "Interceptor Shim" "$candidate" 2>/dev/null; then
        echo -e "${YELLOW}  Also found shim at: $candidate${NC}"
    fi
done < <(which -a claude 2>/dev/null)

# Check legacy location
LEGACY_SHIM=""
if [ -f "/usr/local/bin/claude" ]; then
    if grep -q "Interceptor Shim\|CLAUDE_INTERCEPT_SERVER" "/usr/local/bin/claude" 2>/dev/null; then
        echo -e "${YELLOW}  Found legacy shim at: /usr/local/bin/claude${NC}"
        LEGACY_SHIM="/usr/local/bin/claude"
        FOUND_SHIM=true
    fi
fi

if [ "$FOUND_SHIM" = false ]; then
    echo -e "${YELLOW}! No interceptor shim found${NC}"
    echo ""
    echo -e "${CYAN}Checked:${NC}"
    echo "  $SHIM_PATH"
    echo "  /usr/local/bin/claude"
    which -a claude 2>/dev/null | while read -r c; do echo "  $c"; done
    echo ""
    exit 0
fi

# Step 2: Remove shim
echo ""
echo -e "${CYAN}2. Removing shim...${NC}"

if [ -f "$SHIM_PATH" ]; then
    rm -f "$SHIM_PATH"
    echo -e "${GREEN}  Removed: $SHIM_PATH${NC}"

    # Remove the shim directory if empty
    rmdir "$SHIM_DIR" 2>/dev/null && rmdir "$(dirname "$SHIM_DIR")" 2>/dev/null || true
    if [ ! -d "$SHIM_DIR" ]; then
        echo -e "${GREEN}  Removed empty directory: $SHIM_DIR${NC}"
    fi
fi

if [ -n "$LEGACY_SHIM" ]; then
    echo -e "${YELLOW}  Removing legacy shim (requires sudo)...${NC}"
    sudo rm -f "$LEGACY_SHIM"
    echo -e "${GREEN}  Removed: $LEGACY_SHIM${NC}"
fi

# Also clean up any claude-original backups from previous approach
for dir in "/usr/local/bin" "$HOME/.local/bin"; do
    if [ -f "${dir}/claude-original" ] || [ -L "${dir}/claude-original" ]; then
        # Verify it's actually a claude binary before doing anything
        local_resolved=$(readlink -f "${dir}/claude-original" 2>/dev/null || echo "${dir}/claude-original")
        is_claude=false
        if file "$local_resolved" 2>/dev/null | grep -q "ELF\|Mach-O"; then
            is_claude=true
        elif head -1 "$local_resolved" 2>/dev/null | grep -q "node\|bun\|javascript"; then
            is_claude=true
        fi

        if [ "$is_claude" = false ]; then
            echo -e "${YELLOW}  Found ${dir}/claude-original but it doesn't look like a claude binary, skipping${NC}"
            continue
        fi

        echo -e "${YELLOW}  Found leftover backup: ${dir}/claude-original${NC}"
        if [ ! -f "${dir}/claude" ] && [ ! -L "${dir}/claude" ]; then
            echo -e "${YELLOW}  Restoring ${dir}/claude from backup...${NC}"
            if [[ "$dir" == "$HOME"* ]]; then
                mv "${dir}/claude-original" "${dir}/claude"
            else
                sudo mv "${dir}/claude-original" "${dir}/claude"
            fi
            echo -e "${GREEN}  Restored${NC}"
        else
            read -p "  Remove leftover backup? [Y/n] " -n 1 -r
            echo ""
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                if [[ "$dir" == "$HOME"* ]]; then
                    rm -f "${dir}/claude-original"
                else
                    sudo rm -f "${dir}/claude-original"
                fi
                echo -e "${GREEN}  Removed${NC}"
            fi
        fi
    fi
done

# Step 3: Verify
echo ""
echo -e "${CYAN}3. Verifying removal...${NC}"

CURRENT_CLAUDE=$(which claude 2>/dev/null || echo "")
if [ -n "$CURRENT_CLAUDE" ]; then
    if grep -q "Interceptor Shim" "$CURRENT_CLAUDE" 2>/dev/null; then
        echo -e "${RED}  Warning: 'which claude' still points to a shim: $CURRENT_CLAUDE${NC}"
    else
        echo -e "${GREEN}  Claude now points to: $CURRENT_CLAUDE${NC}"
        if file "$CURRENT_CLAUDE" 2>/dev/null | grep -q "ELF\|Mach-O"; then
            echo -e "${GREEN}  Confirmed: native binary${NC}"
        elif [ -L "$CURRENT_CLAUDE" ]; then
            echo -e "${GREEN}  Symlink → $(readlink -f "$CURRENT_CLAUDE")${NC}"
        fi
    fi
else
    echo -e "${YELLOW}! Warning: 'claude' command not found in PATH${NC}"
    echo -e "${YELLOW}  You may need to reinstall Claude Code${NC}"
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

        if systemctl is-active --quiet "$SERVICE_NAME"; then
            echo -e "${YELLOW}  Stopping service...${NC}"
            sudo systemctl stop "$SERVICE_NAME"
            echo -e "${GREEN}  Service stopped${NC}"
        fi

        if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
            echo -e "${YELLOW}  Disabling service...${NC}"
            sudo systemctl disable "$SERVICE_NAME"
            echo -e "${GREEN}  Service disabled${NC}"
        fi

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
echo -e "${GREEN}'claude' command now uses the original binary directly${NC}"
if [ "$SYSTEMD_REMOVED" = true ]; then
    echo -e "${GREEN}The systemd service has been removed${NC}"
fi
echo ""
echo -e "${CYAN}Notes:${NC}"
echo -e "  - The config file ${YELLOW}~/.claude-remote.conf${NC} was not removed"
echo -e "  - The PATH entry in your shell rc may still reference $SHIM_DIR"
echo -e "  - You can clean these up manually if desired"
echo -e "  - The original Claude Code installation was never modified"
echo ""
echo -e "${CYAN}To reinstall:${NC}"
echo -e "  ${YELLOW}cd $(dirname "$0") && ./install.sh${NC}"
echo ""
