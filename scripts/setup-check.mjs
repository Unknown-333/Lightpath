// CI `setup` job (docs/design/agent-loop.md section 10.3, D-120): for each agent, on this OS, with
// no agent installed, `lightpath init` writes the right files, the configured command starts the
// MCP server offline and answers initialize and tools/list, and `lightpath doctor` exits 0.
//
// Run after `pnpm build`: node scripts/setup-check.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = join(import.meta.dirname, '..');
const isWin = process.platform === 'win32';
// A space in every path, like "C:\Users\Jane Doe\my app".
const work = mkdtempSync(join(tmpdir(), 'lightpath setup '));
const failures = [];
const log = (line) => process.stdout.write(`${line}\n`);
const check = (ok, what) => {
  log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};
// Windows needs a shell for the npm and pnpm .cmd shims, so quote paths with spaces there.
const sh = (cmd, args, cwd) =>
  execFileSync(cmd, isWin ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args, {
    cwd,
    encoding: 'utf8',
    shell: isWin,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
// Doctor launches a headless browser; SETUP_CHECK_SKIP_DOCTOR=1 skips it on a machine whose
// browser is busy. CI never sets it.
const skipDoctor = process.env.SETUP_CHECK_SKIP_DOCTOR === '1';

try {
  // 1. Pack every published package, as npm would get them.
  const tarballs = join(work, 'tarballs');
  mkdirSync(tarballs);
  for (const name of readdirSync(join(repo, 'packages'))) {
    const pkg = JSON.parse(readFileSync(join(repo, 'packages', name, 'package.json'), 'utf8'));
    if (pkg.private) continue;
    sh('pnpm', ['pack', '--pack-destination', tarballs], join(repo, 'packages', name));
  }
  const tgz = readdirSync(tarballs).map((f) => join(tarballs, f));
  log(`packed ${tgz.length}: ${readdirSync(tarballs).join(', ')}`);

  // 2. One fresh project with the tarballs installed, copied once per agent.
  const base = join(work, 'base app');
  mkdirSync(base);
  writeFileSync(
    join(base, 'package.json'),
    `${JSON.stringify({ name: 'setup-check-app', private: true, scripts: { dev: 'node server.js' } }, null, 2)}\n`,
  );
  writeFileSync(join(base, 'server.js'), "console.log('dev server');\n");
  sh('npm', ['install', '--no-audit', '--no-fund', ...tgz], base);

  const cliDir = join(base, 'node_modules', '@lightpath-dev', 'cli');
  const cli = await import(pathToFileURL(join(cliDir, 'dist', 'index.js')).href);
  const { version } = JSON.parse(readFileSync(join(cliDir, 'package.json'), 'utf8'));
  const tools = await cli.serverToolNames(version);
  log(`packed CLI ${version} ships ${tools.length} tools: ${tools.join(', ')}`);

  for (const agent of cli.AGENTS) {
    log(`\n== ${agent} (${process.platform})`);
    const app = join(work, `${agent} app`);
    cpSync(base, app, { recursive: true, verbatimSymlinks: true });
    const bin = join(app, 'node_modules', '@lightpath-dev', 'cli', 'dist', 'bin.js');
    const lp = (...args) => spawnSync(process.execPath, [bin, ...args], { cwd: app, encoding: 'utf8' });

    // 3. init, and the files it wrote.
    const first = lp('init', '--agent', agent);
    log(first.stdout.trimEnd());
    check(first.status === 0, `${agent}: init exits 0`);
    const setup = cli.AGENT_SETUP[agent];
    const written = JSON.parse(readFileSync(join(app, setup.file), 'utf8'));
    const want = { [setup.key]: { lightpath: cli.mcpEntry(agent, version, process.platform) } };
    check(
      JSON.stringify(written) === JSON.stringify(want),
      `${agent}: ${setup.file} is ${JSON.stringify(want)}`,
    );
    const agentsMd = readFileSync(join(app, 'AGENTS.md'), 'utf8');
    check(agentsMd.includes(cli.agentsBlock(tools)), `${agent}: AGENTS.md holds the block for these tools`);
    const lpConfig = JSON.parse(readFileSync(join(app, 'lightpath.config.json'), 'utf8'));
    check(lpConfig.command === 'npm run dev', `${agent}: lightpath.config.json command is "npm run dev"`);
    const second = lp('init', '--agent', agent);
    check(
      second.status === 0 && !/^(created|updated)/m.test(second.stdout),
      `${agent}: a second init changes nothing`,
    );

    // 4. The configured command, exactly as written, with no shell, offline.
    const entry = written[setup.key].lightpath;
    const probe = await cli.probeMcpCommand(entry.command, entry.args, {
      cwd: app,
      env: { ...process.env, npm_config_offline: 'true' },
      timeoutMs: 60_000,
      version,
    });
    log(
      `${[entry.command, ...entry.args].join(' ')} -> ${JSON.stringify({ ...probe, stderr: probe.stderr.slice(-500) })}`,
    );
    check(
      probe.ok && JSON.stringify(probe.tools) === JSON.stringify(tools),
      `${agent}: the configured command answers initialize and tools/list with the ${tools.length} tools`,
    );

    // 5. doctor.
    if (skipDoctor) {
      log('doctor skipped (SETUP_CHECK_SKIP_DOCTOR=1)');
      continue;
    }
    const doc = lp('doctor');
    log(doc.stdout.trimEnd());
    if (doc.stderr.trim()) log(doc.stderr.trimEnd());
    check(doc.status === 0, `${agent}: doctor exits 0`);
  }

  // `init --agent other` (D-155): no client config, the entry printed, and that entry starts.
  {
    log(`\n== other (${process.platform})`);
    const app = join(work, 'other app');
    cpSync(base, app, { recursive: true, verbatimSymlinks: true });
    const bin = join(app, 'node_modules', '@lightpath-dev', 'cli', 'dist', 'bin.js');
    const lp = (...args) => spawnSync(process.execPath, [bin, ...args], { cwd: app, encoding: 'utf8' });
    const first = lp('init', '--agent', 'other');
    log(first.stdout.trimEnd());
    check(first.status === 0, 'other: init exits 0');
    const snippet = cli.genericSnippet(version, process.platform);
    check(first.stdout.includes(snippet), 'other: init prints the mcpServers entry for this OS');
    const clientFiles = Object.values(cli.AGENT_SETUP).filter((s) => existsSync(join(app, s.file)));
    check(clientFiles.length === 0, 'other: init writes no client config');
    const agentsMd = readFileSync(join(app, 'AGENTS.md'), 'utf8');
    check(agentsMd.includes(cli.agentsBlock(tools)), 'other: AGENTS.md holds the block for these tools');
    const entry = JSON.parse(snippet).mcpServers.lightpath;
    const probe = await cli.probeMcpCommand(entry.command, entry.args, {
      cwd: app,
      env: { ...process.env, npm_config_offline: 'true' },
      timeoutMs: 60_000,
      version,
    });
    check(
      probe.ok && JSON.stringify(probe.tools) === JSON.stringify(tools),
      `other: the printed command answers initialize and tools/list with the ${tools.length} tools`,
    );
    if (!skipDoctor) check(lp('doctor').status === 0, 'other: doctor exits 0');
  }

  // 6. Windows only: does a bare npx start without a shell? Recorded, not judged (D-120).
  if (isWin) {
    const app = join(work, 'claude-code app');
    const bare = await cli.probeMcpCommand('npx', ['-y', `@lightpath-dev/cli@${version}`, 'mcp'], {
      cwd: app,
      env: { ...process.env, npm_config_offline: 'true' },
      timeoutMs: 60_000,
      version,
    });
    log(
      `\nWindows, bare npx with no shell -> ${JSON.stringify({ ...bare, stderr: bare.stderr.slice(-500) })}`,
    );
  }
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

if (failures.length > 0) {
  log(`\n${failures.length} failed:\n${failures.map((f) => `  ${f}`).join('\n')}`);
  process.exit(1);
}
log('\nsetup check passed');
