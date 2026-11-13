import { Show } from 'solid-js'
import { createFileRoute } from '@tanstack/solid-router'
import { AgentChat } from '../components/chat/AgentChat'

export const Route = createFileRoute('/chat')({
  validateSearch: (s: Record<string, unknown>) => ({
    session: typeof s.session === 'string' ? s.session : '',
    agent: typeof s.agent === 'string' && s.agent ? s.agent : undefined,
  }),
  head: () => ({ meta: [{ title: 'Agent chat · Swarm' }] }),
  component: ChatPage,
})

function ChatPage() {
  const search = Route.useSearch()
  return (
    <Show when={`${search().session}|${search().agent ?? ''}`} keyed>
      <AgentChat session={search().session} agent={search().agent} />
    </Show>
  )
}
