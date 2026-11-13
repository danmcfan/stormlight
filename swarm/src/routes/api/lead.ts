import { createFileRoute } from '@tanstack/solid-router'
import { getLead } from '../../server/lead'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

/**
 * This endpoint runs Claude Code with tools on the box, so only the dashboard
 * itself may call it: the Origin must match the host, and the body must be JSON
 * (a cross-site page cannot send that without a CORS preflight, which we never
 * answer). That keeps a web page open on the same phone from driving the lead.
 */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (!origin || !host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export const Route = createFileRoute('/api/lead')({
  server: {
    handlers: {
      GET: () => json(getLead().getState()),
      POST: async ({ request }) => {
        if (!sameOrigin(request)) return json({ error: 'Cross-origin request refused' }, 403)
        if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) {
          return json({ error: 'Expected application/json' }, 415)
        }
        let body: { action?: string; prompt?: string; imageIds?: unknown; model?: string; subagentModel?: string }
        try {
          body = await request.json()
        } catch {
          return json({ error: 'Invalid JSON' }, 400)
        }
        const lead = getLead()
        try {
          switch (body.action ?? 'send') {
            case 'send': {
              const imageIds = Array.isArray(body.imageIds) ? body.imageIds.map((id) => String(id)) : undefined
              return json(lead.send(String(body.prompt ?? ''), imageIds))
            }
            case 'stop':
              return json(lead.stop())
            case 'reset':
              return json(lead.reset())
            case 'model':
              return json(lead.setModel(body.model, body.subagentModel))
            default:
              return json({ error: 'Unknown action' }, 400)
          }
        } catch (e) {
          return json({ error: (e as Error).message }, 400)
        }
      },
    },
  },
})
