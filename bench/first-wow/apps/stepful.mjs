// stepful/fullstack_boilerplate: React 18 + Vite 5 frontend, Fastify 4 API under nodemon + ts-node.
// Chosen by the rule in ../README.md. The expected files below were written before the first run.

export default {
  name: 'stepful',
  repo: 'https://github.com/stepful/fullstack_boilerplate.git',
  commit: '072a62ab96e0458b66b17c64f6967ac19ee99721',
  ports: { web: 3310, api: 3311 },
  /** Config files the app's README tells you to create (copies of .env.sample), with our ports. */
  files: {
    'backend/.env': 'BACKEND_SERVER_PORT=3311\n',
    // vite.config.ts reads the port from frontend/ and import.meta.env from the repo root (envDir "../.").
    'frontend/.env.local': 'VITE_FRONTEND_SERVER_PORT=3310\n',
    '.env.local': 'VITE_BACKEND_SERVER=localhost:3311\n',
  },
  /**
   * Untimed setup. better-sqlite3 11.6.0 (the app's lockfile) has no prebuilt binary for Node 24,
   * so it is moved to 12.11.1, as in docs/tested-apps.md. That changes package.json and the
   * lockfile, not the app's code. Then the app's own migrate script seeds the database.
   */
  install: [
    'npm install better-sqlite3@12.11.1 --workspace backend',
    'npm run db:migrate --workspace backend',
  ],
  /** The app's own dev command, from its README. */
  dev: 'npm run dev',
  /**
   * Lightpath flags this app needs: Vite serves from frontend/. Run 1 also passed
   * `--url http://localhost:3310`; Lightpath 0.0.2 opened that URL before Vite was up, got
   * ERR_CONNECTION_REFUSED and never retried, so the app never opened. From run 2 the URL is
   * detected from the dev command's output instead (README.md, "Changes after results").
   */
  lightpathFlags: ['--web-root', 'frontend'],
  action: 'Take quiz',
  /** The check, fixed before the run: one right frontend file and the right backend file. */
  expected: {
    frontend: ['frontend/src/pages/quiz.tsx', 'frontend/src/components/quiz.tsx'],
    backend: ['backend/server.ts'],
  },
};
