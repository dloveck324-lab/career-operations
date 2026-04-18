import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'

interface PinchTabConfig {
  serverUrl: string
  instanceUrl: string
  token: string | null
  timeoutMs: number
}

interface SnapNode {
  ref: string
  role: string
  name?: string
  value?: string
  depth?: number
}

interface SnapResult {
  nodes: SnapNode[]
  url: string
  title: string
  count: number
}

interface InstanceInfo {
  id: string
  profileId: string
  profileName: string
  port: string
  url: string
  headless: boolean
  status: string
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
      timeoutMs: overrides.timeoutMs ?? 45_000,
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

  async listInstances(): Promise<InstanceInfo[]> {
    const res = await fetch(`${this.cfg.serverUrl}/instances`, {
      headers: this.headers,
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return []
    return res.json().catch(() => []) as Promise<InstanceInfo[]>
  }

  async stopProfile(profileId: string): Promise<void> {
    await fetch(`${this.cfg.serverUrl}/profiles/${profileId}/stop`, {
      method: 'POST',
      headers: this.headers,
      signal: AbortSignal.timeout(15_000),
    }).catch(() => undefined)
    // wait briefly for the instance to release its port
    await new Promise(r => setTimeout(r, 1000))
  }

  async startProfile(profileName: string, headless: boolean): Promise<InstanceInfo | null> {
    const res = await fetch(`${this.cfg.serverUrl}/profiles/${profileName}/start`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ headless }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`startProfile failed: HTTP ${res.status} — ${text.slice(0, 200)}`)
    }
    return res.json().catch(() => null) as Promise<InstanceInfo | null>
  }

  async waitForInstanceReady(instanceUrl: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    let lastErr = 'unknown'
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${instanceUrl}/health`, {
          headers: this.headers,
          signal: AbortSignal.timeout(2_000),
        })
        if (res.ok) {
          const data = await res.json().catch(() => ({})) as { status?: string }
          if (data.status === 'ok') return
          lastErr = `status=${data.status ?? 'unknown'}`
        } else {
          lastErr = `HTTP ${res.status}`
        }
      } catch (e) {
        lastErr = (e as Error).message
      }
      await new Promise(r => setTimeout(r, 500))
    }
    throw new Error(`Instance not ready after ${timeoutMs}ms (${lastErr})`)
  }

  /**
   * Ensure a running instance for the given profile in the desired mode.
   * Returns the instance URL to use for browser control.
   */
  async ensureInstance(profileName = 'default', headless = true): Promise<string> {
    const instances = await this.listInstances()
    const existing = instances.find(i => i.profileName === profileName && i.status === 'running')

    if (existing && existing.headless === headless) {
      return existing.url
    }

    if (existing) {
      // Mode mismatch — stop and restart in desired mode
      await this.stopProfile(existing.profileId)
    }

    const started = await this.startProfile(profileName, headless)
    if (!started?.url) throw new Error('Failed to start PinchTab instance')
    await this.waitForInstanceReady(started.url)
    return started.url
  }

  setInstanceUrl(url: string): void {
    this.cfg.instanceUrl = url
  }

  async navigate(url: string): Promise<void> {
    await this.instancePost('/navigate', { url })
  }

  async snap(): Promise<SnapResult> {
    const res = await this.instanceGet('/snapshot', { filter: 'interactive' })
    return res as SnapResult
  }

  async fill(selector: string, value: string): Promise<void> {
    await this.instancePost('/action', { kind: 'fill', selector, text: value })
  }

  async click(selector: string): Promise<void> {
    await this.instancePost('/action', { kind: 'click', selector })
  }

  private async instanceGet(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(`${this.cfg.instanceUrl}${path}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    const res = await fetch(url.toString(), {
      headers: this.headers,
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`PinchTab GET ${path}: HTTP ${res.status} — ${text.slice(0, 200)}`)
    }
    return res.json().catch(() => ({}))
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
      throw new Error(`PinchTab POST ${path}: HTTP ${res.status} — ${text.slice(0, 200)}`)
    }
    return res.json().catch(() => ({}))
  }
}
