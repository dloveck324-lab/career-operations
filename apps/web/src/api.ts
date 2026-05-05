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

/**
 * Broadcast that profile/filters/cv changed. The useProfileCompleteness
 * hook listens for this and refetches so the topbar gear badge updates
 * without a page reload after the user saves a Settings form.
 */
function broadcastProfileChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('profile-data-changed'))
  }
}

export type JobStatus = 'scanned' | 'prescreened' | 'evaluated' | 'ready_to_submit' | 'applied' | 'interview' | 'completed' | 'skipped'

export type IndustryVertical = 'healthcare' | 'generic' | 'ambiguous' | 'unclassified'
export type ProfileVariant = 'healthcare' | 'generic'
export type EvalErrorKind = 'credits' | 'rate_limit' | 'parse' | 'auth' | 'other'

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
  industry_vertical?: IndustryVertical
  directional_score?: number
  eval_attempts?: number
  eval_last_error?: string
  eval_last_attempted_at?: string
  eval_last_error_kind?: EvalErrorKind
}

export interface TokenUsage { prompt: number; completion: number; total: number }
export interface Health { ok: boolean; config: { profile: boolean; cv: boolean; filters: boolean }; tokens: TokenUsage }
export interface Stats { scanned?: number; prescreened?: number; evaluated?: number; ready_to_submit?: number; applied?: number; interview?: number; completed?: number; skipped?: number }
export interface ImportResult { profile: boolean; cv: boolean; filters: boolean; fieldMappings: number; warnings: string[] }
export type AutofillModel = 'haiku' | 'sonnet' | 'opus'
export interface AutofillResult { ok: boolean; message: string; model: AutofillModel; durationMs: number; status: 'ready_to_submit' | 'failed' }
export interface AutofillStartResult { runId: string; jobId: number }
export interface AutofillBulkResult { runs: Array<{ jobId: number; runId: string }>; model: AutofillModel; concurrency: number }
export type RunStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
export interface RunSummary { id: string; jobId: number; model: AutofillModel; status: RunStatus; startedAt: number; endedAt?: number; sessionId?: string; tabId?: string }
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

