import { createFileRoute } from '@tanstack/solid-router'
import { getStore } from '../../server/store'

const HEARTBEAT_MS = 4000

export const Route = createFileRoute('/api/swarm/stream')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const store = getStore()
        const enc = new TextEncoder()
        let cleanup = () => {}
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            let closed = false
            const send = (snap: unknown) => {
              if (closed) return
              try {
                controller.enqueue(enc.encode(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`))
              } catch {
                cleanup()
              }
            }
            const unsubscribe = store.subscribe(send)
            const beat = setInterval(() => send(store.getSnapshot()), HEARTBEAT_MS)
            cleanup = () => {
              if (closed) return
              closed = true
              clearInterval(beat)
              unsubscribe()
              try {
                controller.close()
              } catch {
                /* already closed */
              }
            }
            request.signal.addEventListener('abort', cleanup)
            send(store.getSnapshot())
          },
          cancel() {
            cleanup()
          },
        })
        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          },
        })
      },
    },
  },
})
