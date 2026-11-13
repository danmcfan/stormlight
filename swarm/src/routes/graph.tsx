import { createFileRoute } from '@tanstack/solid-router'
import GraphView from '../components/graph/GraphView'
import { useSwarm } from '../lib/useSwarm'

export const Route = createFileRoute('/graph')({
  head: () => ({ meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }] }),
  component: GraphPage,
})

function GraphPage() {
  const swarm = useSwarm()
  return <GraphView snapshot={swarm.snapshot()} connected={swarm.connected()} />
}
