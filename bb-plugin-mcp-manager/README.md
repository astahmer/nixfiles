# MCP Manager

Manage one global MCP server registry from BB. Remote Streamable HTTP, legacy SSE, and local stdio servers feed a provider-neutral MCP bridge, so agents can discover and call tools from any project.

## Features

- Add remote Streamable HTTP or legacy SSE servers by name and endpoint, or local servers by command, arguments, working directory, and environment.
- Edit a registered server's name, transport, endpoint, command, arguments, working directory, headers, or environment. Saved secrets stay hidden and are kept unless explicitly cleared or replaced.
- Optionally attach a local start command to a remote server. **Start & connect** checks the endpoint first, runs the command without a shell only when needed, and waits up to 30 seconds for readiness. **Stop**, disable, remove, or reload ends the process started by the plugin.
- Authenticate remote servers with the official MCP OAuth client flow, including discovery, dynamic client registration, PKCE, callback validation, and token refresh.
- Enable and disable each server. Disabled servers are excluded from discovery and calls.
- Browse provider-hosted MCP endpoints for Figma, GitHub, Linear, Notion, Cloudflare, Sentry, and Vercel, with branded icons and links to provider docs, or add a custom remote URL or local command from the composer.
- Keep endpoint credentials, process environment values, OAuth tokens, PKCE verifiers, and discovery state in BB secret settings. The UI receives only display-safe server fields.
- Expose enabled MCP tools through the `mcp_list_tools` and `mcp_call_tool` agent tools.

The registry is global to this BB server and shared across its projects and providers. Changes affect calls immediately; an already running provider session may need a new turn or session restart before the two bridge tools appear.

## Use

Choose **MCP Servers** from the composer **+** menu to search servers, connect or disconnect them, and enable or disable them. The search stays at the top while the server list scrolls. **Add MCP** opens the provider-hosted catalog; **Custom MCP** accepts a remote URL or local command. Catalog entries link to the provider's own setup documentation. The public MCP Registry link is for broader discovery; it is an open directory, not a reputation or security review. **Manage** opens the full editor. The same **MCP Servers** page is available in the sidebar: choose **Remote HTTP**, **Remote SSE (legacy)**, or **Local command**, then add a server. Prefer Remote HTTP when the server supports both transports. Local command servers run their configured executable when connected and stop when disconnected or disabled. For an HTTP server that must be launched locally, add a start command and use **Start & connect**. OAuth servers show **Login** when authorization is required. Use **Edit** to change the saved configuration.

For an agent, call `mcp_list_tools` to discover enabled tools, then `mcp_call_tool` with the returned `serverId` and tool name.

The plugin runs local commands as configured under the BB server account. Only add commands and remote endpoints you trust. Server arguments and environment values are passed directly; no shell string is evaluated. A managed HTTP process remains attached to BB and stops when the plugin reloads or shuts down.

## Development

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm fmt:check
bb plugin build .
```
