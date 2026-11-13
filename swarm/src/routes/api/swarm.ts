import { createFileRoute } from '@tanstack/solid-router'
import { getStore } from '../../server/store'

export const Route = createFileRoute('/api/swarm')({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify(getStore().getSnapshot()), {
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        }),
    },
  },
})
