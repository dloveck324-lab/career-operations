import { randomUUID } from 'crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import type { AutofillModel } from './autofill.js'

const MODEL_IDS: Record<AutofillModel, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
}

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
    | 'suggestions'      // { items: [{id, question, answer}] } — fresh answers the agent produced that aren't in field_mappings yet
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
  suggestions?: Array<{ id: string; question: string; answer: string }>
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
    this.publish(runId, 'status', { status: 'running' })
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

  setSuggestions(runId: string, items: Array<{ id: string; question: string; answer: string }>): void {
    const run = this.runs.get(runId)
    if (!run) return
    run.suggestions = items
  }

  getSuggestions(runId: string): Array<{ id: string; question: string; answer: string }> | undefined {
    return this.runs.get(runId)?.suggestions
  }

  /**
   * Inject a user message. If the claude child is still alive, pipe it via
   * stdin (live, single-session). If the run has already finished, spawn a
   * fresh `claude -p --resume <sessionId>` one-shot and bridge its stream-json
   * output back into this run's event stream so the UI feels continuous.
   */
  sendMessage(runId: string, text: string): boolean {
    const run = this.runs.get(runId)
    if (!run) return false

    // Live path — write to running child's stdin
    if (run.child?.stdin?.writable && run.status === 'running') {
      const payload = { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }
      try {
        run.child.stdin.write(JSON.stringify(payload) + '\n')
        this.publish(runId, 'user', { text })
        return true
      } catch {
        return false
      }
    }

    // Post-hoc path — spawn claude --resume <sessionId> one-shot
    if (!run.sessionId) return false
    this.publish(runId, 'user', { text })
    this.spawnFollowup(runId, text)
    return true
  }

  private spawnFollowup(runId: string, text: string): void {
    const run = this.runs.get(runId)
    if (!run?.sessionId) return

    const child = spawn('claude', [
      '-p', text,
      '--resume', run.sessionId,
      '--model', MODEL_IDS[run.model],
      '--dangerously-skip-permissions',
      '--verbose',
      '--output-format', 'stream-json',
    ], {
      env: { ...process.env, ...(run.tabId ? { PINCHTAB_TAB: run.tabId } : {}) },
    })

    let buf = ''
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        try {
          const ev = JSON.parse(line) as {
            type?: string
            message?: { content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }> }
            result?: string
          }
          if (ev.type === 'assistant' && ev.message?.content) {
            for (const c of ev.message.content) {
              if (c.type === 'text' && c.text?.trim()) {
                this.publish(runId, 'thinking', { text: c.text })
              }
              if (c.type === 'tool_use') {
                const input = c.input ?? {}
                let hint = ''
                if (typeof input.command === 'string') hint = input.command.slice(0, 200)
                else if (typeof input.url === 'string') hint = input.url
                this.publish(runId, 'tool', { name: c.name, hint, input })
              }
            }
          } else if (ev.type === 'result' && ev.result) {
            this.publish(runId, 'result', { text: ev.result })
          }
        } catch { /* non-JSON */ }
      }
    })

    child.stderr.on('data', (c: Buffer) => {
      const msg = c.toString().trim().slice(0, 400)
      if (msg) this.publish(runId, 'error', { source: 'stderr', message: msg })
    })

    child.on('error', (err) => {
      this.publish(runId, 'error', { message: `follow-up spawn failed: ${err.message}` })
    })
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
      // Immediate hard kill — user pressed Stop and expects the agent to halt now.
      try { run.child.kill('SIGKILL') } catch { /* ignore */ }
    }
    this.setStatus(runId, 'cancelled')
    this.publish(runId, 'done', { summary: 'cancelled by user' })
  }

  /**
   * Prune finished runs older than the given age (default 24h) so users can
   * still open the drawer on applications they completed today and keep
   * chatting to Claude about them. Called opportunistically.
   */
  prune(maxAgeMs = 24 * 60 * 60 * 1000): void {
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
