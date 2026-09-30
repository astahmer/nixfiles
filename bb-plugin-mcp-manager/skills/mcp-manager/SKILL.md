---
name: mcp-manager
description: Manage global MCP servers in BB, including discovery, enablement, connection health, and remote OAuth. Use when a task needs tools from an MCP server.
---

# MCP Manager

The MCP Manager plugin keeps one global server registry shared across projects and providers on this BB server.

Use **MCP Servers** in the composer **+** menu for quick search, connection, and enable controls. Choose **Manage servers** to open the full configuration page.

## Discover and call tools

1. Call `mcp_list_tools` to list tools from enabled servers.
2. Call `mcp_call_tool` with the exact `serverId` and tool `name` returned by discovery.
3. If a server needs OAuth, ask the user to open MCP Servers in BB and use its Login button. Never request or print their OAuth callback URL or tokens.

Disabled servers do not appear in discovery and cannot be called. Configuration and OAuth credentials are managed in the MCP Servers page.

Remote HTTP servers may include a local launch command. Use **Start & connect** only for commands the user trusts; the command runs on the BB host without a shell, and its environment stays in secret settings. The plugin checks the endpoint before starting a process, then supervises it until **Stop**, disable, removal, or plugin shutdown.
