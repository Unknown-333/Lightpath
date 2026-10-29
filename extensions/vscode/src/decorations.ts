import type { FileHits, LineHit, Trace } from '@lightpath-dev/protocol';
import * as vscode from 'vscode';
import { bucketize, countLabel, HEAT_BUCKETS, pathKey } from './heat.js';

/** Background opacity per bucket, coolest first. Amber reads as "light" on both light and dark themes. */
const OPACITY = [0.1, 0.14, 0.18, 0.23, 0.28, 0.34, 0.4, 0.48];
const FADE_STEPS = 4;

/**
 * Draws heat on editors (ARCHITECTURE section 9.1). Decoration types are created once and reused:
 * creating one per line would be slow and leak.
 */
export class Heat implements vscode.Disposable {
  readonly #types: vscode.TextEditorDecorationType[];
  readonly #countType: vscode.TextEditorDecorationType;
  /** Normalized absolute path → hits currently shown. */
  #files = new Map<string, FileHits>();
  #fadeTimer: ReturnType<typeof setInterval> | undefined;
  #fadeLevel = 0;
  /** pathKey → line → bucket, as last drawn. VS Code can't read decorations back, so tests use this. */
  readonly #drawn = new Map<string, Map<number, number>>();
  pinned = false;

  constructor() {
    this.#types = OPACITY.map((a) =>
      vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: `rgba(255, 184, 0, ${a})`,
        overviewRulerColor: `rgba(255, 184, 0, ${Math.min(1, a * 2)})`,
        overviewRulerLane: vscode.OverviewRulerLane.Left,
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      }),
    );
    this.#countType = vscode.window.createTextEditorDecorationType({
      after: { color: new vscode.ThemeColor('editorCodeLens.foreground'), margin: '0 0 0 1.5em' },
    });
  }

  /** Shows a trace. `absolute` resolves a trace's workspace-relative path to a file system path. */
  show(trace: Trace, absolute: (relative: string) => string): void {
    this.#files = new Map(trace.files.map((f) => [pathKey(absolute(f.path)), f]));
    this.#fadeLevel = 0;
    this.refresh();
    this.#startFade();
  }

  /** Shows one file only, used by replay to light files one after another. */
  showFile(file: FileHits, absolutePath: string): void {
    this.#files.set(pathKey(absolutePath), file);
    this.refresh();
  }

  clear(): void {
    this.#files.clear();
    this.#stopFade();
    this.refresh();
  }

  /** Re-applies decorations to every visible editor. Cheap: one call per bucket per editor. */
  refresh(): void {
    for (const editor of vscode.window.visibleTextEditors) this.#apply(editor);
  }

  /** Lines currently drawn in an open editor for `fsPath`, with their heat bucket (0 is coolest). */
  drawnLines(fsPath: string): ReadonlyMap<number, number> | undefined {
    return this.#drawn.get(pathKey(fsPath));
  }

  #apply(editor: vscode.TextEditor): void {
    const key = pathKey(editor.document.uri.fsPath);
    const file = this.#files.get(key);
    const buckets = file
      ? bucketize(file.lines)
      : Array.from({ length: HEAT_BUCKETS }, () => [] as LineHit[]);
    const shift = this.#fadeLevel * 2;
    const drawn = new Map<number, number>();
    for (let i = 0; i < HEAT_BUCKETS; i++) {
      // Fading moves every line down a few buckets until it drops off.
      const source = buckets[i + shift] ?? [];
      const type = this.#types[i];
      if (!type) continue;
      const ranges: vscode.Range[] = [];
      for (const hit of source) {
        const range = lineRange(editor, hit.line);
        if (!range) continue;
        ranges.push(range);
        drawn.set(hit.line, i);
      }
      editor.setDecorations(type, ranges);
    }
    if (drawn.size > 0) this.#drawn.set(key, drawn);
    else this.#drawn.delete(key);
    const counts = file && this.#fadeLevel === 0 ? file.lines.filter((h) => h.count > 1) : [];
    editor.setDecorations(
      this.#countType,
      counts.flatMap((h) => {
        const range = lineRange(editor, h.line);
        return range ? [{ range, renderOptions: { after: { contentText: countLabel(h.count) } } }] : [];
      }),
    );
  }

  #startFade(): void {
    this.#stopFade();
    const seconds = vscode.workspace.getConfiguration('lightpath').get<number>('fadeSeconds', 10);
    if (this.pinned || seconds <= 0) return;
    this.#fadeTimer = setInterval(
      () => {
        this.#fadeLevel++;
        if (this.#fadeLevel > FADE_STEPS) this.clear();
        else this.refresh();
      },
      (seconds * 1000) / FADE_STEPS,
    );
  }

  #stopFade(): void {
    if (this.#fadeTimer) clearInterval(this.#fadeTimer);
    this.#fadeTimer = undefined;
  }

  dispose(): void {
    this.#stopFade();
    for (const t of this.#types) t.dispose();
    this.#countType.dispose();
  }
}

function lineRange(editor: vscode.TextEditor, line: number): vscode.Range | undefined {
  // Trace lines are 1-based; a file edited since the trace may be shorter now.
  if (line < 1 || line > editor.document.lineCount) return undefined;
  return editor.document.lineAt(line - 1).range;
}
