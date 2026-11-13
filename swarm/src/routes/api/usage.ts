import { createFileRoute } from '@tanstack/solid-router'
import { probePlanUsage, probeStatus } from '../../server/planProbe'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

function sameOrigin(request: Request): boolean {
  try {
    return new URL(request.headers.get('origin') ?? '').host === request.headers.get('host')
  } catch {
    return false
  }
}

export const Route = createFileRoute('/api/usage')({
  server: {
    handlers: {
      GET: () => json(probeStatus()),
      // Takes a fresh plan reading (a tiny Haiku turn); the result shows up in the snapshot.
      POST: ({ request }) => {
        if (!sameOrigin(request)) return json({ error: 'Cross-origin request refused' }, 403)
        return json({ ...probePlanUsage(false), ...probeStatus() })
      },
    },
  },
})
