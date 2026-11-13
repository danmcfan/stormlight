// Takes a plan-usage reading. Server only.
//
// Claude Code reports the 5-hour/7-day windows only to the status line of an
// interactive session, so a probe runs one tiny interactive Haiku turn in a
// pseudo-terminal (`script`), in a throwaway folder whose transcripts the store
// ignores. The status line script (/etc/swarm/plan-statusline.sh on the box)
// appends the reading to plan-usage.jsonl, which the store already reads.
// Only on the box (SWARM_LEAD_DETACH=systemd); a no-op elsewhere.
import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MIN_GAP_MS = 60_000
const AUTO_GAP_MS = 10 * 60_000

export function probeDir(): string {
  return process.env.SWARM_PLAN_PROBE_DIR || join(homedir(), '.claude', 'swarm', 'probe')
}

/** Project folders (under ~/.claude/projects) holding probe sessions, to leave out of the fleet. */
export function isProbeProject(projectDirName: string): boolean {
  return projectDirName.endsWith('-swarm-probe')
}

let lastProbe = 0
let lastError: string | null = null

export function probeStatus() {
  return { lastProbe, lastError, supported: process.env.SWARM_LEAD_DETACH === 'systemd' }
}

/**
 * Starts a probe unless one ran recently. `auto` probes (after a lead run)
 * wait at least 10 minutes between readings; manual ones at least 1 minute.
 */
export function probePlanUsage(auto = false): { started: boolean; reason?: string } {
  if (process.env.SWARM_LEAD_DETACH !== 'systemd') return { started: false, reason: 'Plan readings are only taken on the agent box.' }
  const gap = auto ? AUTO_GAP_MS : MIN_GAP_MS
  if (Date.now() - lastProbe < gap) return { started: false, reason: 'A reading was taken moments ago.' }
  lastProbe = Date.now()
  const dir = probeDir()
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* systemd-run reports the failure */
  }
  const env = ['PATH', 'HOME', 'LANG'].filter((k) => process.env[k]).map((k) => `--setenv=${k}=${process.env[k]}`)
  execFile(
    'systemd-run',
    [
      '--user',
      `--unit=swarm-plan-probe-${lastProbe}`,
      '--collect',
      '--quiet',
      '--property=RuntimeMaxSec=120',
      `--working-directory=${dir}`,
      ...env,
      '--',
      'script',
      '-qfc',
      "claude --model haiku 'Reply with just: ok'",
      '/dev/null',
    ],
    { timeout: 15_000 },
    (err, _out, stderr) => {
      lastError = err ? String(stderr).trim() || err.message : null
    },
  )
  return { started: true }
}
