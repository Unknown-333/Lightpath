# Tested apps

Lightpath run on real open-source apps, cloned outside this repo and started with their own dev setup. Each fix found here has a decision entry. Last run: October 29, 2026, Windows 11, Node 24.13, Chrome 156.

| App                                                                                       | Frontend                         | Backend                                                          | Result                                                                                                                                                                                          | Fixes          |
| ----------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| [stepful/fullstack_boilerplate](https://github.com/stepful/fullstack_boilerplate) (small) | React 18, Vite 5                 | Fastify 4 under `nodemon` + `ts-node`, SQLite                    | Works. "Take quiz" shows 4 React files and the `GET /quizzes/:id` route lines in `backend/server.ts`, with no flags                                                                             | D-085, D-086   |
| [chrisvel/tududi](https://github.com/chrisvel/tududi) (medium)                            | React 18, webpack 5 + swc-loader | Express 4, Sequelize, SQLite                                     | Works once webpack has source maps. Login shows 46 frontend and 45 backend files. With webpack's default `devtool` there are no maps; Lightpath says so instead of showing wrong lines          | D-087 to D-091 |
| [actualbudget/actual](https://github.com/actualbudget/actual) (large)                     | React 19, Vite 8, React Compiler | Express 5 sync server, bundled by `vite build` with `.map` files | Works. "Start budgeting" shows 263 frontend files and 13 server files, mapped back to TypeScript through the bundle's external maps. The budget engine runs in a Web Worker, which isn't traced | none           |
| [louislam/uptime-kuma](https://github.com/louislam/uptime-kuma) (medium)                  | Vue 3, Vite                      | Express 4 + socket.io under `tsx`, SQLite                        | HTTP actions work (database setup, account creation, login). Saving a monitor shows 29 frontend files but no backend: it's a socket.io message, not an HTTP request                             | none           |

## What each run found

**stepful (Fastify + ts-node).** The API crashed at startup under Lightpath with `ERR_MODULE_NOT_FOUND`. Any `--import` in `NODE_OPTIONS` makes Node load the main file as an ES module, which skips `require` hooks such as ts-node's; the agent is now preloaded with `--require` (D-085). The frontend on port 3000 calls the API on 3001, so traces had no backend unless `--backend` was passed; loopback origins on any port are now tagged, which causes no CORS preflight (D-086).

**tududi (webpack).** Chrome reports each webpack module as a `webpack://` or `webpack-internal://` script, and all of them were dropped (D-087). The webpack dev server was instrumented like an app (D-088). A service worker answered the app's API calls, hiding them from request tagging (D-089). A click on the page background was labelled with the whole page's text (D-090). A CI run then showed a click's window could close during a full-page navigation (D-091).

**Actual (large, bundled backend).** No Lightpath change was needed. The sync server is one `vite build` bundle with external `.map` files, the setup the roadmap listed as untested; D-076's map reading covers it. Gap: code in Web Workers isn't collected, and Actual runs its budget engine in one.

**Uptime Kuma (Vue, socket.io).** No Lightpath change was needed, and Vue single-file components map through Vite like React. Gap: most of the app talks over one socket.io WebSocket, and backend work is only bracketed per HTTP request.

## App setup notes (not Lightpath issues)

- stepful pins `better-sqlite3` 11, which has no prebuilt binary for Node 24; the trial used 12.
- tududi and Actual start with POSIX shell scripts; on Windows their two processes were started with `concurrently`.
- Actual needs `ELECTRON_SKIP_BINARY_DOWNLOAD=1` to install quickly, and its sync server is built once with `yarn workspace @actual-app/sync-server build`.
- Uptime Kuma's split dev setup (frontend on 3000, server on 3001) needs `UPTIME_KUMA_WS_ORIGIN_CHECK=bypass`, and it refuses passwords found in breach lists.

## Open items found

- Trace Web Worker code (Chrome `Target.setAutoAttach` for dedicated workers).
- Bracket socket.io (or plain WebSocket) messages on the backend, so real-time apps show their server code.
- Two scripts in Uptime Kuma's server were dropped as `no-source` after its database setup step restarted the main server code; not investigated yet.
