import { createFileRoute } from '@tanstack/solid-router'
import { getStore } from '../../server/store'
import { readTranscriptImage } from '../../server/transcript'

const SAFE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export const Route = createFileRoute('/api/transcript/image')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        const session = url.searchParams.get('session') ?? ''
        const agent = url.searchParams.get('agent')
        const uuid = url.searchParams.get('uuid') ?? ''
        const index = Number(url.searchParams.get('i') ?? '0')
        const path = getStore().transcriptPath(session, agent)
        if (!path || !/^[\w-]{8,64}$/.test(uuid) || !Number.isInteger(index) || index < 0) {
          return new Response('Not found', { status: 404 })
        }
        const img = readTranscriptImage(path, uuid, index)
        if (!img) return new Response('Not found', { status: 404 })
        return new Response(new Uint8Array(img.data), {
          headers: {
            // Never let an image record claim to be HTML or SVG.
            'content-type': SAFE_TYPES.has(img.mediaType) ? img.mediaType : 'application/octet-stream',
            'x-content-type-options': 'nosniff',
            'cache-control': 'private, max-age=31536000, immutable',
          },
        })
      },
    },
  },
})
