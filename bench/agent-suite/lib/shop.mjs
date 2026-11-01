// Starts and stops a trial's shop, and frees the shop ports afterwards.
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import {
  API_PORT,
  killTree,
  listeners,
  processesMentioning,
  SHOP_PORTS,
  sleep,
  WEB_PORT,
  waitForHttp,
} from './common.mjs';

export const API_URL = `http://127.0.0.1:${API_PORT}`;
// Vite listens on "localhost", which may be ::1 only; the browser and fetch resolve it either way.
export const WEB_URL = `http://localhost:${WEB_PORT}`;

/** Fails if anything already listens on the shop ports: the harness never kills what it didn't start. */
export function assertPortsFree() {
  const busy = listeners(SHOP_PORTS);
  if (busy.length > 0) {
    throw new Error(
      `shop ports busy: ${busy.map((b) => `${b.port} pid ${b.pid} (${b.commandLine})`).join('; ')}`,
    );
  }
}

/** Waits for the shop ports to close (a just-killed shop takes a moment), then asserts they're free. */
export async function waitPortsFree(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && listeners(SHOP_PORTS).length > 0) await sleep(500);
  assertPortsFree();
}

/** Starts `node dev.mjs` in `dir` and waits until the API and Vite both answer. */
export async function startShop(dir, logFile, timeoutMs = 90_000) {
  await waitPortsFree();
  const fd = openSync(logFile, 'a');
  const child = spawn(process.execPath, ['dev.mjs'], {
    cwd: dir,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  closeSync(fd);
  const stop = () => killTree(child.pid);
  try {
    // Any answer counts as "up": a seeded bug may make a route fail, which is the check's business.
    await Promise.all([
      waitForHttp(`${API_URL}/api/products`, timeoutMs, { anyStatus: true }),
      waitForHttp(`${WEB_URL}/`, timeoutMs, { anyStatus: true }),
    ]);
  } catch (err) {
    stop();
    throw err;
  }
  return { pid: child.pid, stop };
}

/**
 * After a trial: kills processes the trial left behind and frees the shop ports.
 * Only kills a process if its command line names the trial folder, or it listens on a shop
 * port and started after the trial began (the ports were checked free at the start).
 * Returns what it killed and anything it left alone.
 */
export function cleanupTrial(dir, startedAtIso) {
  const killed = [];
  const leftAlone = [];
  for (const proc of processesMentioning(dir)) {
    killTree(proc.pid);
    killed.push(proc);
  }
  for (const row of listeners(SHOP_PORTS)) {
    const startedAfter = row.created && startedAtIso && row.created >= startedAtIso;
    const mentions = row.commandLine?.toLowerCase().includes(dir.toLowerCase());
    if (startedAfter || mentions) {
      killTree(row.pid);
      killed.push(row);
    } else leftAlone.push(row);
  }
  return { killed, leftAlone };
}
