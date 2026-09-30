import { catalogIcons } from "./catalog-icons";

export type CatalogServer = {
  name: string;
  description: string;
  category: string;
  url: string;
  docsUrl: string;
  icon: string;
  iconBackground: "light" | "transparent";
};

export const catalogServers: CatalogServer[] = [
  {
    name: "Figma",
    description: "Read design context and work with Figma files.",
    category: "Design",
    url: "https://mcp.figma.com/mcp",
    icon: catalogIcons.figma,
    iconBackground: "transparent",
    docsUrl:
      "https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server",
  },
  {
    name: "GitHub",
    description: "Work with repositories, issues, and pull requests.",
    category: "Developer tools",
    url: "https://api.githubcopilot.com/mcp/",
    icon: catalogIcons.github,
    iconBackground: "light",
    docsUrl:
      "https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/extend-copilot-chat-with-mcp",
  },
  {
    name: "Linear",
    description: "Search and manage issues, projects, and comments.",
    category: "Project management",
    url: "https://mcp.linear.app/mcp",
    icon: catalogIcons.linear,
    iconBackground: "transparent",
    docsUrl: "https://linear.app/docs/mcp",
  },
  {
    name: "Notion",
    description: "Search, read, and update your Notion workspace.",
    category: "Knowledge",
    url: "https://mcp.notion.com/mcp",
    icon: catalogIcons.notion,
    iconBackground: "light",
    docsUrl: "https://www.notion.com/help/notion-mcp",
  },
  {
    name: "Cloudflare",
    description: "Manage Cloudflare services through its hosted MCP server.",
    category: "Developer tools",
    url: "https://mcp.cloudflare.com/mcp",
    icon: catalogIcons.cloudflare,
    iconBackground: "transparent",
    docsUrl:
      "https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/",
  },
  {
    name: "Cloudflare Docs",
    description: "Search current Cloudflare developer documentation.",
    category: "Documentation",
    url: "https://docs.mcp.cloudflare.com/mcp",
    icon: catalogIcons.cloudflare,
    iconBackground: "transparent",
    docsUrl:
      "https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/",
  },
  {
    name: "Sentry",
    description: "Investigate errors, performance, and projects in Sentry.",
    category: "Monitoring",
    url: "https://mcp.sentry.dev/mcp",
    icon: catalogIcons.sentry,
    iconBackground: "transparent",
    docsUrl: "https://mcp.sentry.dev/",
  },
  {
    name: "Vercel",
    description: "Search Vercel docs and manage projects and deployments.",
    category: "Deployment",
    url: "https://mcp.vercel.com",
    icon: catalogIcons.vercel,
    iconBackground: "light",
    docsUrl: "https://vercel.com/docs/agent-resources/vercel-mcp",
  },
];
