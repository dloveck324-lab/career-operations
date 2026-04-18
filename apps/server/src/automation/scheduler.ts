import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { spawn, type ChildProcess } from 'child_process'
import { request as httpRequest } from 'http'

const CONFIG_DIR = resolve(process.cwd(), '../../config')
const CONFIG_PATH = resolve(CONFIG_DIR, 'automation.json')

export interface AutomationConfig {
  autoScan: { enabled: boolean; intervalHours: number }
  autoEvaluate: { enabled: boolean; delayMinutes: number; model: 'haiku' | 'sonnet' }
  keepAwake: { enabled: boolean }
}

const DEFAULT_CONFIG: AutomationConfig = {
  autoScan: { enabled: false, intervalHours: 8 },
  autoEvaluate: { enabled: false, delayMinutes: 10, model: 'haiku' },
  keepAwake: { enabled: false },
}

export function loadAutomationConfig(): AutomationConfig {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG }
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
    return {
      autoScan: { ...DEFAULT_CONFIG.autoScan, ...raw.autoScan },
      autoEvaluate: { ...DEFAULT_CONFIG.autoEvaluate, ...raw.autoEvaluate },
      keepAwake: { ...DEFAULT_CONFIG.keepAwake, ...raw.keepAwake },
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveAutomationConfig(cfg: AutomationConfig) {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
}

class AutoScheduler {
  private config: AutomationConfig = { ...DEFAULT_CONFIG }
  private scanTimer: ReturnType<typeof setInterval> | null = null
  private evalTimer: ReturnType<typeof setTimeout> | null = null
  private caffeinate: ChildProcess | null = null
  private port = 3001
  private lastScanAt: Date | null = null
  private nextScanAt: Date | null = null

  init(port: number, onScanComplete: (cb: () => void) => () => void) {
    this.port = port
    this.config = loadAutomationConfig()

    // Persistent listener: triggers delayed evaluate after any scan
    onScanComplete(() => {
      if (!this.config.autoEvaluate.enabled) return
      const delayMs = this.config.autoEvaluate.delayMinutes * 60 * 1000
      if (this.evalTimer) clearTimeout(this.evalTimer)
      this.evalTimer = setTimeout(() => this.triggerEvaluate(), delayMs)
    })

    this.apply()
  }

  configure(cfg: AutomationConfig) {
    this.config = cfg
    saveAutomationConfig(cfg)
    this.apply()
  }

  getConfig(): AutomationConfig {
    return this.config
  }

  getStatus() {
    return {
      ...this.config,
      lastScanAt: this.lastScanAt?.toISOString() ?? null,
      nextScanAt: this.nextScanAt?.toISOString() ?? null,
      keepAwakeSupported: process.platform === 'darwin',
    }
  }

  private apply() {
    this.applyAutoScan()
    this.applyKeepAwake()
  }

  private applyAutoScan() {
    if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null }
    this.nextScanAt = null
    if (!this.config.autoScan.enabled) return

    const ms = this.config.autoScan.intervalHours * 60 * 60 * 1000
    this.nextScanAt = new Date(Date.now() + ms)
    this.scanTimer = setInterval(() => this.triggerScan(), ms)
  }

  private async triggerScan() {
    this.lastScanAt = new Date()
    const ms = this.config.autoScan.intervalHours * 60 * 60 * 1000
    this.nextScanAt = new Date(Date.now() + ms)
    try {
      await this.post('/api/scan', {})
    } catch (err) {
      console.error('[Scheduler] scan trigger failed:', err)
    }
  }

  private async triggerEvaluate() {
    this.evalTimer = null
    try {
      await this.post('/api/evaluate', { model: this.config.autoEvaluate.model })
    } catch (err) {
      console.error('[Scheduler] evaluate trigger failed:', err)
    }
  }

  private post(path: string, body: object): Promise<void> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body)
      const req = httpRequest(
        { hostname: '127.0.0.1', port: this.port, path, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
        (res) => { res.resume(); res.on('end', resolve) },
      )
      req.on('error', reject)
      req.write(data)
      req.end()
    })
  }

  private applyKeepAwake() {
    if (this.caffeinate) {
      try { this.caffeinate.kill() } catch {}
      this.caffeinate = null
    }
    if (!this.config.keepAwake.enabled || process.platform !== 'darwin') return

    // -w <pid>: caffeinate exits automatically when this process exits
    this.caffeinate = spawn('caffeinate', ['-i', '-w', String(process.pid)], {
      stdio: 'ignore',
      detached: true,
    })
    this.caffeinate.unref()
    this.caffeinate.on('exit', () => { this.caffeinate = null })
  }

  stop() {
    if (this.scanTimer) { clearInterval(this.scanTimer); this.scanTimer = null }
    if (this.evalTimer) { clearTimeout(this.evalTimer); this.evalTimer = null }
    if (this.caffeinate) { try { this.caffeinate.kill() } catch {}; this.caffeinate = null }
  }
}

export const scheduler = new AutoScheduler()
