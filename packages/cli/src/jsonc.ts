/**
 * Just enough of JSON with comments (JSONC) to read an agent's MCP config and to set one member in
 * it as a text edit, so every other byte of the file stays as the user wrote it (D-161): other
 * servers, their order, indentation, line endings, comments and trailing commas.
 */

interface Token {
  kind: '{' | '}' | '[' | ']' | ':' | ',' | 'string' | 'literal';
  start: number;
  end: number;
}

/** Tokens without whitespace and comments, or undefined for an unclosed string or comment. */
function tokenize(text: string): Token[] | undefined {
  const tokens: Token[] = [];
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close < 0) return undefined;
      i = close + 2;
    } else if ('{}[]:,'.includes(c)) {
      tokens.push({ kind: c as Token['kind'], start: i, end: i + 1 });
      i++;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      if (j >= text.length) return undefined;
      tokens.push({ kind: 'string', start: i, end: j + 1 });
      i = j + 1;
    } else {
      let j = i;
      while (j < text.length && !/[\s{}[\]:,"/]/.test(text[j] as string)) j++;
      if (j === i) return undefined;
      tokens.push({ kind: 'literal', start: i, end: j });
      i = j;
    }
  }
  return tokens;
}

export interface JsonNode {
  kind: 'object' | 'array' | 'value';
  start: number;
  end: number;
  /** Object members, in file order. */
  members?: Member[];
  /** True when a comma follows the last member (objects only). */
  trailingComma?: boolean;
}

export interface Member {
  key: string;
  /** Where the key's opening quote is. */
  keyStart: number;
  value: JsonNode;
}

/** The root value of a JSONC text, with positions, or undefined when it isn't JSONC. */
export function parseTree(text: string): JsonNode | undefined {
  const tokens = tokenize(text);
  if (!tokens || tokens.length === 0) return undefined;
  let k = 0;
  const value = (): JsonNode | undefined => {
    const t = tokens[k];
    if (!t) return undefined;
    if (t.kind === 'string' || t.kind === 'literal') {
      k++;
      return { kind: 'value', start: t.start, end: t.end };
    }
    if (t.kind === '[') {
      k++;
      while (tokens[k] && tokens[k]?.kind !== ']') {
        if (!value()) return undefined;
        if (tokens[k]?.kind === ',') k++;
        else if (tokens[k]?.kind !== ']') return undefined;
      }
      const close = tokens[k++];
      return close ? { kind: 'array', start: t.start, end: close.end } : undefined;
    }
    if (t.kind === '{') {
      k++;
      const members: Member[] = [];
      let trailingComma = false;
      while (tokens[k] && tokens[k]?.kind !== '}') {
        const key = tokens[k];
        if (key?.kind !== 'string' || tokens[k + 1]?.kind !== ':') return undefined;
        k += 2;
        const v = value();
        if (!v) return undefined;
        let name: string;
        try {
          name = JSON.parse(text.slice(key.start, key.end)) as string;
        } catch {
          return undefined;
        }
        members.push({ key: name, keyStart: key.start, value: v });
        trailingComma = tokens[k]?.kind === ',';
        if (trailingComma) k++;
        else if (tokens[k]?.kind !== '}') return undefined;
      }
      const close = tokens[k++];
      return close ? { kind: 'object', start: t.start, end: close.end, members, trailingComma } : undefined;
    }
    return undefined;
  };
  const root = value();
  return root && k === tokens.length ? root : undefined;
}

/** The value of a JSONC text: comments and trailing commas dropped, then JSON.parse. */
export function parseJsonc(text: string): unknown {
  const tokens = tokenize(text);
  if (!tokens || !parseTree(text)) return undefined;
  const parts: string[] = [];
  tokens.forEach((t, i) => {
    const next = tokens[i + 1]?.kind;
    if (t.kind === ',' && (next === '}' || next === ']')) return;
    parts.push(text.slice(t.start, t.end));
  });
  try {
    return JSON.parse(parts.join(' '));
  } catch {
    return undefined;
  }
}

const lineStart = (text: string, pos: number) => text.lastIndexOf('\n', pos - 1) + 1;
/** The spaces and tabs a line starts with. */
const indentAt = (text: string, pos: number) => /^[ \t]*/.exec(text.slice(lineStart(text, pos)))?.[0] ?? '';
/** True when only whitespace stands between the line start and `pos`. */
const startsLine = (text: string, pos: number) => /^[ \t]*$/.test(text.slice(lineStart(text, pos), pos));

/** The file's indent unit: the first indented line's indentation, or two spaces. */
function indentUnit(text: string): string {
  const m = /\n([ \t]+)\S/.exec(text);
  return m?.[1] ?? '  ';
}

/**
 * Sets `parentKey.name = value` in the root object of `text` as one text edit. `parentKey` is
 * created when missing. Returns the new text, or undefined when the root isn't an object or
 * `parentKey` isn't one. The caller checks the result (see `setMemberChecked`).
 */
