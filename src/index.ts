#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerCityTools } from "./tools/city.js";
import { registerGeoTools } from "./tools/geo.js";
import { registerLineTools } from "./tools/lines.js";
import { registerSearchTools } from "./tools/search.js";
import { registerStopTools } from "./tools/stops.js";
import { registerTransitTools } from "./tools/transit.js";

const server = new McpServer({
  name: "chelaile-mcp-server",
  version: "1.0.0",
});

registerCityTools(server);
registerGeoTools(server);
registerSearchTools(server);
registerStopTools(server);
registerLineTools(server);
registerTransitTools(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("chelaile-mcp-server running on stdio");
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
