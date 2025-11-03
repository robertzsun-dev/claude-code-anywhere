# Web Client

Browser-based client for Claude Code Remote Access. No installation required!

## Features

- **Zero Installation**: Just open your browser
- **Session List**: See all active sessions at a glance
- **Real-time Output**: Live terminal output streaming
- **Send Input**: Type commands and send to remote session
- **Session Metadata**: View host, user, working directory
- **Auto-refresh**: Session list updates every 10 seconds
- **Modern UI**: Dark theme, responsive design

## Usage

### Accessing the Web Client

1. Start the server:
   ```bash
   npm run server
   ```

2. Open your browser:
   ```
   http://localhost:8085
   ```

3. From another machine:
   ```
   http://192.168.1.100:8085
   ```

### Interface

```
┌────────────────────────────────────────────────────────┐
│ Claude Code Remote Access              Session info    │
├──────────────┬─────────────────────────────────────────┤
│ Active       │                                         │
│ Sessions     │  Terminal Output Area                   │
│              │                                         │
│ • Session 1  │  (Real-time updates)                    │
│ • Session 2  │                                         │
│ • Session 3  │                                         │
│              │                                         │
│              ├─────────────────────────────────────────┤
│              │ [Input box]  [Send] [Clear]            │
├──────────────┴─────────────────────────────────────────┤
│ ● Connected  │  user@hostname                         │
└────────────────────────────────────────────────────────┘
```

### Features

**Session List (Left Sidebar)**
- Shows all active sessions
- Displays session ID (shortened)
- Shows host, working directory, age
- Click to connect

**Terminal Output (Center)**
- Real-time output streaming
- Preserves colors and formatting
- Auto-scrolls to bottom
- Displays session history on connect

**Input Area (Bottom)**
- Type command
- Press Enter or click Send
- Commands sent to remote session
- Clear button to reset output

**Status Bar (Bottom)**
- Connection status (Connected/Disconnected)
- Current session info
- User and host

## Keyboard Shortcuts

- **Enter**: Send input
- **Auto-scroll**: Terminal scrolls to bottom on new output

## Technical Details

### Technology Stack

- **HTML5**: Semantic markup
- **CSS3**: Modern styling, flexbox
- **Vanilla JavaScript**: No frameworks needed
- **WebSocket API**: Real-time communication

### Browser Support

Works in all modern browsers:
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Opera (latest)

### Network

- Uses WebSocket for real-time updates
- Automatically detects `ws://` or `wss://` based on page protocol
- Falls back gracefully on connection errors

## Comparison: Web vs Terminal Client

| Feature | Web Client | Terminal Client |
|---------|-----------|-----------------|
| Installation | None | Requires Node.js |
| Platform | Any (browser) | Linux/macOS/Windows |
| UI | Modern web UI | Blessed TUI |
| Shortcuts | Mouse clicks | Keyboard (Ctrl+I, etc.) |
| Access | Any device | Command line |
| Colors | Preserved | Fully preserved |
| Scrollback | 10,000 lines | 10,000 lines |
| Multiple viewers | ✓ | ✓ |

## Advantages

**Web Client:**
- ✅ No installation required
- ✅ Access from phones/tablets
- ✅ Modern, intuitive UI
- ✅ Easier for non-technical users
- ✅ Works anywhere with browser

**Terminal Client:**
- ✅ Full terminal emulation
- ✅ Better keyboard shortcuts
- ✅ Faster (native)
- ✅ Works offline (local)

## Security Considerations

The web client:
- ⚠️ Served over HTTP by default (use reverse proxy for HTTPS)
- ⚠️ No built-in authentication (add nginx auth)
- ⚠️ WebSocket connections not encrypted (use wss://)

### Production Setup

For production, use nginx with TLS:

```nginx
server {
    listen 443 ssl;
    server_name claude-remote.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Optional: Basic auth
    auth_basic "Claude Remote Access";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://localhost:8085;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

Then access via:
```
https://claude-remote.example.com
```

## Customization

The web client is a single HTML file (`public/index.html`) that you can customize:

### Change Theme

Edit the CSS variables:

```css
body {
    background: #1e1e1e;  /* Background color */
    color: #d4d4d4;       /* Text color */
}

#header {
    background: #2d2d30;  /* Header background */
}
```

### Change Refresh Rate

Edit the JavaScript:

```javascript
// Auto-refresh session list
setInterval(loadSessions, 10000); // Change from 10s to your preference
```

### Add Features

The code is well-commented and easy to extend:
- Add search/filter for sessions
- Add session recording
- Add file upload/download
- Add multi-session view (split screen)

## Troubleshooting

### "Error loading sessions"

- Check server is running: `curl http://localhost:8085/health`
- Check firewall isn't blocking port 8085

### "Connection failed"

- Verify WebSocket URL is correct
- Check browser console for errors (F12)
- Ensure server is accessible from your network

### "No active sessions"

- Start a Claude Code session first
- Refresh the page
- Check server logs

### Terminal output not showing

- Verify you're connected to correct session
- Check wrapper is sending output
- Look for errors in browser console

## Future Enhancements

Potential improvements:
- [ ] xterm.js integration for full terminal emulation
- [ ] Session recording/playback
- [ ] File upload/download
- [ ] Multi-session view (split screen)
- [ ] Dark/light theme toggle
- [ ] Keyboard shortcuts customization
- [ ] Search/filter sessions
- [ ] Mobile-optimized layout
- [ ] PWA (Progressive Web App) support
- [ ] Notification support

## Development

The web client is intentionally simple:
- Single HTML file
- No build process
- No dependencies
- Pure vanilla JavaScript

This makes it:
- Easy to customize
- Fast to load
- Simple to maintain
- Portable

To modify, just edit `public/index.html` and refresh your browser!
