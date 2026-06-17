#!/usr/bin/env node

import { runCli } from "./cli.js";
import { startMcpServer } from "./server.js";

const [command, ...rest] = process.argv.slice(2);

if (!command || command === "mcp") {
  await startMcpServer();
} else {
  const exitCode = await runCli([command, ...rest]);
  process.exitCode = exitCode;
}
