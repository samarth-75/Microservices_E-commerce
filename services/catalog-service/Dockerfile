# ---- Stage 1: Install dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# ---- Stage 2: Run ----
FROM node:20-alpine
WORKDIR /app
# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Create uploads directory owned by appuser (for image storage in dev)
RUN mkdir -p uploads/products && chown -R appuser:appgroup uploads
USER appuser
EXPOSE 3002
CMD ["node", "src/index.js"]
