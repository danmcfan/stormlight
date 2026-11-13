import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/solid-router'
import { TanStackRouterDevtools } from '@tanstack/solid-router-devtools'

import { HydrationScript, Loading } from '@solidjs/web'


import Header from '../components/Header'
import { GemDefs } from '../components/frame/GemDefs'

// ui-sdk's default styles load first so the app's own CSS can override them.
import uiSdkCss from '@ui-sdk/core/web.css?url'
import styleCss from '../styles.css?url'

export const Route = createRootRouteWithContext()({
  head: () => ({
    meta: [
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'color-scheme', content: 'dark' },
      { name: 'theme-color', content: '#000000' },
      { title: 'Swarm' },
    ],
    links: [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@400;700&family=Marcellus+SC&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap',
      },
      { rel: 'stylesheet', href: uiSdkCss },
      { rel: 'stylesheet', href: styleCss },
    ],
  }),
  shellComponent: RootComponent,
})

function RootComponent() {
  return (
    <html>
      <head>
        <HydrationScript />
        <HeadContent />
      </head>
      <body>
        <GemDefs />
        <Loading>
          <Header />
          <Outlet />
          <TanStackRouterDevtools />
        </Loading>
        <Scripts />
      </body>
    </html>
  )
}
