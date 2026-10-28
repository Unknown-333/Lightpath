#!/usr/bin/env node
import { main } from './main.js';

main(process.argv).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`lightpath: ${(err as Error).stack ?? err}\n`);
    process.exitCode = 1;
  },
);
