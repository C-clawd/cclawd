import os from "node:os";

export function getLocalIpAddress(): string {
  if (process.env.MFA_AUTH_HOST) {
    return process.env.MFA_AUTH_HOST;
  }

  const interfaces = os.networkInterfaces();

  const interfaceNames = Object.keys(interfaces);

  const preferredPatterns = ["以太网", "Ethernet", "eth"];
  const skipPatterns = [
    "Clash",
    "VPN",
    "TAP",
    "TUN",
    "Virtual",
    "Loopback",
    "Hyper-V",
    "WSL",
    "Docker",
  ];

  for (const pattern of preferredPatterns) {
    for (const ifaceName of interfaceNames) {
      if (ifaceName.includes(pattern)) {
        const iface = interfaces[ifaceName];
        if (!iface) continue;
        for (const addr of iface) {
          if (addr.family === "IPv4" && !addr.internal) {
            return addr.address;
          }
        }
      }
    }
  }

  for (const ifaceName of interfaceNames) {
    const isSkipped = skipPatterns.some((pattern) => ifaceName.includes(pattern));
    if (isSkipped) continue;

    const iface = interfaces[ifaceName];
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }

  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }

  return "localhost";
}
