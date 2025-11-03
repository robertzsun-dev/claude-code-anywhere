# Deployment Examples

This directory contains various deployment configurations for Claude Code Remote Access.

## Contents

- `config.example.sh` - Shell configuration with aliases and environment variables
- `claude-remote.service` - systemd service file for Linux
- `Dockerfile` - Docker container for the server
- `docker-compose.yml` - Docker Compose for full stack deployment
- `nginx.conf` - Nginx reverse proxy with TLS/WebSocket support

## systemd Service (Linux)

Run the server as a system service:

```bash
# Copy service file
sudo cp claude-remote.service /etc/systemd/system/claude-remote@.service

# Enable and start for your user
sudo systemctl enable claude-remote@$USER.service
sudo systemctl start claude-remote@$USER.service

# Check status
sudo systemctl status claude-remote@$USER.service

# View logs
sudo journalctl -u claude-remote@$USER.service -f
```

## Docker Deployment

### Build and run with Docker

```bash
# Build image
docker build -f examples/Dockerfile -t claude-remote-server .

# Run container
docker run -d \
  --name claude-remote \
  -p 8085:8085 \
  -e NODE_ENV=production \
  claude-remote-server

# View logs
docker logs -f claude-remote
```

### Docker Compose (with Nginx)

```bash
cd examples

# Generate self-signed SSL certificate (for testing)
mkdir -p ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ssl/key.pem -out ssl/cert.pem \
  -subj "/CN=localhost"

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

Access via:
- WebSocket: `wss://localhost`
- HTTP API: `https://localhost/health`

## Configuration

### Shell Configuration

Source the example config in your shell:

```bash
# Copy to your home directory
cp config.example.sh ~/.claude-remote.conf

# Add to ~/.bashrc or ~/.zshrc
echo "source ~/.claude-remote.conf" >> ~/.bashrc

# Reload shell
source ~/.bashrc
```

### Environment Variables

All components respect these environment variables:

**Server:**
- `HOST` - Bind address (default: `0.0.0.0`)
- `PORT` - Port number (default: `8085`)
- `NODE_ENV` - Environment (development/production)

**Wrapper & Client:**
- `CLAUDE_REMOTE_SERVER` - Server WebSocket URL (default: `ws://localhost:8085`)
- `CLAUDE_CMD` - Claude Code command path (default: `claude`)

## Production Deployment

For production, consider:

1. **Use TLS/SSL**: Always use `wss://` (WebSocket Secure)
2. **Reverse Proxy**: Use nginx/Caddy for TLS termination
3. **Authentication**: Add JWT or API key authentication
4. **Firewall**: Restrict access to known IPs
5. **Monitoring**: Set up health checks and alerts
6. **Backups**: Back up session data if persistence is added

### Reverse Proxy with Let's Encrypt

```nginx
# /etc/nginx/sites-available/claude-remote

server {
    listen 443 ssl http2;
    server_name claude.example.com;

    # Let's Encrypt SSL
    ssl_certificate /etc/letsencrypt/live/claude.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/claude.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:8085;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/claude-remote /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Get Let's Encrypt certificate
sudo certbot --nginx -d claude.example.com
```

## Cloud Deployment

### AWS EC2

```bash
# Launch EC2 instance (Ubuntu)
# Open port 8085 in Security Group

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone repo and install
git clone <your-repo> claude-code-anywhere
cd claude-code-anywhere
npm install

# Run with systemd
sudo cp examples/claude-remote.service /etc/systemd/system/claude-remote@ubuntu.service
sudo systemctl enable claude-remote@ubuntu.service
sudo systemctl start claude-remote@ubuntu.service
```

### DigitalOcean

Use the Docker deployment:

```bash
# Create Droplet with Docker
# SSH into droplet

git clone <your-repo> claude-code-anywhere
cd claude-code-anywhere/examples

# Run with Docker Compose
docker-compose up -d
```

### Cloudflare Tunnel (Zero Trust)

```bash
# Install cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

# Authenticate
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create claude-remote

# Configure tunnel (~/.cloudflared/config.yml)
cat > ~/.cloudflared/config.yml <<EOF
tunnel: <tunnel-id>
credentials-file: /home/$USER/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: claude.example.com
    service: ws://localhost:8085
  - service: http_status:404
EOF

# Run tunnel
cloudflared tunnel run claude-remote
```

## Security Hardening

### Firewall Rules (UFW)

```bash
# Allow only from specific IP
sudo ufw allow from 192.168.1.0/24 to any port 8085

# Or allow from VPN subnet
sudo ufw allow from 10.8.0.0/24 to any port 8085
```

### IP Whitelisting (nginx)

```nginx
location / {
    # Allow specific IPs
    allow 192.168.1.0/24;
    allow 10.8.0.0/24;
    deny all;

    proxy_pass http://localhost:8085;
    # ... rest of config
}
```

### Rate Limiting

Add to `server.js`:

```javascript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

// Apply to HTTP endpoints
app.use(limiter);
```

## Monitoring

### Health Check Script

```bash
#!/bin/bash
# /usr/local/bin/check-claude-remote.sh

if curl -sf http://localhost:8085/health > /dev/null; then
    exit 0
else
    echo "Health check failed"
    # Restart service
    systemctl restart claude-remote@$USER.service
    exit 1
fi
```

### Cron Job

```bash
# Add to crontab
*/5 * * * * /usr/local/bin/check-claude-remote.sh
```

### Prometheus Metrics (future enhancement)

Could add metrics endpoint to track:
- Active sessions
- Connected clients
- WebSocket message rate
- Session duration
- Error rates
