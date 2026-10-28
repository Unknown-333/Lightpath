import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DaemonDiscovery, DISCOVERY_FILE } from '@lightpath/protocol';

/** Writes `.lightpath/daemon.json` with user-only permissions, plus a .gitignore for the folder. */
export async function writeDiscovery(workspaceRoot: string, info: DaemonDiscovery): Promise<string> {
  const file = join(workspaceRoot, DISCOVERY_FILE);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(join(dirname(file), '.gitignore'), '*\n');
  // mode applies on POSIX; on Windows the file inherits the user's ACL from the workspace.
  await writeFile(file, `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
  return file;
}

/** Reads and validates the discovery file, or returns undefined if it's missing or invalid. */
export async function readDiscovery(workspaceRoot: string): Promise<DaemonDiscovery | undefined> {
  try {
    const raw = await readFile(join(workspaceRoot, DISCOVERY_FILE), 'utf8');
    const parsed = DaemonDiscovery.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function removeDiscovery(workspaceRoot: string): Promise<void> {
  await rm(join(workspaceRoot, DISCOVERY_FILE), { force: true });
}
