import { randomUUID } from 'crypto'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import type { AutofillModel } from './autofill.js'

export type RunStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

export interface RunEvent {
  id: number
  ts: number
  kind:
    | 'prompt'           // the system prompt we built (sent once at start)
    | 'session'          // { sessionId }
    | 'thinking'         // assistant text snippet
    | 'tool'             // tool_use { name, hint }
    | 'user'             // user-injected message echo
    | 'compact'          // /compact event injected
    | 'status'           // status transitions
    | 'result'           // final result text
    | 'error'            // any error
    | 'done'             // terminal
  data: Record<string, unknown>
}

export interface Run {
  id: string                // short runId (8-char)
  jobId: number
  model: AutofillModel
  tabId?: string            // PinchTab tab ID (per-run isolation)
  sessionId?: string        // Claude session ID (from system:init)
  child?: ChildProcessWithoutNullStreams
  status: RunStatus
  startedAt: number
  endedAt?: number
  events: RunEvent[]
  subscribers: Set<(ev: RunEvent) => void>
  nextEventId: number
  compacted: number         // how many /compact we've injected
}

const MAX_EVENTS = 500      // per-run ring buffer cap
const COMPACT_THRESHOLD = 200 // when events.length crosses this, auto /compact

export class RunRegistry {
  private runs = new Map<string, Run>()
  private byJob = new Map<number, string>()   // jobId → runId (latest)

  create(jobId: number, model: AutofillModel): Run {
    // If there's an active run for this job, cancel it so we don't double-run
    const prevId = this.byJob.get(jobId)
    if (prevId) {
      const prev = this.runs.get(prevId)
      if (prev && (prev.status === 'running' || prev.status === 'queued')) {
        this.cancel(prevId)
      }
    }
    const id = randomUUID().slice(0, 8)
    const run: Run = {
      id, jobId, model,
      status: 'queued',
      startedAt: Date.now(),
      events: [],
      subscribers: new Set(),
      nextEventId: 0,
      compacted: 0,
    }
    this.runs.set(id, run)
    this.byJob.set(jobId, id)
    return run
  }

  get(runId: string): Run | undefined {
    return this.runs.get(runId)
  }

  getByJob(jobId: number): Run | undefined {
    const id = this.byJob.get(jobId)
    return id ? this.runs.get(id) : undefined
  }

  list(): Run[] {
    return Array.from(this.runs.values())
  }

  publish(runId: string, kind: RunEvent['kind'], data: Record<string, unknown>): RunEvent | null {
    const run = this.runs.get(runId)
    if (!run) return null
    const ev: RunEvent = { id: run.nextEventId++, ts: Date.now(), kind, data }
    run.events.push(ev)
    if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS)
    for (const sub of run.subscribers) {
      try { sub(ev) } catch { /* ignore */ }
    }
    return ev
  }

  subscribe(runId: string, handler: (ev: RunEvent) => void): () => void {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`run ${runId} not found`)
    // Replay buffered events so late subscribers see the whole history
    for (const ev of run.events) {
      try { handler(ev) } catch { /* ignore */ }
    }
    run.subscribers.add(handler)
    return () => run.subscribers.delete(handler)
  }

  attachChild(runId: string, child: ChildProcessWithoutNullStreams): void {
    const run = this.runs.get(runId)
    if (!run) return
    run.child = child
    run.status = 'running'
  }

  setStatus(runId: string, status: RunStatus, extra: Record<string, unknown> = {}): void {
    const run = this.runs.get(runId)
    if (!run) return
    run.status = status
    if (status === 'done' || status === 'failed' || status === 'cancelled') {
      run.endedAt = Date.now()
    }
    this.publish(runId, 'status', { status, ...extra })
  }

  setSessionId(runId: string, sessionId: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    run.sessionId = sessionId
  }

  setTabId(runId: string, tabId: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    run.tabId = tabId
  }

  /**
   * Inject a user message into the running claude child via stream-json stdin.
   * Returns true if the message was written, false if the child is not writable.
   */
  sendMessage(runId: string, text: string): boolean {
    const run = this.runs.get(runId)
    if (!run?.child?.stdin?.writable) return false
    const payload = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
    }
    try {
      run.child.stdin.write(JSON.stringify(payload) + '\n')
      this.publish(runId, 'user', { text })
      return true
    } catch {
      return false
    }
  }

  /**
   * Auto-trigger: if event count crossed the compaction threshold and we
   * haven't just compacted, inject /compact so Claude summarises the
   * transcript and frees context room.
   */
  maybeCompact(runId: string): void {
    const run = this.runs.get(runId)
    if (!run?.child?.stdin?.writable) return
    const eventsSinceLastCompact = run.events.length - run.compacted * COMPACT_THRESHOLD
    if (eventsSinceLastCompact < COMPACT_THRESHOLD) return
    try {
      const payload = {
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: '/compact' }] },
      }
      run.child.stdin.write(JSON.stringify(payload) + '\n')
      run.compacted++
      this.publish(runId, 'compact', { at: run.events.length })
    } catch { /* ignore */ }
  }

  cancel(runId: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    if (run.child && !run.child.killed) {
      try { run.child.kill('SIGTERM') } catch { /* ignore */ }
      setTimeout(() => {
        if (run.child && !run.child.killed) {
          try { run.child.kill('SIGKILL') } catch { /* ignore */ }
        }
      }, 2000)
    }
    this.setStatus(runId, 'cancelled')
  }

  /**
   * Prune finished runs older than the given age (default 30 min) to keep
   * the registry from growing unbounded. Called opportunistically.
   */
  prune(maxAgeMs = 30 * 60 * 1000): void {
    const now = Date.now()
    for (const [id, run] of this.runs.entries()) {
      if (run.status === 'running' || run.status === 'queued') continue
      if (!run.endedAt) continue
      if (now - run.endedAt > maxAgeMs) {
        this.runs.delete(id)
        if (this.byJob.get(run.jobId) === id) this.byJob.delete(run.jobId)
      }
    }
  }
}

export const runRegistry = new RunRegistry()
