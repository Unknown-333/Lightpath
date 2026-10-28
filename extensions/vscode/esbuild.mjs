// Bundles the extension into one CommonJS file (ADR 0005). `vscode` is provided by the host.
import { build } from 'esbuild';

const production = process.argv.includes('--production');

await build({
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
});
