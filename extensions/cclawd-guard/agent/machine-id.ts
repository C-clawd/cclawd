import os from "node:os";
import { createHash } from "node:crypto";
import { networkInterfaces } from "node:os";

export type MachineInfo = {
  machineId: string;
  machineName: string;
};

let cachedMachineInfo: MachineInfo | null = null;

/**
 * Build a stable per-device ID from hostname + first non-internal MAC.
 * Hashing avoids sending raw MAC addresses.
 */
export function getMachineInfo(): MachineInfo {
  if (cachedMachineInfo) return cachedMachineInfo;

  const machineName = os.hostname();
  const interfaces = networkInterfaces();
  let mac = "";

  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const info of iface) {
      if (!info.internal && info.mac && info.mac !== "00:00:00:00:00:00") {
        mac = info.mac;
        break;
      }
    }
    if (mac) break;
  }

  const input = `${machineName}:${mac || "unknown"}`;
  const machineId = createHash("sha256").update(input).digest("hex").slice(0, 16);
  cachedMachineInfo = { machineId, machineName };
  return cachedMachineInfo;
}
