import { createFileRoute } from '@tanstack/solid-router'
import { Fleet } from '../components/fleet/Fleet'

export const Route = createFileRoute('/')({
  head: () => ({ meta: [{ title: 'Fleet · Swarm' }] }),
  component: Fleet,
})
