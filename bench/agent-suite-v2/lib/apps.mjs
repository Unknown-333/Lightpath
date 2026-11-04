// Suite v2's apps: each bug's bug.json names its app ("tududi" or "invoices").
import { join } from 'node:path';
import * as invoices from './invoices.mjs';
import * as tududi from './tududi.mjs';

export const BUGS_DIR = tududi.BUGS_DIR;
export const SUITE_V2_DIR = tududi.SUITE_V2_DIR;
export const APPS = { tududi, invoices };

export function appFor(name) {
  const app = APPS[name];
  if (!app) throw new Error(`unknown app ${name}`);
  return app;
}

export const bugJson = (bugDir) => join(bugDir, 'bug.json');
