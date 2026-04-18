import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'

interface PinchTabConfig {
  serverUrl: string
  instanceUrl: string
  token: string | null
  timeoutMs: number
}

interface Element {
  ref: string
  tag: string
  type?: string
  label?: string
  placeholder?: string
  value?: string
}

interface SnapResult {
  elements: Element[]
  url: string
  title: string
}

function readToken(): string | null {
  const cfgPath = resolve(homedir(), '.pinchtab', 'config.json')
  if (!existsSync(cfgPath)) return null
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8')) as { server?: { token?: string } }
    return cfg?.server?.token ?? null
  } catch { return null }
}

export class PinchTabClient {
  private cfg: PinchTabConfig

  constructor(overrides: Partial<PinchTabConfig> = {}) {
    this.cfg = {
      serverUrl: overrides.serverUrl ?? 'http://127.0.0.1:9867',
      instanceUrl: overrides.instanceUrl ?? 'http://127.0.0.1:9868',
      token: overrides.token ?? readToken(),
      timeoutMs: overrides.timeoutMs ?? 30_000,
    }
  }

  private get headers(): HeadersInit {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.cfg.token) h['Authorization'] = `Bearer ${this.cfg.token}`
    return h
  }

  async isReachable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.cfg.serverUrl}/health`, {
        headers: this.headers,
        signal: AbortSignal.timeout(3_000),
      })
      const data = await res.json().catch(() => ({})) as { status?: string }
      return data.status === 'ok'
    } catch { return false }
  }

  async startInstance(mode: 'headless' | 'headed' = 'headless'): Promise<void> {
    await fetch(`${this.cfg.serverUrl}/instances/start`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ profileId: 'default', mode }),
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    })
  }

  async navigate(url: string): Promise<void> {
    await this.instancePost('/nav', { url })
  }

  async snap(): Promise<SnapResult> {
    const res = await this.instancePost('/snap', { interactive: true, clickable: true })
    return res as SnapResult
  }

  async fill(ref: string, value: string): Promise<void> {
    await this.instancePost('/fill', { ref, value })
  }

  async click(ref: string): Promise<void> {
    await this.instancePost('/click', { ref })
  }

  async getText(): Promise<string> {
    const res = await this.instancePost('/text', {}) as { text?: string }
    return res.text ?? ''
  }

  async showBrowser(): Promise<void> {
    await fetch(`${this.cfg.serverUrl}/instances/show`, {
      method: 'POST',
      headers: this.headers,
      signal: AbortSignal.timeout(5_000),
    })
  }

  private async instancePost(path: string, body: object): Promise<unknown> {
    const res = await fetch(`${this.cfg.instanceUrl}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`PinchTab ${path}: HTTP ${res.status} — ${text.slice(0, 200)}`)
    }
    return res.json().catch(() => ({}))
  }
}
