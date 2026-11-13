/**
 * Live model viewer server.
 *
 *   bun run view          (or: bun run scripts/viewer/server.ts)
 *
 * Bundles scripts/viewer/main.ts with Bun's bundler, serves the page, and pushes a
 * reload over SSE whenever a .glb under public/models changes, so a Blender rebuild
 * shows up in the open browser tab without a manual refresh. Editing the viewer's own
 * source re-bundles on the next request, so a reload picks up changes too.
 */
import { watch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const HERE = import.meta.dir;
const ROOT = join(HERE, '..', '..');
const MODELS = join(ROOT, 'public', 'models');
const PORT = Number(process.env.PORT ?? 5178);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

/** Every SSE client, so a file change can nudge all open tabs. */
const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();

function broadcast(event: string, data: string) {
  const msg = new TextEncoder().encode(`event: ${event}\ndata: ${data}\n\n`);
  for (const c of clients) {
    try {
      c.enqueue(msg);
    } catch {
      clients.delete(c);
    }
  }
}

/** Bundle the viewer (three + lil-gui resolved from the repo's node_modules). */
async function bundle(): Promise<string> {
  const built = await Bun.build({
    entrypoints: [join(HERE, 'main.ts')],
    target: 'browser',
    format: 'esm',
    minify: false,
    sourcemap: 'inline',
  });
  if (!built.success) {
    const msg = built.logs.map((l) => String(l)).join('\n');
    console.error('[viewer] bundle failed\n' + msg);
    return `console.error(${JSON.stringify('bundle failed:\n' + msg)});`;
  }
  return await built.outputs[0].text();
}

/** Cached bundle plus the mtime it was built from, so source edits re-bundle. */
let cache: { at: number; code: string } | null = null;

async function viewerCode(): Promise<string> {
  const files = [join(HERE, 'main.ts'), join(HERE, 'index.html')];
  let newest = 0;
  for (const f of files) {
    const s = await Bun.file(f).stat();
    newest = Math.max(newest, s?.mtimeMs ?? 0);
  }
  if (!cache || cache.at < newest) {
    cache = { at: newest, code: await bundle() };
  }
  return cache.code;
}

const server = Bun.serve({
  port: PORT,
  development: true,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/events') {
      let timer: ReturnType<typeof setInterval>;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          clients.add(controller);
          controller.enqueue(new TextEncoder().encode('event: hello\ndata: ok\n\n'));
          // Keep the connection alive through proxies and idle timeouts.
          timer = setInterval(() => {
            try {
              controller.enqueue(new TextEncoder().encode(': ping\n\n'));
            } catch {
              clearInterval(timer);
            }
          }, 20_000);
        },
        cancel(controller) {
          clearInterval(timer);
          clients.delete(controller);
        },
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    if (path === '/models.json') {
      const files = (await readdir(MODELS)).filter((f) => f.endsWith('.glb')).sort();
      return Response.json(files);
    }

    if (path === '/main.js') {
      return new Response(await viewerCode(), {
        headers: { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' },
      });
    }

    // Static: the viewer's own files, then public/, then the repo root.
    const rel = normalize(path === '/' ? 'index.html' : path.slice(1));
    if (rel.startsWith('..')) return new Response('no', { status: 403 });
    for (const file of [join(HERE, rel), join(ROOT, 'public', rel), join(ROOT, rel)]) {
      const f = Bun.file(file);
      if (await f.exists()) {
        return new Response(f, {
          headers: {
            'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
            'Cache-Control': 'no-store',
          },
        });
      }
    }
    return new Response(`not found: ${path}`, { status: 404 });
  },
});

// --- Watch the models -----------------------------------------------------------
const pending = new Map<string, ReturnType<typeof setTimeout>>();
watch(MODELS, (_event, filename) => {
  if (!filename || !filename.endsWith('.glb')) return;
  // Blender writes the file several times per build (truncate, then pages), so debounce.
  clearTimeout(pending.get(filename));
  pending.set(
    filename,
    setTimeout(() => {
      pending.delete(filename);
      console.log(`[viewer] ${filename} changed -> reload`);
      broadcast('model', filename);
    }, 250),
  );
});

console.log(`[viewer] http://localhost:${server.port}/  (watching ${MODELS})`);
