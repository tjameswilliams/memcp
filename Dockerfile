FROM node:20-slim

# Install build dependencies for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Create directory for the SQLite database
RUN mkdir -p /app/data

ENV MEMCP_DB_PATH=/app/data/memcp.db
ENV PORT=3000

EXPOSE 3000

# Default to SSE server for Docker deployments
CMD ["node", "dist/mcp/sse.js"]