export function setMember(text: string, parentKey: string, name: string, value: unknown): string | undefined {
  const root = parseTree(text);
  if (root?.kind !== 'object' || !root.members) return undefined;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const unit = indentUnit(text);
  const parent = root.members.filter((m) => m.key === parentKey).at(-1);
  if (parent && parent.value.kind !== 'object') return undefined;
  if (parent) {
    const existing = parent.value.members?.filter((m) => m.key === name).at(-1);
    if (existing) {
      const indent = indentAt(text, existing.value.start);
      return splice(text, existing.value.start, existing.value.end, render(value, indent, unit, eol));
    }
    return insertMember(text, parent.value, name, value, unit, eol);
  }
  return insertMember(text, root, parentKey, { [name]: value }, unit, eol);
}

function render(value: unknown, indent: string, unit: string, eol: string): string {
  return JSON.stringify(value, null, unit).replace(/\n/g, `${eol}${indent}`);
}

function splice(text: string, start: number, end: number, insert: string): string {
  return text.slice(0, start) + insert + text.slice(end);
}

function insertMember(
  text: string,
  obj: JsonNode,
  name: string,
  value: unknown,
  unit: string,
  eol: string,
): string {
  const members = obj.members ?? [];
  const close = obj.end - 1;
  const outer = indentAt(text, obj.start);
  const last = members.at(-1);
  if (!last) {
    // `{}` or `{ // comment }`: open it up, keeping whatever is inside.
    const inner = text.slice(obj.start + 1, close);
    const indent = outer + unit;
    const member = `${JSON.stringify(name)}: ${render(value, indent, unit, eol)}`;
    const kept = inner.trim() ? `${eol}${indent}${inner.trim()}` : '';
    return splice(text, obj.start + 1, close, `${kept}${eol}${indent}${member}${eol}${outer}`);
  }
  const firstKeyStart = (members[0] as Member).keyStart;
  if (!startsLine(text, firstKeyStart)) {
    // A one-line object: add the member before the closing brace, on the same line.
    const member = `${JSON.stringify(name)}: ${JSON.stringify(value)}`;
    let at = last.value.end;
    if (obj.trailingComma) at = text.indexOf(',', at) + 1;
    return splice(text, at, at, `${obj.trailingComma ? ' ' : ', '}${member}${obj.trailingComma ? ',' : ''}`);
  }
  const indent = indentAt(text, firstKeyStart);
  const member = `${JSON.stringify(name)}: ${render(value, indent, unit, eol)}`;
  // After the last value, its comma and any comment on the same line, so a comment stays with the
  // member it was written after.
  let at = last.value.end;
  if (obj.trailingComma) at = text.indexOf(',', at) + 1;
  const nl = text.indexOf('\n', at);
  const lineEnd = nl < 0 || nl > close ? close : nl > 0 && text[nl - 1] === '\r' ? nl - 1 : nl;
  const rest = text.slice(at, lineEnd);
  const restIsComment = /^[ \t]*(\/\/.*)?$/.test(rest);
  const insertAt = restIsComment ? lineEnd : at;
  const added = `${eol}${indent}${member}${obj.trailingComma ? ',' : ''}`;
  const withMember = splice(text, insertAt, insertAt, added);
  return obj.trailingComma ? withMember : splice(withMember, last.value.end, last.value.end, ',');
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep equality of JSON values; object key order counts. */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Deep equality of JSON values, ignoring the order of object keys. */
export function sameValue(a: unknown, b: unknown): boolean {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : isPlainObject(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sorted(v[k])]),
          )
        : v;
  return sameJson(sorted(a), sorted(b));
}

/**
 * `setMember`, then a check that the result parses, has `parentKey.name` equal to `value`, and
 * keeps every other key of the root and of `parentKey` equal and in the same order. Undefined when
 * any of that fails, so the caller can leave the file alone.
 */
export function setMemberChecked(
  text: string,
  parentKey: string,
  name: string,
  value: unknown,
): string | undefined {
  const before = parseJsonc(text);
  if (!isPlainObject(before)) return undefined;
  const next = setMember(text, parentKey, name, value);
  if (next === undefined) return undefined;
  const after = parseJsonc(next);
  if (!isPlainObject(after)) return undefined;
  const others = (o: Record<string, unknown>) => Object.entries(o).filter(([k]) => k !== parentKey);
  if (!sameJson(others(before), others(after))) return undefined;
  const p0 = before[parentKey] ?? {};
  const p1 = after[parentKey];
  if (!isPlainObject(p0) || !isPlainObject(p1)) return undefined;
  if (!sameJson(p1[name], value)) return undefined;
  const without = (o: Record<string, unknown>) => Object.entries(o).filter(([k]) => k !== name);
  if (!sameJson(without(p0), without(p1))) return undefined;
  return next;
}
