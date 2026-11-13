import type { SwarmSnapshot } from '../../lib/types'

export function queueCounts(q: NonNullable<SwarmSnapshot['queue']>) {
  return { queued: q.jobs.filter((j) => j.state === 'queued').length, running: q.running, max: q.maxConcurrent }
}
