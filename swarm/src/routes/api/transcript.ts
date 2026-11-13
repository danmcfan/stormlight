import { createFileRoute } from '@tanstack/solid-router'
import { getStore } from '../../server/store'
import { readTranscript } from '../../server/transcript'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

export const Route = createFileRoute('/api/transcript')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        const session = url.searchParams.get('session') ?? ''
        const agent = url.searchParams.get('agent')
        const store = getStore()
        const path = store.transcriptPath(session, agent)
        if (!path) return json({ error: 'Unknown agent' }, 404)
        const id = agent ?? session
        const meta = store.getSnapshot().agents.find((a) => a.id === id) ?? null
        try {
          return json({ agent: meta, ...readTranscript(path) })
        } catch (e) {
          return json({ error: (e as Error).message }, 500)
        }
      },
    },
  },
})
