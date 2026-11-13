import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tailwindcss from '@tailwindcss/vite'

import { tanstackStart } from '@tanstack/solid-start/plugin/vite'

import solidPlugin from 'vite-plugin-solid'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // The dev server is reached over Tailscale (agent-box.<tailnet>.ts.net) on the
  // agent box; Vite refuses unknown Host headers otherwise.
  server: {
    allowedHosts: ['.ts.net', 'agent-box'],
    // Behind `tailscale serve` (HTTPS on 443) the HMR socket must use that port.
    hmr: process.env.SWARM_HMR_CLIENT_PORT ? { clientPort: Number(process.env.SWARM_HMR_CLIENT_PORT) } : undefined,
  },
  plugins: [
    devtools(),
    tailwindcss(),
    tanstackStart(),
    solidPlugin({ ssr: true }),
  ],
})
