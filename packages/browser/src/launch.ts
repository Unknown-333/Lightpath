import { type Browser, chromium } from 'playwright-core';

/** Installed browsers first, so users don't download one; Playwright's own Chromium last. */
const CHANNELS: readonly (string | undefined)[] = ['chrome', 'msedge', undefined];

export interface LaunchOptions {
  headless?: boolean;
  /** Force one channel, for example 'chrome-beta'. */
  channel?: string;
}

export async function launchBrowser(options: LaunchOptions = {}): Promise<Browser> {
  const tried: string[] = [];
  for (const channel of options.channel ? [options.channel] : CHANNELS) {
    try {
      return await chromium.launch({ headless: options.headless ?? false, ...(channel ? { channel } : {}) });
    } catch (err) {
      tried.push(`${channel ?? 'Playwright Chromium'}: ${String((err as Error).message).split('\n')[0]}`);
    }
  }
  throw new Error(
    `Lightpath couldn't start a Chromium-based browser. Tried:\n  ${tried.join('\n  ')}\n` +
      'Install Google Chrome or Microsoft Edge, or run: npx playwright install chromium',
  );
}
