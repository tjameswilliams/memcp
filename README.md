# MemCP: Cross-Agent Communication Memory Server

MemCP is an MCP (Model Context Protocol) server designed to facilitate communication and memory sharing across different agents, harnesses, and projects. It provides a durable storage layer for conversations, enabling semantic retrieval and context sharing.

## Features

- **Durable Storage**: Uses a pluggable storage architecture. SQLite is provided as the default, zero-config option.
- **Semantic Search**: Integration with both local (Transformers.js) and high-quality (OpenAI-compatible) embedding providers for vector-based retrieval.
- **Intelligent Summarization**: Supports both agent-provided summaries and automatic summarization via LLM.
- **Full Context Retrieval**: Tools to retrieve partial or full conversation histories with pagination.
- **CLI Management**: A built-in CLI for installation, configuration, and monitoring.

## Installation

### Prerequisites
- Node.js (Latest LTS recommended)
- npm

### Setup
1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd memcp
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```

### Integration with Claude Desktop
Use the CLI to automatically configure the server in your Claude Desktop config:
```bash
npm run cli install
```
Restart Claude Desktop after installation.

## Configuration

You can configure the embedding and summarization providers using the CLI:

```bash
# Set to 'local' for on-device embeddings (default) or 'openai' for cloud-based
npm run cli config -- --provider openai --key YOUR_API_KEY
```

### Environment Variables
Alternatively, you can set these in a `.env` file:
- `MEMCP_EMBEDDING_PROVIDER`: `local` or `openai`
- `MEMCP_EMBEDDING_KEY`: Your API key (required for `openai`)
- `MEMCP_EMBEDDING_URL`: Custom endpoint for OpenAI-compatible APIs
- `MEMCP_EMBEDDING_MODEL`: Model name (e.g., `text-embedding-3-small`)
- `MEMCP_API_KEY`: API key for server authentication (leave empty for open access)

## MCP Tools

The server exposes the following tools to agents:

- `store_conversation`: Saves a conversation with metadata. Supports `summary` (manual) or `autoSummarize` (automatic).
- `search_conversations`: Performs a semantic search across stored conversation summaries.
- `get_context`: Retrieves messages for a specific conversation ID with optional pagination.
- `update_conversation`: Updates metadata or the summary of an existing conversation.

## CLI Reference

- `npm run cli install`: Registers the server with Claude Desktop.
- `npm run cli config`: Configures embedding/summarization providers.
- `npm run cli generate-api-key`: Generates a new API key and saves it to `.env`.
- `npm run cli monitor`: Lists stored conversations.
- `npm run cli list-messages <conversationId>`: Prints the history of a specific conversation.

## One-Line Install

Spin up a fully containerized MemCP server with a single command — works on macOS and Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/tjameswilliams/memcp/main/install.sh | bash
```

This will:
1.  Detect Docker (aborts if missing)
2.  Clone the repo into `~/.local/share/memcp`
3.  Auto-generate an API key and save it to `.env`
4.  Build the Docker image
5.  Start the server on `http://localhost:3001`

> **⚠️ Security**: The install script generates a unique API key and locks down the server. All requests must include `X-API-Key: <key>` or `Authorization: Bearer <key>`. The key is printed during install — save it securely.

To stop: `cd ~/.local/share/memcp && docker compose down`

### Custom install directory
```bash
MEMCP_DIR=/opt/memcp curl -fsSL https://raw.githubusercontent.com/tjameswilliams/memcp/main/install.sh | bash
```

---

## Docker Deployment

MemCP can be easily deployed as a Docker container. This is the recommended method for production or sandboxed environments.

### Prerequisites
- Docker
- Docker Compose

### Quick Start with Docker Compose

The easiest way to deploy MemCP is using the provided `docker-compose.yml`.

1. Create a `docker-compose.yml` in the project root (or use the default one provided):
   ```yaml
   services:
     memcp:
       build: .
       ports:
         - "3001:3000"
       volumes:
         - memcp-data:/app/data
    environment:
          - MEMCP_DB_PATH=/app/data/memcp.db
          - MEMCP_EMBEDDING_PROVIDER=local  # or 'openai'
          # - MEMCP_API_KEY=memcp-your-key  # Lock down with API key auth
          # - MEMCP_EMBEDDING_KEY=sk-...    # Required if using 'openai'
          # - MEMCP_EMBEDDING_URL=https://api.openai.com/v1
          # - MEMCP_EMBEDDING_MODEL=text-embedding-3-small

   volumes:
     memcp-data:
   ```

2. Build and start the container:
   ```bash
   docker-compose up -d --build
   ```

3. The server will be available at `http://localhost:3001`.
   - **SSE Endpoint**: `http://localhost:3001/sse`
   - **Messages Endpoint**: `http://localhost:3001/messages`

### Running with Docker Run

If you prefer using Docker directly:

```bash
docker run -d \
  --name memcp \
   -p 3001:3000 \
  -v memcp-data:/app/data \
  -e MEMCP_DB_PATH=/app/data/memcp.db \
  -e MEMCP_EMBEDDING_PROVIDER=local \
  memcp:latest
```

## 🔑 API Key Authentication

When deploying MemCP to a network-accessible server (EC2, etc.), you should enable API key authentication to prevent unauthorized access.

The server reads the `MEMCP_API_KEY` environment variable. If set, all requests **except** `/health` must include the key via one of these headers:

- `X-API-Key: <your-key>`
- `Authorization: Bearer <your-key>`

### Auto-generation during install

The one-line install script (`install.sh`) automatically generates a random API key and saves it to `.env`.

### Setting a custom API key

```bash
# Generate a new random key and save to .env
npm run cli generate-api-key

# Or set a specific key
npm run cli generate-api-key -- --set my-custom-key

# Just print a key without writing .env
npm run cli generate-api-key -- --no-env
```

Or manually set `MEMCP_API_KEY` in your `.env` file. Leave it **empty** or **unset** to keep the server open (no authentication).

### Using the API key with MCP clients

When connecting to the SSE server, include the header in your client configuration:

```json
{
  "mcpServers": {
    "memcp": {
      "command": "http",
      "url": "http://your-server:3001/sse",
      "headers": {
        "x-api-key": "memcp-your-generated-key-here"
      }
    }
  }
}
```

### Environment Variables (Docker)

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | The port the server listens on | `3000` |
| `MEMCP_DB_PATH` | Absolute path to the SQLite database inside the container | `/app/data/memcp.db` |
| `MEMCP_EMBEDDING_PROVIDER` | Embedding provider to use (`local` or `openai`) | `local` |
| `MEMCP_EMBEDDING_KEY` | API key for OpenAI or compatible provider | - |
| `MEMCP_EMBEDDING_URL` | Custom base URL for OpenAI-compatible APIs | - |
| `MEMCP_EMBEDDING_MODEL` | Model to use for embeddings and summarization | - |
| `MEMCP_API_KEY` | API key for server authentication (empty = open access) | - |

### Configuration with Claude Desktop

If running MemCP via Docker, update your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS) to point to the Dockerized server:

```json
{
  "mcpServers": {
    "memcp": {
      "command": "http",
      "url": "http://localhost:3001/sse"
    }
  }
}
```

## Architecture

- `src/core`: Core interfaces and managers for storage, embeddings, and summarization.
- `src/providers`: Implementations of the core interfaces (SQLite, OpenAI, Transformers.js).
- `src/mcp`: MCP server implementation and tool definitions.
- `src/cli`: Management CLI harness.
