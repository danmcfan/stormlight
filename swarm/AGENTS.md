# Swarm: agent guide

A Solid 2 + TanStack Start app that lives in `swarm/` inside the Stormlight repo.
It has its own `package.json`; run npm commands from this folder. The game at the
repo root and its deploy are separate and must not depend on anything here.

## ui-sdk

Before using ui-sdk, follow the ui-sdk skill if it's installed, and read
`node_modules/@ui-sdk/solid/docs/llms.txt`. To build a new component, also
search `node_modules/@ui-sdk/solid/docs/core.md` by heading, and read
`rendering.md` next to it.

ui-sdk's default stylesheet (`@ui-sdk/core/web.css`) is linked first in
`src/routes/__root.tsx`, before `src/styles.css`, so the app's CSS overrides it.

## Solid 2

This app runs the Solid 2 release candidates: JSX and the DOM helpers come from
`@solidjs/web` (not `solid-js/web`), and `<Loading>` replaces `<Suspense>`.
