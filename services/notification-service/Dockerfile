# ============================================================
# CommerceSphere — Notification Service Dockerfile
# ============================================================
# Multi-stage is overkill here (no build step), but we still use
# Alpine for a small image footprint.

FROM node:20-alpine

WORKDIR /app

# Copy package files first for Docker layer caching
COPY package*.json ./

# Install production deps only
RUN npm ci --omit=dev

# Copy application source
COPY . .

EXPOSE 3007

CMD ["node", "src/index.js"]
