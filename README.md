# alexa-mcp

MCP server for Amazon Alexa -- manage your Alexa shopping list from any MCP client (Claude, etc.).

Built on the [Model Context Protocol](https://modelcontextprotocol.io) and the [alexa-remote2](https://github.com/Apollon77/alexa-remote2) library.

## Tools

| Tool | Description |
|------|-------------|
| `authenticate` | Authenticate with your Amazon account. Uses a saved cookie if available, otherwise starts a browser login proxy and returns a URL to open. |
| `list_items` | Get items from your Alexa shopping list. Optionally include completed items. |
| `add_items` | Add one or more items to your Alexa shopping list. |
| `delete_items` | Delete items from your Alexa shopping list by name (case-insensitive match). |
| `update_item` | Update an item on your shopping list -- rename it and/or change its completion status. |
| `complete_items` | Mark items as completed on your Alexa shopping list by name (case-insensitive match). |
| `check_status` | Check whether the server is authenticated and show current configuration. |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COOKIE_PATH` | `~/.alexa-mcp/cookie.json` | Path to the persisted Alexa authentication cookie |
| `AMAZON_PAGE` | `amazon.com` | Amazon domain to authenticate against |
| `PROXY_PORT` | `3001` | Port for the browser login proxy (used during initial authentication) |
| `ALEXA_COOKIE` | -- | Pre-seeded cookie JSON (alternative to `COOKIE_PATH` file) |

## Setup

```bash
npm ci
```

## Usage

### Stdio mode (direct)

```bash
node dist/index.js
```

### HTTP mode (via mcp-proxy)

```bash
mcp-proxy --port 8005 -- node dist/index.js
```

### Claude Desktop configuration

Add this to your Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "alexa": {
      "command": "node",
      "args": ["/path/to/alexa-mcp/dist/index.js"],
      "env": {
        "COOKIE_PATH": "/path/to/cookie.json"
      }
    }
  }
}
```

## Authentication

On first run, the `authenticate` tool starts a local proxy server. Open the returned URL in your browser and log in to your Amazon account. The cookie is saved to `COOKIE_PATH` and reused for subsequent sessions.

If you already have a cookie (e.g., from a previous session or another machine), you can either:
- Place the JSON file at `COOKIE_PATH`
- Set the `ALEXA_COOKIE` environment variable with the JSON content

## Patches

This project includes a patch for `alexa-cookie2` (applied automatically via `patch-package` on `npm ci`) that improves resilience when the Amazon user-data endpoint returns unexpected responses.

## License

MIT -- see [LICENSE](LICENSE).
