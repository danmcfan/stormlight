import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useLocation,
} from '@tanstack/solid-router'

import { HydrationScript, Loading } from '@solidjs/web'

import Header from '../components/Header'
import { GemDefs } from '../components/frame/GemDefs'
import { SphereFrame } from '../components/frame/SphereFrame'
import { LeadPanel } from '../components/lead/LeadPanel'

// ui-sdk's default styles load first so the app's own CSS can override them.
import uiSdkCss from '@ui-sdk/core/web.css?url'
import styleCss from '../styles.css?url'
import calmCss from '../calm.css?url'

export const Route = createRootRouteWithContext()({
  head: () => ({
    meta: [
      // viewport-fit=cover lets the app draw under the notch/Dynamic Island; the
      // layout pads itself with env(safe-area-inset-*).
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { name: 'color-scheme', content: 'dark' },
      { name: 'theme-color', content: '#000000' },
      // Home Screen web app (iPhone): full screen, no Safari bars.
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-title', content: 'Swarm' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      { title: 'Swarm' },
    ],
    links: [
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@400;700&family=Marcellus+SC&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap',
      },
      { rel: 'stylesheet', href: uiSdkCss },
      { rel: 'stylesheet', href: styleCss },
      { rel: 'stylesheet', href: calmCss },
    ],
  }),
  shellComponent: RootComponent,
})

function AppLayout() {
  const location = useLocation()
  const leadSide = () => location().pathname !== '/lead'
  return (
    <div class="app" data-lead-side={leadSide() ? '' : undefined}>
      <Header />
      <div class="app-main">
        <Outlet />
      </div>
      <aside class="side-lead" aria-label="Lead agent">
        <SphereFrame glow={0.8}>
          <LeadPanel />
        </SphereFrame>
      </aside>
    </div>
  )
}

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
          <AppLayout />
        </Loading>
        <Scripts />
      </body>
    </html>
  )
}
