#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const baseEnv = {
  ...process.env,
  OPENCLAW_A2UI_SKIP_MISSING: "1",
};

const nodeCmd = process.execPath;
const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const commands = [
  { command: nodeCmd, args: ["scripts/tsdown-build.mjs"] },
  { command: nodeCmd, args: ["scripts/runtime-postbuild.mjs"] },
  { command: nodeCmd, args: ["scripts/build-stamp.mjs"] },
  { command: pnpmCmd, args: ["build:plugin-sdk:dts"], shell: true },
  { command: nodeCmd, args: ["--import", "tsx", "scripts/write-plugin-sdk-entry-dts.ts"] },
  { command: nodeCmd, args: ["--import", "tsx", "scripts/canvas-a2ui-copy.ts"] },
  { command: nodeCmd, args: ["--import", "tsx", "scripts/copy-hook-metadata.ts"] },
  { command: nodeCmd, args: ["--import", "tsx", "scripts/copy-export-html-templates.ts"] },
  { command: nodeCmd, args: ["--import", "tsx", "scripts/write-build-info.ts"] },
  { command: nodeCmd, args: ["--import", "tsx", "scripts/write-cli-startup-metadata.ts"] },
  { command: nodeCmd, args: ["--import", "tsx", "scripts/write-cli-compat.ts"] },
];

for (const { command, args, shell = false } of commands) {
  console.log(`> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: baseEnv,
    shell,
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
