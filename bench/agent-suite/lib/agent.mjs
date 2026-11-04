// The pinned agent: kiro-cli with one agent config per condition (D-108).
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isWindows, killTree, run } from './common.mjs';

export const MODEL = 'claude-sonnet-5.5';
export const EFFORT = 'medium';
export const AGENT_TIMEOUT_MS = 15 * 60_000;
export const KIRO_CLI = process.env.LP_KIRO_CLI ?? 'kiro-cli';
export const CONDITIONS = ['without', 'with', 'browser'];
// Pinned so the "browser" condition doesn't change under us.
export const CHROME_DEVTOOLS_MCP = 'chrome-devtools-mcp@1.12.0';

/** Added to every prompt, in every condition. */
export const SAFETY_LINE = "Work only inside this folder, and don't stop processes you didn't start.";

/** The same built-in tools in every condition. No web, no sub-agents, no AWS. */
export const BASE_TOOLS = ['read', 'write', 'shell', 'grep', 'glob'];

// Shell deny rules, written as CLI 2.x `toolsSettings.shell.deniedCommands` regexes. With
// `--output-format stream-json`, kiro-cli 2.37 runs its V3 engine, which converts each regex to
// glob patterns (`.*` -> `*`, `(a|b)` -> one pattern each) and matches them, ignoring case, on
// each part of a compound command. Deny wins over --trust-all-tools. A hand-written V3
// `permissions` block was NOT enforced in the same setup, so the suite uses this form
// (probe-safety.mjs and D-108 have the evidence). Keep to `.*`, literals and `(a|b)`.
// The globs are matched case-sensitively, so each word is listed as lower, Title and UPPER case.
const title = (w) => w.replace(/(^|-)([a-z])/g, (_, dash, ch) => dash + ch.toUpperCase());
const anyCase = (...words) =>
  `(${[...new Set(words.flatMap((w) => [w, title(w), w.toUpperCase()]))].map(escapeRegex).join('|')})`;
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const OUTSIDE = `(:|\\.\\.|~|%|${anyCase('$home')})`;
export const DENIED_COMMANDS = [
  // Stopping processes by name (or every process found by name).
  `.*${anyCase('taskkill')}.*/${anyCase('im', 'fi')}.*`,
  `.*${anyCase('stop-process', 'spps')}.*-${anyCase('n')}.*`,
  anyCase('stop-process', 'spps', 'kill'),
  `${anyCase('stop-process', 'spps')} -${anyCase('f')}.*`,
  `${anyCase('kill')} -${anyCase('n')}.*`,
  `.*${anyCase('foreach', '%')}.*${anyCase('stop-process')}.*`,
  `.*${anyCase('stop-process')}.*-${anyCase('inputobject', 'inputObject')}.*`,
  `.*${anyCase('pkill', 'killall')}.*`,
  // Any `wmic process` command. The converter returns `*` for a regex with 3 alternation
  // groups, so this one stays at 2. The harness rejects any config whose conversion has `*`.
  `.*${anyCase('wmic')}.*${anyCase('process')}.*`,
  `.*${anyCase('invoke-cimmethod', 'invoke-wmimethod', 'Invoke-CimMethod', 'Invoke-WmiMethod')}.*${anyCase('terminate')}.*`,
  `.*${anyCase('shutdown', 'restart-computer', 'stop-computer')}.*`,
  `.*\\.${anyCase('kill')}\\(\\).*`,
  // Deleting a path outside the working folder: a drive path or $env: (both have a colon),
  // a parent folder (..), home (~ or $HOME) or a %VAR%. The verb must start the command (each
  // part of a compound command counts), so `-Uri http://...` doesn't match `ri`. A delete inside
  // a nested shell (`cmd /c rd ...`) isn't matched: the converter turns such a regex into `*`,
  // which would block every command. auditShellCommands() flags those after the run instead.
  ...['rm', 'rmdir', 'rd', 'del', 'erase', 'ri', 'remove-item', 'rimraf'].map(
    (verb) => `${anyCase(verb)} .*${OUTSIDE}.*`,
  ),
  `.*::${anyCase('delete')}.*`,
];

