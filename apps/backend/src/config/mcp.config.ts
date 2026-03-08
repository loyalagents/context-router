import { registerAs } from "@nestjs/config";

export default registerAs("mcp", () => ({
  // Server Identity
  server: {
    name: "context-router-mcp",
    version: "1.0.0",
    description: "MCP server for user preferences management",
  },

  // HTTP transport configuration
  httpTransport: {
    enabled: process.env.MCP_HTTP_ENABLED !== "false",
  },

  // Feature configuration
  tools: {
    preferences: {
      enabled: process.env.MCP_TOOLS_PREFERENCES_ENABLED !== "false",
      maxSearchResults: parseInt(
        process.env.MCP_TOOLS_PREFERENCES_MAX_SEARCH_RESULTS || "100",
        10,
      ),
    },
  },

  resources: {
    schema: {
      enabled: process.env.MCP_RESOURCES_SCHEMA_ENABLED !== "false",
    },
  },
}));
