#!/usr/bin/env bash
set -euo pipefail

REPO="tjameswilliams/memcp"
BRANCH="main"
INSTALL_DIR="${MEMCP_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/memcp}"

echo "🧠 MemCP Installer"
echo "=================="
echo ""
echo "Target directory: $INSTALL_DIR"
echo ""

# --- Prerequisites ---
if ! command -v docker &>/dev/null; then
  echo "❌ Docker is required but not found."
  echo "   Install Docker: https://docs.docker.com/get-docker/"
  exit 1
fi
echo "✅ Docker detected: $(docker --version)"

# --- Clone / Download ---
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "📦 Updating existing clone in $INSTALL_DIR..."
  cd "$INSTALL_DIR" && git pull
elif command -v git &>/dev/null; then
  echo "📦 Cloning repository..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "https://github.com/$REPO.git" "$INSTALL_DIR" --branch "$BRANCH" --single-branch
else
  echo "⚠️  Git not found. Downloading archive..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  curl -sL "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" \
    | tar -xz --strip=1 -C "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# --- Generate API Key ---
API_KEY="memcp-$(openssl rand -hex 24)"
echo "MEMCP_API_KEY=$API_KEY" >> .env
echo ""

# --- Build & Start ---
echo "🐳 Building and starting Docker container..."
docker compose up --build -d

echo ""
echo "✅ MemCP is running!"
echo ""
echo "   SSE endpoint:   http://localhost:3001/sse"
echo "   Messages:       http://localhost:3001/messages"
echo ""
echo "🔑 API Key (required for all requests):"
echo "   $API_KEY"
echo ""
echo "   Include it in requests via header:"
echo "     X-API-Key: $API_KEY"
echo "     Authorization: Bearer $API_KEY"
echo ""
echo "   To stop:  cd $INSTALL_DIR && docker compose down"
echo "   To view logs:   cd $INSTALL_DIR && docker compose logs -f"
echo ""
echo "   Claude Desktop config (add to claude_desktop_config.json):"
echo '   { "mcpServers": { "memcp": { "command": "http", "url": "http://localhost:3001/sse" } } }'
echo ""
echo "   To set a new API key:"
echo "     1. Edit $INSTALL_DIR/.env and change MEMCP_API_KEY"
echo "     2. Restart the container: docker compose restart"
echo "   Or generate a new one:"
echo "     cd $INSTALL_DIR && npx ts-node src/cli/index.ts generate-api-key"
