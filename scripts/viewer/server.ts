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
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join, normalize } from 'node:path';

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
  '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8',
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

/** Bundle a page's entry (three + lil-gui resolved from the repo's node_modules). */
async function bundle(entry: string): Promise<string> {
  const built = await Bun.build({
    entrypoints: [entry],
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

/** Page entries that /<name>.js bundles, and the shared modules they import. */
const ENTRIES = ['main', 'plate'];
const SHARED = ['pose.ts', 'shading.ts'];

/** Cached bundles plus the mtime each was built from, so source edits re-bundle. */
const cache = new Map<string, { at: number; code: string }>();

async function pageCode(name: string): Promise<string> {
  const entry = join(HERE, `${name}.ts`);
  let newest = 0;
  for (const f of [entry, ...SHARED.map((s) => join(HERE, s))]) {
    const s = await Bun.file(f).stat();
    newest = Math.max(newest, s?.mtimeMs ?? 0);
  }
  const hit = cache.get(name);
  if (hit && hit.at >= newest) return hit.code;
  const code = await bundle(entry);
  cache.set(name, { at: newest, code });
  return code;
}

// --- The gallery ------------------------------------------------------------------
// Roots whose art/renders are browsed: this checkout, plus any sibling worktree a
// subagent is building in, so their in-progress renders show up as they land.
const RENDER_ROOTS = [ROOT, ...(process.env.VIEWER_WORKTREES ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)];

type Shot = { url: string; name: string; mtime: number };

/**
 * Every PNG/JPG under a root's art/renders, with a URL the page can fetch.
 *
 * Hidden directories (`.tmp` scratch passes) and the look-dev/look bookkeeping folders are
 * skipped: they are not this pass's art. A worktree root only shows renders written after it
 * was created (git copies the whole existing history into a new worktree, so without this
 * filter every agent's gallery would repeat the main checkout's files).
 */
async function listShots(): Promise<Record<string, Shot[]>> {
  const SKIP = /(^|[\\/])\.|look-dev|helm-rebuild/;
  const out: Record<string, Shot[]> = {};
  for (const root of RENDER_ROOTS) {
    const isWorktree = root !== ROOT;
    const base = join(root, 'art', 'renders');
    // A worktree's own renders are newer than its creation; copies share that timestamp.
    const since = isWorktree ? ((await stat(root).catch(() => ({ mtimeMs: 0 }))).mtimeMs + 90_000) : 0;
    const prefix = isWorktree ? `${basename(root)}/` : '';
    const walk = async (dir: string, rel: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (SKIP.test(childRel)) continue;
          await walk(full, childRel);
        } else if (/\.(png|jpe?g)$/i.test(e.name)) {
          const st = await Bun.file(full).stat();
          if (!st || st.mtimeMs < since) continue;
          const group = `${prefix}${rel || 'root'}`;
          (out[group] ??= []).push({
            url: `/renders/${encodeURIComponent(childRel)}${prefix ? `?root=${encodeURIComponent(basename(root))}` : ''}`,
            name: e.name,
            mtime: st.mtimeMs,
          });
        }
      }
    };
    await walk(base, '');
  }
  for (const group of Object.keys(out)) out[group].sort((a, b) => b.mtime - a.mtime);
  return out;
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

    if (path === '/renders.json') {
      return Response.json(await listShots());
    }

    if (path === '/scores') {
      // The latest comparison scores, for the index page's table.
      for (const root of RENDER_ROOTS) {
        const f = Bun.file(join(root, 'art', 'renders', 'compare', 'scores.json'));
        if (await f.exists()) {
          return new Response(f, {
            headers: { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' },
          });
        }
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': TYPES['.json'] } });
    }

    if (path.startsWith('/renders/')) {
      // /renders/<rel>?root=<worktree> — serve a render from a browsed root.
      const rel = decodeURIComponent(path.slice('/renders/'.length));
      const rootName = url.searchParams.get('root');
      const root = rootName ? RENDER_ROOTS.find((r) => basename(r) === rootName) : ROOT;
      const base = join(root ?? ROOT, 'art', 'renders');
      const file = join(base, rel);
      if (!file.startsWith(base)) return new Response('no', { status: 403 });
      const f = Bun.file(file);
      if (!(await f.exists())) return new Response('not found', { status: 404 });
      return new Response(f, {
        headers: { 'Content-Type': TYPES[extname(file)] ?? 'image/png', 'Cache-Control': 'no-store' },
      });
    }

    const page = /^\/(\w+)\.js$/.exec(path)?.[1];
    if (page && ENTRIES.includes(page)) {
      return new Response(await pageCode(page), {
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

// --- Watch the renders, so the gallery fills in as the builds land -------------------
for (const root of RENDER_ROOTS) {
  const base = join(root, 'art', 'renders');
  try {
    watch(base, { recursive: true }, (_event, filename) => {
      if (!filename || !/\.(png|jpe?g)$/i.test(filename)) return;
      const key = `${root}:${filename}`;
      clearTimeout(pending.get(key));
      pending.set(
        key,
        setTimeout(() => {
          pending.delete(key);
          broadcast('render', filename);
        }, 400),
      );
    });
  } catch {
    // A root without art/renders (or a platform without recursive watch) just isn't live.
  }
}

console.log(`[viewer] http://localhost:${server.port}/  (watching ${MODELS})`);
console.log(`[viewer] gallery: http://localhost:${server.port}/gallery.html  (${RENDER_ROOTS.length} root(s))`);
