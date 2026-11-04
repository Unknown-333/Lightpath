// Builds every Lightpath brand image from the sprite data in brand/src, then checks them.
//   pnpm brand:build              all outputs (needs FFMPEG=<full path to ffmpeg> for MP4/WebM)
//   pnpm brand:build --no-video   skip MP4/WebM
// Deliverables go to brand/out/; concept stills and review sheets to brand/review/.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAnimation } from './src/animate.mjs';
import { runChecks } from './src/check.mjs';
import { buildStills } from './stills.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const video = !process.argv.includes('--no-video');

buildStills();
await buildAnimation(join(root, 'out'), { video });
const report = await runChecks(root, { video });
writeFileSync(join(root, 'out', 'check.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.summary, null, 2));
if (!report.ok) {
  console.error(`brand check failed:\n${report.fails.join('\n')}`);
  process.exit(1);
}
console.log('brand check passed');
