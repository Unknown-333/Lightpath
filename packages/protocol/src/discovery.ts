import { z } from 'zod';

/** Path of the discovery file, relative to the workspace root. */
export const DISCOVERY_FILE = '.lightpath/daemon.json';

/** Contents of `.lightpath/daemon.json`, written by the daemon and read by clients. */
export const DaemonDiscovery = z.object({
  port: z.number().int().min(1).max(65535),
  token: z.string().min(32),
  pid: z.number().int(),
  protocolVersion: z.number().int().positive(),
  startedAt: z.number(),
});
export type DaemonDiscovery = z.infer<typeof DaemonDiscovery>;

/** WebSocket close codes the daemon uses (4000-4999 is the application range). */
export const CloseCode = {
  Unauthorized: 4401,
  BadMessage: 4400,
  Forbidden: 4403,
  VersionMismatch: 4426,
} as const;

/** Largest message the daemon accepts, in bytes. */
export const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
