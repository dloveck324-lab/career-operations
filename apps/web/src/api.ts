const BASE = '/api'

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...(opts?.body ? { 'Content-Type': 'application/json' } : {}), ...opts?.headers },
    ...opts,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API ${path}: ${res.status} — ${text.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

export type JobStatus = 'scanned' | 'prescreened' | 'evaluated' | 'applied' | 'interview' | 'completed' | 'skipped'

export interface Job {
  id: number
  source: string
  external_id: string
  url: string
  company: string
  title: string
  location?: string
  remote_policy?: string
  comp_text?: string
  status: JobStatus
  archetype?: string
  score?: number
  score_reason?: string
  skip_reason?: string
  scraped_at: string
  evaluated_at?: string
  applied_at?: string
  updated_at: string
  content?: { raw_text?: string; cleaned_md?: string } | null
}

export interface TokenUsage { prompt: number; completion: number; total: number }
export interface Health { ok: boolean; config: { profile: boolean; cv: boolean; filters: boolean }; tokens: TokenUsage }
export interface Stats { scanned?: number; prescreened?: number; evaluated?: number; applied?: number; interview?: number; completed?: number; skipped?: number }
export interface ImportResult { profile: boolean; cv: boolean; filters: boolean; fieldMappings: number; warnings: string[] }
export interface AutofillResult { ok: boolean; filled: number; unfilled: number; cached: number; message: string }
export interface DiscoveredPortal { name: string; type: string; company_id: string; url: string; notes: string; source: string }

export interface AutomationConfig {
  autoScan: { enabled: boolean; intervalHours: number }
  autoEvaluate: { enabled: boolean; delayMinutes: number; model: 'haiku' | 'sonnet' }
  keepAwake: { enabled: boolean }
}

export interface AutomationStatus extends AutomationConfig {
  lastScanAt: string | null
  nextScanAt: string | null
  keepAwakeSupported: boolean
}

export const api = {
  health: () => req<Health>('/health'),
  jobs: (status?: JobStatus) => req<Job[]>(`/jobs${status ? `?status=${status}` : ''}`),
  job: (id: number) => req<Job>(`/jobs/${id}`),
  stats: () => req<Stats>('/jobs/stats'),
  updateStatus: (id: number, status: JobStatus, skipReason?: string) =>
    req<{ ok: boolean }>(`/jobs/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, skip_reason: skipReason }) }),
  requeue: (ids?: number[]) =>
    req<{ count: number }>('/jobs/requeue', { method: 'POST', body: JSON.stringify({ ids }) }),
  bulkStatus: (ids: number[], status: JobStatus) =>
    req<{ count: number }>('/jobs/bulk-status', { method: 'POST', body: JSON.stringify({ ids, status }) }),
  scan: () => req<{ runId: number }>('/scan', { method: 'POST' }),
  pauseScan: () => req<{ ok: boolean }>('/scan/pause', { method: 'POST' }),
  evaluate: (opts?: { model?: 'haiku' | 'sonnet'; limit?: number; company?: string; ids?: number[] }) =>
    req<{ queued: number }>('/evaluate', { method: 'POST', body: JSON.stringify(opts ?? {}) }),
  pauseEvaluate: () => req<{ ok: boolean }>('/evaluate/pause', { method: 'POST' }),
  evaluateCompanies: () => req<string[]>('/evaluate/companies'),
  evaluateOne: (id: number, deep = false) => req<unknown>(`/evaluate/${id}`, { method: 'POST', body: JSON.stringify({ deep }) }),
  apply: (id: number, showBrowser = false) => req<AutofillResult>(`/apply/${id}`, { method: 'POST', body: JSON.stringify({ showBrowser }) }),
  importStatus: () => req<{ needsImport: boolean; profile: boolean; cv: boolean; filters: boolean }>('/import/status'),
  runImport: () => req<ImportResult>('/import', { method: 'POST' }),
  settings: {
    status: () => req<{ config: unknown; pinchtab: { ok: boolean; message?: string }; claude: { ok: boolean; path?: string; message?: string } }>('/settings/status'),
    profile: () => req<unknown>('/settings/profile'),
    saveProfile: (data: unknown) => req<{ ok: boolean }>('/settings/profile', { method: 'PUT', body: JSON.stringify(data) }),
    filters: () => req<unknown>('/settings/filters'),
    saveFilters: (data: unknown) => req<{ ok: boolean }>('/settings/filters', { method: 'PUT', body: JSON.stringify(data) }),
    cv: () => req<{ content: string | null }>('/settings/cv'),
    saveCv: (content: string) => req<{ ok: boolean }>('/settings/cv', { method: 'PUT', body: JSON.stringify({ content }) }),
    fieldMappings: () => req<unknown[]>('/settings/field-mappings'),
    deleteMapping: (id: number) => req<{ ok: boolean }>(`/settings/field-mappings/${id}`, { method: 'DELETE' }),
    automation: () => req<AutomationStatus>('/settings/automation'),
    saveAutomation: (data: AutomationConfig) => req<{ ok: boolean }>('/settings/automation', { method: 'PUT', body: JSON.stringify(data) }),
  },
  portals: {
    discover: () => req<{ portals: DiscoveredPortal[] }>('/portals/discover'),
  },
}

export function createSseConnection(path: string, onEvent: (event: unknown) => void): () => void {
  const es = new EventSource(`${BASE}${path}`)
  es.onmessage = (e) => {
    try { onEvent(JSON.parse(e.data as string)) } catch { /* ignore ping */ }
  }
  return () => es.close()
}
