import type { ActionError } from '@lightpath-dev/protocol';
import type { Locator, Page } from 'playwright-core';

/** ARIA roles a `<role> "<name>"` target may name (WAI-ARIA 1.2 widget, structure and landmark roles). */
export const ARIA_ROLES = new Set([
  'alert',
  'alertdialog',
  'application',
  'article',
  'banner',
  'blockquote',
  'button',
  'caption',
  'cell',
  'checkbox',
  'code',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'definition',
  'deletion',
  'dialog',
  'directory',
  'document',
  'emphasis',
  'feed',
  'figure',
  'form',
  'generic',
  'grid',
  'gridcell',
  'group',
  'heading',
  'img',
  'insertion',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'math',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'meter',
  'navigation',
  'none',
  'note',
  'option',
  'paragraph',
  'presentation',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'strong',
  'subscript',
  'superscript',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'time',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem',
]);

export type ParsedTarget =
  | { kind: 'css'; selector: string }
  | { kind: 'role'; role: string; name: string }
  | { kind: 'text'; text: string };

/**
 * Reads a target in the forms of design section 4.1, tried in this order: `css=<selector>`,
 * `<role> "<name>"` with an ARIA role, and anything else as visible text.
 */
export function parseTarget(target: string): ParsedTarget {
  const trimmed = target.trim();
  if (trimmed.startsWith('css=')) return { kind: 'css', selector: trimmed.slice('css='.length).trim() };
  const m = /^([a-z]+)\s+"(.+)"$/s.exec(trimmed);
  if (m?.[1] && m[2] !== undefined && ARIA_ROLES.has(m[1])) return { kind: 'role', role: m[1], name: m[2] };
  return { kind: 'text', text: trimmed };
}

/** `button "Checkout"` within "Coffee mug", for messages. */
export function describeTarget(target: string, within?: string): string {
  return within ? `${target} within "${within}"` : target;
}

/** Turns a Playwright actionability failure into the reason the agent sees, or undefined. */
export function actionabilityProblem(message: string): string | undefined {
  if (/intercepts pointer events/i.test(message)) return 'covered by another element';
  if (/not visible|hidden/i.test(message)) return 'hidden';
  if (/not enabled|disabled/i.test(message)) return 'disabled';
  if (/not editable|readonly/i.test(message)) return 'not editable';
  if (/not stable/i.test(message)) return 'still moving';
  if (/outside of the viewport/i.test(message)) return 'outside the page';
  return undefined;
}

const MAX_CANDIDATES = 10;

export type Resolved = { ok: true; locator: Locator } | { ok: false; error: ActionError };

function locate(page: Page, parsed: ParsedTarget, exact = false): Locator {
  switch (parsed.kind) {
    case 'css':
      return page.locator(parsed.selector);
    case 'role':
      return page.getByRole(parsed.role as Parameters<Page['getByRole']>[0], {
        name: parsed.name,
        ...(exact ? { exact: true } : {}),
      });
    case 'text':
      return page.getByText(parsed.text, exact ? { exact: true } : {});
  }
}

/**
 * Finds exactly one element for a target, or says why not (design section 4.1). Never picks the
 * first of several: `ambiguous` lists them so the caller can add `within` or a fuller name.
 */
export async function resolveTarget(page: Page, target: string, within?: string): Promise<Resolved> {
  const parsed = parseTarget(target);
  const base = locate(page, parsed);
  let count: number;
  try {
    count = await base.count();
  } catch (err) {
    return {
      ok: false,
      error: { code: 'not_found', message: `${target} is not a valid target: ${firstLine(err)}` },
    };
  }
  let indexes = [...Array(count).keys()];
  if (within !== undefined && count > 0) indexes = await keepWithin(base, within);
  if (indexes.length > 1 && parsed.kind === 'role') {
    // One exact name match wins over several partial ones ('Checkout' over 'Checkout as guest').
    const exact = locate(page, parsed, true);
    const exactOnes: number[] = [];
    for (const i of indexes) if ((await base.nth(i).and(exact).count()) > 0) exactOnes.push(i);
    if (exactOnes.length === 1) indexes = exactOnes;
  }
  const [only] = indexes;
  if (indexes.length === 1 && only !== undefined) return { ok: true, locator: base.nth(only) };
  if (indexes.length === 0) {
    return {
      ok: false,
      error: {
        code: 'not_found',
        message: `No element matches ${describeTarget(target, within)}.`,
        count: 0,
        candidates: await closestCandidates(page, parsed),
      },
    };
  }
  const candidates: string[] = [];
  for (const i of indexes.slice(0, MAX_CANDIDATES)) candidates.push(await describeMatch(base.nth(i)));
  return {
    ok: false,
    error: {
      code: 'ambiguous',
      message: `${indexes.length} elements match ${describeTarget(target, within)}; nothing was clicked. Add "within" (text of the row or section) or a fuller name.`,
      count: indexes.length,
      candidates,
    },
  };
}

