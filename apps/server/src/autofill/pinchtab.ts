import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { homedir } from 'os'
import { spawn } from 'child_process'

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

  async startProfile(profileName: string, headless: boolean, port = '9868'): Promise<InstanceInfo | null> {
    const res = await fetch(`${this.cfg.serverUrl}/profiles/${profileName}/start`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ headless, port }),
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
   * Always stops every other instance first so ours lands on the CLI's default
   * port (9868). Returns the instance URL.
   */
  async ensureInstance(profileName = 'default', headless = true): Promise<string> {
    const instances = await this.listInstances()
    const ours = instances.find(i => i.profileName === profileName && i.status === 'running')

    // Stop every running instance that isn't already ours in the right mode
    for (const inst of instances) {
      if (inst.status !== 'running') continue
      if (inst.profileName === profileName && inst.headless === headless && inst.port === '9868') {
        continue // ours, already good
      }
      await this.stopProfile(inst.profileId)
    }

    // Re-read after stops
    const after = await this.listInstances()
    const alive = after.find(i => i.profileName === profileName && i.status === 'running' && i.headless === headless && i.port === '9868')
    if (alive) return alive.url

    // Nothing usable on 9868 → start fresh
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

  async navigateNewTab(url: string): Promise<string> {
    const res = await this.instancePost('/navigate', { url, newTab: true }) as { tabId?: string }
    if (!res.tabId) throw new Error('PinchTab did not return a tabId')
    return res.tabId
  }

  /**
   * Navigate the current active tab (no new tab creation) and return whatever
   * tabId the response carries. Falls back to 'default' when PinchTab doesn't
   * echo a tabId so callers can always treat the return value as non-null.
   */
  async navigateCurrentTab(url: string): Promise<string> {
    const res = await this.instancePost('/navigate', { url }) as { tabId?: string }
    return res.tabId ?? 'default'
  }

  async closeTab(tabId: string): Promise<void> {
    await fetch(`${this.cfg.serverUrl}/tabs/${tabId}/close`, {
      method: 'POST',
      headers: this.headers,
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined)
  }

  async snap(): Promise<SnapResult> {
    const res = await this.instanceGet('/snapshot', { filter: 'interactive' })
    return res as SnapResult
  }

  /**
   * Return the active tab's ID by reading the frameId embedded in the snapshot.
   * This is a read-only operation — it does NOT create a new Chrome target.
   */
  async getActiveTabId(): Promise<string | null> {
    try {
      const snap = await this.snap()
      const first = snap.nodes?.[0]
      if (first && 'frameId' in first) return (first as typeof first & { frameId: string }).frameId
      return null
    } catch {
      return null
    }
  }

  /**
   * Navigate the current tab via JS eval (`window.location.href = url`).
   * Uses Runtime.evaluate CDP — does NOT call Target.createTarget, so it
   * never fails with "context deadline exceeded" like /navigate does.
   */
  async navigateViaEval(url: string, tabId?: string): Promise<void> {
    const env: Record<string, string> = { ...process.env as Record<string, string> }
    if (tabId) env['PINCHTAB_TAB'] = tabId
    await new Promise<void>((resolve, reject) => {
      // Wrap in setTimeout so the CDP Runtime.evaluate call completes and
      // returns before the navigation destroys the current execution context.
      // Without this, pinchtab eval hangs waiting for a callback that never arrives.
      const child = spawn('pinchtab', ['eval', `setTimeout(()=>{window.location.href=${JSON.stringify(url)}},0)`], {
        env, stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      // Hard timeout — if pinchtab eval doesn't exit in 10s, kill it and move on.
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
        reject(new Error(`pinchtab eval timed out after 10s (url=${url})`))
      }, 10_000)
      child.stderr?.on('data', (c: Buffer) => { stderr += c.toString() })
      child.on('close', (code: number | null) => {
        clearTimeout(timer)
        if (code !== 0 && code !== null) reject(new Error(`pinchtab eval navigate failed (exit ${code}): ${stderr.trim()}`))
        else resolve()
      })
      child.on('error', (err) => { clearTimeout(timer); reject(err) })
    })
  }

  /**
   * Poll the active tab's URL until it's no longer a blank/new-tab page.
   * Returns the loaded URL on success, or '' on timeout.
   */
  async waitForLoad(timeoutMs = 15_000): Promise<string> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const res = await this.instanceGet('/snapshot', { filter: 'interactive' }) as SnapResult
        const url = res.url ?? ''
        if (url && url !== 'about:blank' && !url.startsWith('chrome://')) return url
      } catch { /* page still loading */ }
      await new Promise(r => setTimeout(r, 800))
    }
    return ''
  }

  /**
   * Wait until the active tab's URL contains `expectedUrlFragment`.
   * Use this after navigateViaEval to avoid returning the old URL immediately.
   */
  async waitForUrl(expectedUrlFragment: string, timeoutMs = 20_000): Promise<string> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const res = await this.instanceGet('/snapshot', { filter: 'interactive' }) as SnapResult
        const url = res.url ?? ''
        if (url && url.includes(expectedUrlFragment)) return url
      } catch { /* page still loading */ }
      await new Promise(r => setTimeout(r, 800))
    }
    return ''
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
