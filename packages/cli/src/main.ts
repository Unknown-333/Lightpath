import { runMcpServer } from '@lightpath-dev/mcp';
import { cac } from 'cac';
import { dev } from './dev.js';
import { doctor } from './doctor.js';

export const VERSION = '0.0.0';

const list = (v: string | string[] | undefined): string[] | undefined =>
  v === undefined
    ? undefined
    : (Array.isArray(v) ? v : [v]).flatMap((s) => String(s).split(',')).filter(Boolean);

/** Builds the CLI. Returns the process exit code. */
export async function main(argv: string[]): Promise<number> {
  const cli = cac('lightpath');
  let result: Promise<number> = Promise.resolve(0);

  cli
    .command('dev', 'Run your dev command with Lightpath, open your app, and print the code each click ran')
    .usage('dev [options] -- <command...>')
    .option('--url <url>', 'App URL (default: detected from the command output)')
    .option('--web-root <dir>', 'Directory the dev server serves from (default: current directory)')
    .option('--backend <origin>', 'Extra backend origin to tag with the trace header (repeatable)')
    .option('--root <dir>', 'Workspace root to show files from (repeatable; default: current directory)')
    .option('--no-browser', "Don't open a browser; trace backend requests only")
    .option('--headless', 'Run the browser without a window')
    .option('--debug', 'Print Lightpath internals')
    .example('lightpath dev -- npm run dev')
    .example('lightpath dev --url http://localhost:5173 -- pnpm dev')
    .action((options: Record<string, unknown>) => {
      result = dev({
        command: (options['--'] as string[] | undefined) ?? [],
        url: options.url as string | undefined,
        webRoot: options.webRoot as string | undefined,
        backend: list(options.backend as string | string[] | undefined),
        roots: list(options.root as string | string[] | undefined),
        browser: options.browser as boolean | undefined,
        headless: options.headless as boolean | undefined,
        debug: options.debug as boolean | undefined,
      });
    });

  cli
    .command('mcp', 'Run the MCP server over stdio for coding agents (reads .lightpath/daemon.json)')
    .option('--root <dir>', 'Workspace root (default: current directory)')
    .action((options: Record<string, unknown>) => {
      result = runMcpServer({ workspaceRoot: (options.root as string | undefined) ?? process.cwd() }).then(
        () => new Promise<number>(() => {}), // stays alive until the client closes stdin
      );
    });

  cli.command('doctor', 'Check that Lightpath can run here').action(() => {
    result = doctor(process.cwd());
  });

  cli.help();
  cli.version(VERSION);
  cli.parse(argv, { run: false });
  if (!cli.matchedCommand && !cli.options.help && !cli.options.version) {
    cli.outputHelp();
    return cli.args.length > 0 ? 1 : 0;
  }
  await cli.runMatchedCommand();
  return result;
}