const AUDIT_KILL_BY_NAME =
  /taskkill[^\n]*\/(im|fi)\b|\b(stop-process|spps)\b[^\n]*\s-n|\|\s*(stop-process|spps|kill)\b|\b(pkill|killall)\b|\.kill\(\)/i;
const AUDIT_DELETE = /(^|[\s;&|"'(])(rm|rmdir|rd|del|erase|ri|remove-item|rimraf)\s/i;

/** Flags shell commands that stop processes by name, or delete paths outside `trialDir`. */
export function auditShellCommands(toolCalls, trialDir) {
  const flags = [];
  const inside = trialDir.toLowerCase().replaceAll('/', '\\');
  for (const call of toolCalls) {
    const command = call.input?.command;
    if (typeof command !== 'string') continue;
    if (AUDIT_KILL_BY_NAME.test(command))
      flags.push({ rule: 'kill-by-name', command, blocked: call.blocked });
    if (AUDIT_DELETE.test(command)) {
      const paths = command.match(/(?<![a-z])[a-z]:[\\/][^\s"'`;|]*/gi) ?? [];
      const outside = paths.filter((p) => !p.toLowerCase().replaceAll('/', '\\').startsWith(inside));
      if (outside.length > 0 || /\.\.[\\/]|~|\$env:|\$home|%[a-z_]+%/i.test(command)) {
        flags.push({ rule: 'delete-outside', command, blocked: call.blocked });
      }
    }
  }
  return flags;
}

/**
 * The kiro-cli agent config for a condition. Every condition gets the same base tools, the
 * same permission rules, no prompt override, and includeMcpJson: false, so the owner's global
 * MCP servers (~/.kiro/settings/mcp.json) are never loaded.
 */
export function agentConfig(condition, { lightpathServer } = {}) {
  if (!CONDITIONS.includes(condition)) throw new Error(`unknown condition ${condition}`);
  const config = {
    name: 'bench',
    description: 'Coding agent for this repository',
    prompt: null,
    tools: [...BASE_TOOLS],
    allowedTools: [],
    mcpServers: {},
    includeMcpJson: false,
    resources: ['file://.kiro/steering/**/*.md'],
    toolsSettings: { shell: { deniedCommands: DENIED_COMMANDS } },
    model: MODEL,
  };
  if (condition === 'with') {
    // D-130: the server entry `lightpath init --agent kiro` wrote (with the packed CLI in place of
    // npx), and AGENTS.md as a resource, which init's Kiro note asks for.
    if (!lightpathServer) throw new Error('condition "with" needs the server entry from lightpath init');
    config.mcpServers.lightpath = { command: lightpathServer.command, args: [...lightpathServer.args] };
    config.tools.push('@lightpath');
    config.resources.push('file://AGENTS.md');
  }
  if (condition === 'browser') {
    // --isolated: a throwaway profile, never the owner's Chrome profile. --headless: nothing on screen.
    const args = ['-y', CHROME_DEVTOOLS_MCP, '--isolated', '--headless'];
    config.mcpServers['chrome-devtools'] = isWindows
      ? { command: 'cmd', args: ['/c', 'npx', ...args] }
      : { command: 'npx', args };
    config.tools.push('@chrome-devtools');
  }
  return config;
}

/** Keeps .kiro/ (the harness's agent file, init's mcp.json) out of `git status` in a shop trial. */
export function excludeKiroDir(trialDir) {
  if (!existsSync(join(trialDir, '.git'))) return;
  const exclude = join(trialDir, '.git', 'info', 'exclude');
  mkdirSync(join(trialDir, '.git', 'info'), { recursive: true });
  const text = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  if (!text.split(/\r?\n/).includes('.kiro/')) writeFileSync(exclude, '.kiro/\n', { flag: 'a' });
}

/**
 * Writes .kiro/agents/bench.json into the trial folder. For "with", `lightpath init` has already
 * written its own files (D-130); the steering stub that stood in for it is gone.
 */
export function writeAgentFiles(trialDir, condition, { lightpathServer } = {}) {
  const agentsDir = join(trialDir, '.kiro', 'agents');
  mkdirSync(agentsDir, { recursive: true });
  const config = agentConfig(condition, { lightpathServer });
  writeFileSync(join(agentsDir, 'bench.json'), `${JSON.stringify(config, null, 2)}\n`);
  // Keep the harness files out of `git status`, as if they were the user's local config.
  excludeKiroDir(trialDir);
  return config;
}

export function kiroCliVersion() {
  const res = run(KIRO_CLI, ['--version']);
  return res.stdout.trim() || `unknown (${res.stderr.trim()})`;
}

export function buildPrompt(reportText) {
  return `${reportText.trim()}\n\n${SAFETY_LINE}\n`;
}

/**
 * Runs kiro-cli once in `trialDir` with stream-json output. Kills the whole process tree at
 * the time limit. Returns { exitCode, timedOut, wallMs, transcript, stderrLog }.
 */
export function runAgent({
  trialDir,
  prompt,
  outDir,
  model = MODEL,
  effort = EFFORT,
  timeoutMs = AGENT_TIMEOUT_MS,
  maxSteps = null,
}) {
  const transcript = join(outDir, 'transcript.jsonl');
  const stderrLog = join(outDir, 'kiro-cli.stderr.log');
  const args = [
    'chat',
    '--no-interactive',
    '--trust-all-tools',
    // D-112: without these, kiro-cli 2.37 may not start a trial folder's MCP servers (the
    // workspace-trust prompt), so `with` and `browser` would run with no extra tools. The same
    // flags go to every condition; `without` has no MCP server, and its tool list is unchanged.
    '--trust-workspace',
    '--require-mcp-startup',
    '--agent',
    'bench',
    '--model',
    model,
    '--effort',
    effort,
    '--output-format',
    'stream-json',
    '--wrap',
    'never',
    prompt,
  ];
  writeFileSync(join(outDir, 'kiro-cli.args.json'), `${JSON.stringify([KIRO_CLI, ...args], null, 2)}\n`);
  const outFd = openSync(transcript, 'w');
  const errFd = openSync(stderrLog, 'w');
  const started = Date.now();
  const child = spawn(KIRO_CLI, args, { cwd: trialDir, stdio: ['ignore', outFd, errFd], windowsHide: true });
  closeSync(outFd);
  closeSync(errFd);
  return new Promise((resolveRun) => {
    let timedOut = false;
    let stepCapped = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);
    // Suite v2 difficulty check (owner, 2026-11-04): stop the run when it starts tool call maxSteps + 1.
    const capTimer =
      maxSteps === null
        ? null
        : setInterval(() => {
            const ids = new Set();
            for (const line of readFileSync(transcript, 'utf8').split('\n')) {
              if (!line.includes('tool_call')) continue;
              try {
                const u = JSON.parse(line).data?.update;
                if (u?.sessionUpdate === 'tool_call' || u?.sessionUpdate === 'tool_call_update')
                  ids.add(u.toolCallId);
              } catch {
                // a line still being written
              }
            }
            if (ids.size > maxSteps && !stepCapped) {
              stepCapped = true;
              killTree(child.pid);
            }
          }, 250);
    const finish = (exitCode, error) => {
      clearTimeout(timer);
      if (capTimer) clearInterval(capTimer);
      // Whatever the agent left running under kiro-cli goes too.
      killTree(child.pid);
      resolveRun({
        exitCode,
        error,
        timedOut,
        stepCapped,
        wallMs: Date.now() - started,
        transcript,
        stderrLog,
        pid: child.pid,
      });
    };
    child.on('error', (err) => finish(-1, String(err)));
    child.on('exit', (code) => finish(code ?? -1, null));
  });
}

/**
 * Reads a stream-json transcript (ACP events). Steps = tool calls. kiro-cli 2.37 reports no
 * token counts here; it reports credits per turn (`turn_completion.promptTurnSummaries`) and the
 * context window use in percent, which we keep as the closest size measure.
 */
export function parseTranscript(events) {
  const calls = new Map();
  let credits = 0;
  let creditsSeen = false;
  let contextPctMax = 0;
  const usedTools = [];
  let final = null;
  for (const event of events) {
    if (event.type === 'runFinished') final = event.data;
    const update = event.data?.update;
    if (!update) continue;
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      const prev = calls.get(update.toolCallId) ?? { id: update.toolCallId };
      const text = (update.content ?? [])
        .map((c) => c?.content?.text ?? '')
        .join('\n')
        .trim();
      calls.set(update.toolCallId, {
        ...prev,
        kind: update.kind ?? prev.kind,
        title: update.title ?? prev.title,
        input: update.rawInput ?? prev.input,
        locations: update.locations ?? prev.locations,
        status: update.status ?? prev.status,
        blocked: prev.blocked || /Blocked by a permission rule/.test(text),
        output: text ? text.slice(0, 400) : prev.output,
      });
    }
    const kiro = update._meta?.kiro;
    if (kiro?.kind === 'turn_completion') {
      for (const turn of kiro.promptTurnSummaries ?? []) {
        if (typeof turn.usage === 'number') {
          credits += turn.usage;
          creditsSeen = true;
        }
        usedTools.push(...(turn.usedTools ?? []));
      }
    }
    const pct = kiro?.contextUsage?.usagePercentage;
    if (typeof pct === 'number') contextPctMax = Math.max(contextPctMax, pct);
  }
  const toolCalls = [...calls.values()];
  return {
    steps: toolCalls.length,
    toolCalls,
    usedTools,
    credits: creditsSeen ? credits : null,
    contextPctMax,
    status: final?.status ?? null,
    stopReason: final?.stopReason ?? null,
    finalText: final?.finalText ?? null,
  };
}

export const TOKENS_METHOD = 'transcript-chars/4';

/**
 * Token estimate for one run (D-111): characters / 4 of what the transcript shows was sent and
 * received, each item counted once. In: the prompt and every tool result text. Out: every agent
 * message and thought chunk, and each tool call's final input. Leaves out the system prompt, the
 * tool specs and the context re-sent on each request, so it is a lower bound, not a bill.
 */
export function estimateTokens(events, prompt = '') {
  let inChars = prompt.length;
  let outChars = 0;
  const inputs = new Map();
  const outputs = new Map();
  for (const event of events) {
    const update = event.data?.update;
    if (!update) continue;
    const kind = update.sessionUpdate;
    if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
      const text = update.content?.text;
      if (typeof text === 'string') outChars += text.length;
    } else if (kind === 'tool_call' || kind === 'tool_call_update') {
      if (update.rawInput !== undefined) inputs.set(update.toolCallId, JSON.stringify(update.rawInput));
      const text = (update.content ?? []).map((c) => c?.content?.text ?? '').join('\n');
      if (text) outputs.set(update.toolCallId, text);
    }
  }
  for (const text of inputs.values()) outChars += text.length;
  for (const text of outputs.values()) inChars += text.length;
  const tokensEstIn = Math.round(inChars / 4);
  const tokensEstOut = Math.round(outChars / 4);
  return { tokensEst: tokensEstIn + tokensEstOut, tokensEstIn, tokensEstOut, tokensMethod: TOKENS_METHOD };
}

export function readJsonl(path) {
  const events = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      events.push({ unparsed: line });
    }
  }
  return events;
}
