// Production server for the swarm dashboard.
// `vite build` emits dist/client (static assets) and dist/server/server.js
// (a web-standard `fetch` handler). This file serves the first and falls back
// to the second, on Node, via srvx. It never compresses or buffers responses,
// so the SSE route /api/swarm/stream streams as written.
// Env: HOST (default 127.0.0.1), PORT (default 3000).
import { serve } from 'srvx'
import { serveStatic } from 'srvx/static'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('./dist', import.meta.url))
const { default: app } = await import('./dist/server/server.js')

const server = serve({
  hostname: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT) || 3000,
  middleware: [serveStatic({ dir: `${root}/client` })],
  fetch: (request) => app.fetch(request),
})
await server.ready()
console.log(`swarm listening on ${server.url}`)

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(true).finally(() => process.exit(0))
  })
}
