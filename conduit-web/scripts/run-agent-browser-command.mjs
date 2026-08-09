#!/usr/bin/env node
import {
  validateLocalAgentBrowserCommand,
} from "./agent-browser-command-policy.mjs";
import { spawnLocalAgentBrowser } from "./agent-browser-runtime.mjs";

const args = process.argv.slice(2);
try {
  validateLocalAgentBrowserCommand(args);
} catch (error) {
  console.error(`Conduit local agent-browser: ${error.message}`);
  process.exit(2);
}

let result;
try {
  result = spawnLocalAgentBrowser(args);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
if (result.status !== null) process.exit(result.status);
process.exit(1);
