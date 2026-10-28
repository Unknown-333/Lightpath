import type { FileHits, Trace } from '@lightpath-dev/protocol';
import * as vscode from 'vscode';
import { ago } from './heat.js';

type Node = { kind: 'trace'; trace: Trace } | { kind: 'file'; trace: Trace; file: FileHits };

const ICON = { browser: 'browser', node: 'server-process', python: 'symbol-namespace' } as const;

/** Recent traces, newest first; expanding one lists its files (ARCHITECTURE section 9.1). */
export class TraceTree implements vscode.TreeDataProvider<Node> {
  readonly #changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.#changed.event;
  #traces: Trace[] = [];
  readonly #limit: number;

  constructor(limit = 50) {
    this.#limit = limit;
  }

  get traces(): readonly Trace[] {
    return this.#traces;
  }

  upsert(trace: Trace): void {
    this.#traces = [trace, ...this.#traces.filter((t) => t.id !== trace.id)].slice(0, this.#limit);
    this.#changed.fire(undefined);
  }

  clear(): void {
    this.#traces = [];
    this.#changed.fire(undefined);
  }

  getChildren(node?: Node): Node[] {
    if (!node) return this.#traces.map((trace) => ({ kind: 'trace', trace }));
    if (node.kind === 'trace')
      return node.trace.files.map((file) => ({ kind: 'file', trace: node.trace, file }));
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'trace') {
      const { trace } = node;
      const item = new vscode.TreeItem(trace.label, vscode.TreeItemCollapsibleState.Collapsed);
      const overlapped = trace.requests.some((r) => r.overlapped);
      item.description = `${trace.files.length} files · ${ago(trace.startedAt, Date.now())}${overlapped ? ' · overlapped' : ''}`;
      item.tooltip =
        trace.requests.map((r) => `${r.method} ${r.path} ${r.status ?? ''}`).join('\n') || trace.id;
      item.iconPath = new vscode.ThemeIcon(trace.origin === 'browser' ? 'pulse' : 'server');
      item.contextValue = 'trace';
      item.command = { command: 'lightpath.showTrace', title: 'Show trace', arguments: [trace.id] };
      return item;
    }
    const { file } = node;
    const item = new vscode.TreeItem(file.path, vscode.TreeItemCollapsibleState.None);
    item.description = `${file.lines.length} lines`;
    item.iconPath = new vscode.ThemeIcon(ICON[file.collector]);
    item.command = {
      command: 'lightpath.openFile',
      title: 'Open file',
      arguments: [node.trace.id, file.path],
    };
    return item;
  }
}
