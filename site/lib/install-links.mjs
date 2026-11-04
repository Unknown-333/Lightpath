// One-click install links for Cursor and VS Code (D-155). The site builds them from here, and
// site:check checks that the page and README.md carry exactly these links.
// Formats, from each editor's docs (read 2026-11-04):
// - Cursor: cursor://anysphere.cursor-deeplink/mcp/install?name=$NAME&config=$BASE64_ENCODED_CONFIG
//   https://cursor.com/docs/context/mcp/install-links
// - VS Code: vscode:mcp/install?{url-encoded JSON with "name"}, and for web pages that can only
//   link https, https://vscode.dev/redirect?url=<url-encoded vscode: URL>
//   https://code.visualstudio.com/api/extension-guides/ai/mcp
// Both carry the macOS and Linux form (npx). On Windows, `lightpath init` writes `cmd /c npx`.

export const SERVER = { command: 'npx', args: ['-y', '@lightpath-dev/cli', 'mcp'] };

export const CURSOR_LINK = `cursor://anysphere.cursor-deeplink/mcp/install?name=lightpath&config=${Buffer.from(
  JSON.stringify(SERVER),
).toString('base64')}`;

export const VSCODE_LINK = `vscode:mcp/install?${encodeURIComponent(
  JSON.stringify({ name: 'lightpath', type: 'stdio', ...SERVER }),
)}`;

/** VS Code's link for pages such as a GitHub README, which open only http and https links. */
export const VSCODE_WEB_LINK = `https://vscode.dev/redirect?url=${encodeURIComponent(VSCODE_LINK)}`;
