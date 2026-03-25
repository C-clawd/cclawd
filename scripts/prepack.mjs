#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const nodeCmd = process.execPath;
const commands = [
  { command: nodeCmd, args: ["scripts/build-skip-a2ui.mjs"] },
  { command: nodeCmd, args: ["scripts/ui.js", "build"] },
];

for (const { command, args } of commands) {
  console.log(`> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
