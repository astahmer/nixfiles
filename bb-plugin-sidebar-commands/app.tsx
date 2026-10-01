import { definePluginApp } from "@get-bb/plugin-sdk/app";

const sidebarPages = [
  { id: "agent-graph", title: "Open Agent Graph", path: "/plugins/agent-graph/graph" },
  { id: "ai-accounts", title: "Open AI Accounts", path: "/plugins/ai-accounts/accounts" },
  { id: "automations", title: "Open Automations", path: "/plugins/automations/automations" },
  { id: "docs", title: "Open Docs", path: "/plugins/docs/docs" },
  { id: "files", title: "Open Files", path: "/plugins/files-editor/files" },
  { id: "hotspot", title: "Open Hotspot", path: "/plugins/hotspot/hotspot" },
  { id: "jujutsu", title: "Open Jujutsu", path: "/plugins/jujutsu/jj" },
  { id: "mcp-manager", title: "Open MCP Servers", path: "/plugins/mcp-manager/servers" },
  { id: "memory-watch", title: "Open Memory Watch", path: "/plugins/memory-watch/memory" },
  {
    id: "plugin-api-docs",
    title: "Open Plugin Guide",
    path: "/plugins/plugin-api-docs/plugin-api",
  },
  {
    id: "plugin-api-tester",
    title: "Open Plugin API Tester",
    path: "/plugins/plugin-api-tester/plugin-api-tester",
  },
  { id: "remote-access", title: "Open Remote access", path: "/settings/plugins/connect" },
  { id: "secret-catalog", title: "Open Secret Catalog", path: "/plugins/secret-catalog/secrets" },
  { id: "sidebar-customization", title: "Customize sidebar", path: "/settings/appearance" },
  { id: "tasks", title: "Open Tasks", path: "/plugins/tasks/tasks" },
  { id: "usage", title: "Open Usage", path: "/plugins/usage/usage" },
] as const;

export default definePluginApp((app) => {
  for (const page of sidebarPages) {
    app.commands.register({
      id: page.id,
      title: page.title,
      run: () => window.location.assign(page.path),
    });
  }
});