export interface ClaudeUsage {
  sessions: number
  messages: number
  sonnetTokens: number
  opusTokens: number
  haikuTokens: number
  totalTokens: number
  renewalDate: string
  sessionUtilization: number | null
  weeklyUtilization: number | null
  weeklyResetsAt: string | null
  sonnetUtilization: number | null
  opusUtilization: number | null
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
    req<{ queued: number; reason?: 'busy' }>('/evaluate', { method: 'POST', body: JSON.stringify(opts ?? {}) }),
  pauseEvaluate: () => req<{ ok: boolean }>('/evaluate/pause', { method: 'POST' }),
  evaluateCompanies: () => req<string[]>('/evaluate/companies'),
  evaluateOne: (id: number, deep = false) => req<unknown>(`/evaluate/${id}`, { method: 'POST', body: JSON.stringify({ deep }) }),
  apply: (id: number, model: AutofillModel = 'haiku', variant?: ProfileVariant) =>
    req<AutofillStartResult>(`/apply/${id}`, { method: 'POST', body: JSON.stringify({ model, variant }) }),
  applyBulk: (ids: number[], model: AutofillModel = 'haiku', concurrency = 3) =>
    req<AutofillBulkResult>('/apply/bulk', { method: 'POST', body: JSON.stringify({ ids, model, concurrency }) }),
  applyRun: (jobId: number) => req<{ run: RunSummary | null }>(`/apply/jobs/${jobId}/run`),
  applySendMessage: (runId: string, text: string) =>
    req<{ ok: boolean }>(`/apply/runs/${runId}/message`, { method: 'POST', body: JSON.stringify({ text }) }),
  applyCancelRun: (runId: string) =>
    req<{ ok: boolean }>(`/apply/runs/${runId}/cancel`, { method: 'POST' }),
  applySaveMappings: (runId: string, items: Array<{ question: string; answer: string }>) =>
    req<{ saved: number; skipped: number }>(`/apply/runs/${runId}/save-mappings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    }),
  importStatus: () => req<{ needsImport: boolean; profile: boolean; cv: boolean; filters: boolean }>('/import/status'),
  onboardingStatus: () => req<{ needsOnboarding: boolean; profileFilled: boolean; cvFilled: boolean; filtersFilled: boolean }>('/onboarding/status'),
  onboardingEvent: (step: string, action: 'enter' | 'next' | 'back' | 'skip' | 'finish') =>
    req<{ ok: true }>('/onboarding/event', { method: 'POST', body: JSON.stringify({ step, action }) }),
  runImport: () => req<ImportResult>('/import', { method: 'POST' }),
  settings: {
    status: () => req<{ config: unknown; pinchtab: { ok: boolean; message?: string }; claude: { ok: boolean; path?: string; message?: string } }>('/settings/status'),
    profile: () => req<unknown>('/settings/profile'),
    saveProfile: async (data: unknown) => {
      const r = await req<{ ok: boolean }>('/settings/profile', { method: 'PUT', body: JSON.stringify(data) })
      broadcastProfileChange()
      return r
    },
    filters: () => req<unknown>('/settings/filters'),
    saveFilters: async (data: unknown) => {
      const r = await req<{ ok: boolean }>('/settings/filters', { method: 'PUT', body: JSON.stringify(data) })
      broadcastProfileChange()
      return r
    },
    importPortals: (text: string, format: 'yaml' | 'json' = 'yaml') =>
      req<{
        added: number
        skipped: number
        invalid: number
        detail: {
          added: string[]
          skipped: Array<{ name: string; reason: string }>
          invalid: Array<{ entry: unknown; reason: string }>
        }
      }>('/settings/portals/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, format }),
      }),
    cv: () => req<{ content: string | null }>('/settings/cv'),
    saveCv: async (content: string) => {
      const r = await req<{ ok: boolean }>('/settings/cv', { method: 'PUT', body: JSON.stringify({ content }) })
      broadcastProfileChange()
      return r
    },
    uploadResume: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return fetch(`${BASE}/settings/cv/upload`, { method: 'POST', body: form })
        .then(async res => {
          const json = await res.json()
          if (!res.ok) throw new Error((json as { error?: string }).error ?? `Upload failed: ${res.status}`)
          return json as { ok: boolean; cv: unknown }
        })
    },
    fieldMappings: () => req<unknown[]>('/settings/field-mappings'),
    updateMapping: (id: number, answer: string) => req<{ ok: boolean }>(`/settings/field-mappings/${id}`, { method: 'PATCH', body: JSON.stringify({ answer }), headers: { 'Content-Type': 'application/json' } }),
    deleteMapping: (id: number) => req<{ ok: boolean }>(`/settings/field-mappings/${id}`, { method: 'DELETE' }),
    seedMappings: () => req<{ ok: boolean; seeded: number }>('/settings/field-mappings/seed', { method: 'POST' }),
    automation: () => req<AutomationStatus>('/settings/automation'),
    saveAutomation: (data: AutomationConfig) => req<{ ok: boolean }>('/settings/automation', { method: 'PUT', body: JSON.stringify(data) }),
    claudeUsage: () => req<ClaudeUsage>('/settings/claude-usage'),
    slashCommands: () => req<Array<{ name: string; description: string; source: string }>>('/settings/slash-commands'),
  },
  portals: {
    discover: () => req<{ portals: DiscoveredPortal[] }>('/portals/discover'),
  },
  auth: {
    me: () => req<{ email: string }>('/auth/me'),
    logout: () => req<{ ok: true }>('/auth/logout', { method: 'POST' }),
  },
}

export type AssistantModel = 'haiku' | 'sonnet' | 'opus'
export interface AssistantSessionInfo { sessionId: string; model: AssistantModel }

export const assistantApi = {
  createSession: (model?: AssistantModel) =>
    req<AssistantSessionInfo>('/assistant/session', { method: 'POST', body: JSON.stringify({ model }) }),
  sendMessage: (sessionId: string, text: string) =>
    req<{ ok: true }>('/assistant/message', { method: 'POST', body: JSON.stringify({ sessionId, text }) }),
  changeModel: (sessionId: string, model: AssistantModel) =>
    req<{ ok: true }>(`/assistant/session/${sessionId}/model`, { method: 'POST', body: JSON.stringify({ model }) }),
  endSession: (sessionId: string) =>
    req<{ ok: true }>(`/assistant/session/${sessionId}`, { method: 'DELETE' }),
}

export const auth = {
  me: () => req<{ email: string }>('/auth/me'),
  logout: () => req<{ ok: true }>('/auth/logout', { method: 'POST' }),
}

export function createSseConnection(path: string, onEvent: (event: unknown) => void): () => void {
  const es = new EventSource(`${BASE}${path}`)
  es.onmessage = (e) => {
    try { onEvent(JSON.parse(e.data as string)) } catch { /* ignore ping */ }
  }
  return () => es.close()
}
