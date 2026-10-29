import { join } from 'node:path';
import { DaemonClient, DaemonDiscovery, DISCOVERY_FILE, type Trace } from '@lightpath-dev/protocol';
import * as vscode from 'vscode';
import { Heat } from './decorations.js';
import { replayOrder } from './heat.js';
import { TraceTree } from './tree.js';

const RETRY_MS = 2000;

/**
 * What `activate` returns (`vscode.extensions.getExtension(...).exports`). Read-only; the
 * in-editor test uses it because VS Code can't read decorations back.
 */
export interface LightpathApi {
  isConnected(): boolean;
  /** Trace IDs in the Actions view, newest first. */
  traceIds(): string[];
  /** Lines lit in an open editor for this file, with heat bucket (0 is coolest). */
  drawnLines(fsPath: string): ReadonlyMap<number, number> | undefined;
}

/**
 * Activates when a workspace contains `.lightpath/daemon.json` (written by `lightpath dev`).
 * Connects to the daemon, lights up each new trace, and keeps reconnecting if the daemon restarts.
 */
export function activate(context: vscode.ExtensionContext): LightpathApi {
  const heat = new Heat();
  const tree = new TraceTree();
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'lightpath.toggleLive';
  context.subscriptions.push(heat, status, vscode.window.registerTreeDataProvider('lightpath.traces', tree));

  let client: DaemonClient | undefined;
  let roots: readonly string[] = [];
  let live = true;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let replayToken = 0;

  const setStatus = (text: string, tooltip: string) => {
    status.text = text;
    status.tooltip = tooltip;
    status.show();
  };

  const absolute = (relative: string): string => join(roots[0] ?? '', relative);

  const show = (trace: Trace) => {
    replayToken++;
    heat.show(trace, absolute);
  };

  const connect = async () => {
    retry = undefined;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;
    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, DISCOVERY_FILE));
      const info = DaemonDiscovery.parse(JSON.parse(new TextDecoder().decode(raw)));
      client = await DaemonClient.connect(info.port, info.token);
      roots = client.workspaceRoots;
      setStatus(
        '$(flame) Lightpath',
        live ? 'Lightpath is live. Click anything in your app.' : 'Lightpath is paused.',
      );
      for (const summary of (await client.listTraces({ limit: 20 })).reverse()) {
        const trace = await client.getTrace(summary.id);
        if (trace) tree.upsert(trace);
      }
      client.onTrace((trace) => {
        tree.upsert(trace);
        if (live && trace.endedAt !== undefined) show(trace);
      });
      client.onClose(() => {
        client = undefined;
        setStatus('$(debug-disconnect) Lightpath', 'Waiting for lightpath dev to start.');
        scheduleRetry();
      });
    } catch {
      setStatus('$(debug-disconnect) Lightpath', 'Waiting for lightpath dev to start.');
      scheduleRetry();
    }
  };

  const scheduleRetry = () => {
    if (!retry) retry = setTimeout(() => void connect(), RETRY_MS);
  };

  const findTrace = (id: string) => tree.traces.find((t) => t.id === id);

  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(() => heat.refresh()),
    vscode.commands.registerCommand('lightpath.showTrace', (id: string) => {
      const trace = findTrace(id);
      if (trace) show(trace);
    }),
    vscode.commands.registerCommand('lightpath.openFile', async (id: string, path: string) => {
      const trace = findTrace(id);
      const file = trace?.files.find((f) => f.path === path);
      if (!trace || !file) return;
      show(trace);
      if (file.background) heat.showFile(file, absolute(path)); // asked for by name: light it
      const doc = await vscode.workspace.openTextDocument(absolute(path));
      const editor = await vscode.window.showTextDocument(doc, { preview: true });
      const first = Math.max(0, (file.lines[0]?.line ?? 1) - 1);
      editor.revealRange(
        new vscode.Range(first, 0, first, 0),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport,
      );
    }),
    vscode.commands.registerCommand('lightpath.replay', async (id?: string) => {
      const trace = id ? findTrace(id) : tree.traces[0];
      if (!trace) return;
      const token = ++replayToken;
      heat.clear();
      // Walk the files in the order the collectors saw them: browser first, then each backend.
      for (const file of replayOrder(trace)) {
        if (token !== replayToken) return; // another trace or replay took over
        const doc = await vscode.workspace.openTextDocument(absolute(file.path));
        await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
        heat.showFile(file, absolute(file.path));
        await new Promise((r) => setTimeout(r, 600));
      }
    }),
    vscode.commands.registerCommand('lightpath.clear', () => {
      replayToken++;
      heat.clear();
    }),
    vscode.commands.registerCommand('lightpath.toggleLive', () => {
      live = !live;
      setStatus(
        live ? '$(flame) Lightpath' : '$(debug-pause) Lightpath',
        live ? 'Lightpath is live.' : 'Lightpath is paused.',
      );
    }),
    vscode.commands.registerCommand('lightpath.togglePin', () => {
      heat.pinned = !heat.pinned;
    }),
    { dispose: () => retry && clearTimeout(retry) },
    { dispose: () => client?.close() },
  );

  void connect();

  return {
    isConnected: () => client !== undefined,
    traceIds: () => tree.traces.map((t) => t.id),
    drawnLines: (fsPath) => heat.drawnLines(fsPath),
  };
}

export function deactivate(): void {}
