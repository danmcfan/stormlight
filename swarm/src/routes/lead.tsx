import { createFileRoute } from '@tanstack/solid-router'
import { LeadChat } from '../components/lead/LeadPanel'

export const Route = createFileRoute('/lead')({
  head: () => ({ meta: [{ title: 'Lead · Swarm' }] }),
  component: LeadChat,
})
