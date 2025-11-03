FROM node:18-alpine

# Install dependencies for node-pty
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    bash \
    curl

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY server.js ./
COPY wrapper.js ./
COPY client.js ./

# Create log directory
RUN mkdir -p /var/log/claude-remote

# Expose WebSocket port
EXPOSE 8085

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8085/health || exit 1

# Run server
CMD ["node", "server.js"]
