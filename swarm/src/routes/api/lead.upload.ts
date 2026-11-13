import { createFileRoute } from '@tanstack/solid-router'
import { readFileSync } from 'node:fs'
import { loadUpload, saveUpload } from '../../server/lead'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

/**
 * This endpoint writes files on the box, so only the dashboard itself may call
 * it: the Origin must match the host, and the body must be JSON (a cross-site
 * page cannot send that without a CORS preflight, which we never answer). That
 * keeps a web page open on the same phone from uploading through the lead.
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

export const Route = createFileRoute('/api/lead/upload')({
  server: {
    handlers: {
      /** Serves a previously uploaded image back. No same-origin check: an <img> tag can't send one. */
      GET: ({ request }) => {
        const id = new URL(request.url).searchParams.get('id') ?? ''
        const upload = loadUpload(id)
        if (!upload) return json({ error: 'Not found' }, 404)
        const data = readFileSync(upload.path)
        return new Response(new Uint8Array(data), {
          status: 200,
          headers: {
            'content-type': upload.type,
            'cache-control': 'private, max-age=31536000',
          },
        })
      },
      POST: async ({ request }) => {
        if (!sameOrigin(request)) return json({ error: 'Cross-origin request refused' }, 403)
        if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) {
          return json({ error: 'Expected application/json' }, 415)
        }
        let body: { name?: string; type?: string; data?: string }
        try {
          body = await request.json()
        } catch {
          return json({ error: 'Invalid JSON' }, 400)
        }
        try {
          const dataStr = typeof body.data === 'string' ? body.data : ''
          if (!dataStr) throw new Error('Missing image data')
          const buf = Buffer.from(dataStr, 'base64')
          const saved = saveUpload(typeof body.name === 'string' ? body.name : 'image', String(body.type ?? ''), buf)
          return json(saved)
        } catch (e) {
          return json({ error: (e as Error).message }, 400)
        }
      },
    },
  },
})
