// Entry point for `node --import=<file URL of this file>`. Set up by `lightpath dev`.
// Must never throw: the user's app has to start whether or not Lightpath works.
import { startAgent } from './start.js';

try {
  startAgent();
} catch {
  // startAgent already catches and logs; this guards against anything truly unexpected.
}
