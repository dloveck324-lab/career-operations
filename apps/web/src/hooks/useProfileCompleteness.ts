import { useEffect, useState, useCallback } from 'react'
import { api } from '../api.js'

/**
 * Per-tab completeness check for the Settings UI. Drives the dot badge
 * shown on the topbar gear and on each tab label.
 *
 * Field → tab mapping (mirrors the SettingsPage tab order):
 *   0 CV              — candidate.full_name, candidate.email
 *   1 Profile         — target_roles.primary, compensation.target_range
 *   2 Scan            — prescreen.blocklist_titles
 *   3 Portals         — (already wizard-enforced; not checked)
 *   4 Field Mappings  — (auto-grows; not checked)
 *   5 Automation      — (no required fields)
 *
 * "Required" here means "the wizard or the prescreen needs this filled to
 * scan/evaluate cleanly." Demographics, narrative, and other Settings
 * fields are deliberately NOT checked — they're nice-to-haves.
 */

export const SETTINGS_TAB_LABELS: Record<number, string> = {
  0: 'CV',
  1: 'Profile',
  2: 'Scan',
  3: 'Portals',
  4: 'Field Mappings',
  5: 'Automation',
}

export interface IncompleteField {
  tab: number
  label: string
}

export interface CompletenessResult {
  loading: boolean
  isComplete: boolean
  incomplete: IncompleteField[]
  incompleteByTab: Record<number, string[]>
  firstIncompleteTab: number | null
  refresh: () => void
}

const isPlaceholderName = (v: string) => !v.trim() || /^your\s*name$/i.test(v.trim())
const isPlaceholderEmail = (v: string) => !v.trim() || /^you@example\.com$/i.test(v.trim())

interface ProfileShape {
  candidate?: { full_name?: string; email?: string }
  target_roles?: { primary?: string[] }
  compensation?: { target_range?: string }
  prescreen?: { blocklist_titles?: string[] }
}

export function evaluateCompleteness(profile: ProfileShape | null): IncompleteField[] {
  const missing: IncompleteField[] = []
  const c = profile?.candidate ?? {}
  if (isPlaceholderName(c.full_name ?? '')) {
    missing.push({ tab: 0, label: 'Full name' })
  }
  if (isPlaceholderEmail(c.email ?? '')) {
    missing.push({ tab: 0, label: 'Email' })
  }
  const primary = profile?.target_roles?.primary ?? []
  if (!Array.isArray(primary) || primary.filter(s => s && s.trim()).length === 0) {
    missing.push({ tab: 1, label: 'Target roles' })
  }
  const targetRange = profile?.compensation?.target_range ?? ''
  if (!targetRange.trim()) {
    missing.push({ tab: 1, label: 'Target compensation' })
  }
  const blocklist = profile?.prescreen?.blocklist_titles ?? []
  if (!Array.isArray(blocklist) || blocklist.filter(s => s && s.trim()).length === 0) {
    missing.push({ tab: 2, label: 'Title blocklist' })
  }
  return missing
}

export function useProfileCompleteness(): CompletenessResult {
  const [loading, setLoading] = useState(true)
  const [incomplete, setIncomplete] = useState<IncompleteField[]>([])

  const refresh = useCallback(() => {
    setLoading(true)
    api.settings.profile()
      .then((p: unknown) => {
        setIncomplete(evaluateCompleteness(p as ProfileShape | null))
      })
      .catch(() => setIncomplete([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
    // Re-fetch when any settings save fires the broadcast event from api.ts.
    const handler = () => refresh()
    window.addEventListener('profile-data-changed', handler)
    return () => window.removeEventListener('profile-data-changed', handler)
  }, [refresh])

  const incompleteByTab: Record<number, string[]> = {}
  for (const f of incomplete) {
    if (!incompleteByTab[f.tab]) incompleteByTab[f.tab] = []
    incompleteByTab[f.tab].push(f.label)
  }
  const firstIncompleteTab = incomplete.length > 0
    ? Math.min(...incomplete.map(f => f.tab))
    : null

  return {
    loading,
    isComplete: incomplete.length === 0,
    incomplete,
    incompleteByTab,
    firstIncompleteTab,
    refresh,
  }
}
