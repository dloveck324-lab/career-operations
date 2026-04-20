import { randomUUID } from 'crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

export type AssistantModel = 'haiku' | 'sonnet' | 'opus'
export type SessionStatus = 'running' | 'idle' | 'ended'

const MODEL_IDS: Record<AssistantModel, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-7',
}

export interface SessionEvent {
  id: number
  ts: number
  kind: 'session' | 'thinking' | 'tool' | 'user' | 'result' | 'error' | 'status' | 'done'
  data: Record<string, unknown>
}

export interface AssistantSession {
  id: string
  model: AssistantModel
  claudeSessionId?: string
  child?: ChildProcessWithoutNullStreams
  status: SessionStatus
  startedAt: number
  events: SessionEvent[]
  subscribers: Set<(ev: SessionEvent) => void>
  nextEventId: number
}

const MAX_EVENTS = 500

/**
 * Walk up from the server's src dir until we find the workspace root
 * (the package.json that declares `workspaces`). Fallback to process.cwd().
 */
function resolveRepoRoot(): string {
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url))
    for (let i = 0; i < 8; i++) {
      const pj = path.join(dir, 'package.json')
      if (existsSync(pj)) {
        try {
          const parsed = JSON.parse(readFileSync(pj, 'utf8')) as { workspaces?: unknown }
          if (parsed.workspaces) return dir
        } catch { /* ignore parse */ }
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch { /* ignore */ }
  return process.cwd()
}

const REPO_ROOT = resolveRepoRoot()

export class AssistantRegistry {
  private sessions = new Map<string, AssistantSession>()

  create(model: AssistantModel): AssistantSession {
    const id = randomUUID().slice(0, 8)
    const session: AssistantSession = {
      id,
      model,
      status: 'running',
      startedAt: Date.now(),
      events: [],
      subscribers: new Set(),
      nextEventId: 0,
    }
    this.sessions.set(id, session)
    this.spawnChild(session)
    return session
  }

  get(id: string): AssistantSession | undefined {
    return this.sessions.get(id)
  }

  publish(id: string, kind: SessionEvent['kind'], data: Record<string, unknown>): SessionEvent | null {
    const session = this.sessions.get(id)
    if (!session) return null
    const ev: SessionEvent = { id: session.nextEventId++, ts: Date.now(), kind, data }
    session.events.push(ev)
    if (session.events.length > MAX_EVENTS) {
      session.events.splice(0, session.events.length - MAX_EVENTS)
    }
    for (const sub of session.subscribers) {
      try { sub(ev) } catch { /* ignore */ }
    }
    return ev
  }

  subscribe(id: string, handler: (ev: SessionEvent) => void): () => void {
    const session = this.sessions.get(id)
    if (!session) throw new Error(`assistant session ${id} not found`)
    for (const ev of session.events) {
      try { handler(ev) } catch { /* ignore */ }
    }
    session.subscribers.add(handler)
    return () => session.subscribers.delete(handler)
  }

  sendMessage(id: string, text: string): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    const child = session.child
    if (!child || child.killed || !child.stdin?.writable) return false
    const payload = { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }
    try {
      child.stdin.write(JSON.stringify(payload) + '\n')
      this.publish(id, 'user', { text })
      return true
    } catch {
      return false
    }
  }

  changeModel(id: string, model: AssistantModel): boolean {
    const session = this.sessions.get(id)
    if (!session) return false
    if (!session.claudeSessionId) {
      // Haven't got the system init yet — just update the model; next spawn picks it up.
      session.model = model
      this.publish(id, 'status', { model, note: 'model change deferred until session id available' })
      return true
    }
    // Kill current child, respawn with --resume to preserve transcript.
    if (session.child && !session.child.killed) {
      try { session.child.kill('SIGKILL') } catch { /* ignore */ }
    }
    session.model = model
    this.publish(id, 'status', { model, resumed: true })
    this.spawnChild(session, { resume: session.claudeSessionId })
    return true
  }

  end(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    if (session.child && !session.child.killed) {
      try { session.child.kill('SIGKILL') } catch { /* ignore */ }
    }
    session.status = 'ended'
    this.publish(id, 'status', { status: 'ended' })
    this.publish(id, 'done', { summary: 'ended by user' })
  }

  private spawnChild(session: AssistantSession, opts: { resume?: string } = {}): void {
    const args = [
      '-p', '/dave-assistant',
      '--model', MODEL_IDS[session.model],
      '--dangerously-skip-permissions',
      '--verbose',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
    ]
    if (opts.resume) {
      args.push('--resume', opts.resume)
    }

    const child = spawn('claude', args, {
      cwd: REPO_ROOT,
      env: { ...process.env },
    })
    session.child = child
    session.status = 'running'

    let buf = ''
    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        this.handleStreamLine(session, line)
      }
    })

    child.stderr.on('data', (c: Buffer) => {
      const msg = c.toString().trim().slice(0, 600)
      if (msg) this.publish(session.id, 'error', { source: 'stderr', message: msg })
    })

    child.on('error', (err) => {
      this.publish(session.id, 'error', { message: `spawn failed: ${err.message}` })
    })

    child.on('close', (code) => {
      this.publish(session.id, 'status', { childClosed: true, code })
      if (session.status !== 'ended') {
        session.status = 'idle'
      }
    })
  }

  private handleStreamLine(session: AssistantSession, line: string): void {
    try {
      const ev = JSON.parse(line) as {
        type?: string
        subtype?: string
        session_id?: string
        message?: {
          content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>
        }
        result?: string
      }
      if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) {
        session.claudeSessionId = ev.session_id
        this.publish(session.id, 'session', { sessionId: ev.session_id })
        return
      }
      if (ev.type === 'assistant' && ev.message?.content) {
        for (const c of ev.message.content) {
          if (c.type === 'text' && c.text?.trim()) {
            this.publish(session.id, 'thinking', { text: c.text })
          } else if (c.type === 'tool_use') {
            const input = c.input ?? {}
            let hint = ''
            if (typeof input.command === 'string') hint = input.command.slice(0, 200)
            else if (typeof input.url === 'string') hint = input.url
            else if (typeof input.file_path === 'string') hint = input.file_path
            this.publish(session.id, 'tool', { name: c.name, hint, input })
          }
        }
        return
      }
      if (ev.type === 'result' && ev.result) {
        this.publish(session.id, 'result', { text: ev.result })
        return
      }
    } catch {
      /* ignore non-JSON */
    }
  }
}

export const assistantRegistry = new AssistantRegistry()
