import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/solid-router'
import { TanStackRouterDevtools } from '@tanstack/solid-router-devtools'

import { HydrationScript, Loading } from '@solidjs/web'


import Header from '../components/Header'

// ui-sdk's default styles load first so the app's own CSS can override them.
import uiSdkCss from '@ui-sdk/core/web.css?url'
import styleCss from '../styles.css?url'

export const Route = createRootRouteWithContext()({
  head: () => ({
    links: [
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