/**
 * Keeps the matches inside the smallest elements whose text contains `within` (case-insensitive,
 * spaces collapsed). A match's scope is its nearest element, itself included, whose text holds
 * `within`; a scope that contains another match's scope is too big, so its matches drop out.
 */
async function keepWithin(base: Locator, within: string): Promise<number[]> {
  return base.evaluateAll((els, w) => {
    const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    const want = norm(w);
    const scopes = els.map((el) => {
      let a: Element | null = el;
      while (a && !norm(a.textContent).includes(want)) a = a.parentElement;
      return a;
    });
    return els
      .map((_, i) => i)
      .filter((i) => {
        const s = scopes[i];
        return !!s && !scopes.some((o) => o && o !== s && s.contains(o));
      });
  }, within);
}

/** `button "Add to cart" in "Desk lamp · $39.00"`: the role and name, and the nearest other text. */
async function describeMatch(locator: Locator): Promise<string> {
  const [snapshot, context] = await Promise.all([
    locator.ariaSnapshot({ timeout: 1000 }).catch(() => ''),
    locator
      .evaluate((el) => {
        const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
        const own = norm(el.textContent);
        let a = el.parentElement;
        while (a && norm(a.textContent) === own) a = a.parentElement;
        return a ? norm(a.textContent).replace(own, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) : '';
      })
      .catch(() => ''),
  ]);
  const role = /^-\s+([a-z]+)(?:\s+"((?:[^"\\]|\\.)*)")?/.exec(snapshot.trim());
  const head = role ? (role[2] !== undefined ? `${role[1]} "${role[2]}"` : `${role[1]}`) : 'element';
  return context ? `${head} in "${context}"` : head;
}

/** Up to 10 role-and-name pairs on the page, closest to the target first. */
async function closestCandidates(page: Page, parsed: ParsedTarget): Promise<string[]> {
  const snapshot = await page
    .locator('body')
    .ariaSnapshot({ timeout: 2000 })
    .catch(() => '');
  const seen = new Set<string>();
  const entries: { role: string; name: string }[] = [];
  for (const m of snapshot.matchAll(/-\s+([a-z]+)\s+"((?:[^"\\]|\\.)*)"/g)) {
    const [, role, name] = m;
    if (!role || name === undefined || seen.has(`${role} ${name}`)) continue;
    seen.add(`${role} ${name}`);
    entries.push({ role, name });
  }
  const query = parsed.kind === 'role' ? parsed.name : parsed.kind === 'text' ? parsed.text : '';
  const wantRole = parsed.kind === 'role' ? parsed.role : undefined;
  return entries
    .map((e, i) => ({ e, i, score: similarity(query, e.name) + (e.role === wantRole ? 0.25 : 0) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, MAX_CANDIDATES)
    .map(({ e }) => `${e.role} "${e.name}"`);
}

/** 1 when one text holds the other, else the Dice coefficient of their letter pairs (0 to 1). */
export function similarity(a: string, b: string): number {
  const x = a.toLowerCase().replace(/\s+/g, ' ').trim();
  const y = b.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!x || !y) return 0;
  if (x.includes(y) || y.includes(x)) return 1;
  const pairs = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) ?? 0) + 1);
    return out;
  };
  const px = pairs(x);
  const py = pairs(y);
  let shared = 0;
  for (const [p, n] of px) shared += Math.min(n, py.get(p) ?? 0);
  const total = x.length - 1 + (y.length - 1);
  return total > 0 ? (2 * shared) / total : 0;
}

function firstLine(err: unknown): string {
  return String((err as Error)?.message ?? err).split('\n')[0] ?? '';
}
