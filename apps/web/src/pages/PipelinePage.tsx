import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Box, Tabs, Tab, Paper, Chip, Typography, Stack, Badge,
  TextField, InputAdornment, Button, CircularProgress, Avatar,
  IconButton, ButtonGroup, Tooltip, Popover, ToggleButtonGroup,
  ToggleButton, Select, MenuItem, FormControl, InputLabel,
  Autocomplete, Divider, Menu,
} from '@mui/material'
import {
  Search, Close, Assessment, Pause, ArrowDropDown,
  LightMode, DarkMode, SettingsBrightness, Settings,
} from '@mui/icons-material'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  DataGrid, type GridColDef, type GridCellParams, type GridRowSelectionModel,
} from '@mui/x-data-grid'
import { api, type Job, type JobStatus, type Stats } from '../api.js'
import { ScoreChip } from '../components/ScoreChip.js'
import { JobDetailDrawer } from '../components/JobDetailDrawer.js'
import { useThemeMode, type ThemeMode } from '../contexts/ThemeContext.js'

// ─── SSE event shape ──────────────────────────────────────────────────────────
interface ScanEvent { type: string; existing?: number; added?: number; reskipped?: number; linkClosed?: number; company?: string; jobId?: number; score?: number; total?: number; done?: number; message?: string }

// ─── Tab config ───────────────────────────────────────────────────────────────
const TABS: Array<{ label: string; statuses: JobStatus[] }> = [
  { label: 'Inbox',     statuses: ['scanned', 'prescreened'] },
  { label: 'Evaluated', statuses: ['evaluated'] },
  { label: 'Applied',   statuses: ['applied'] },
  { label: 'Interview', statuses: ['interview'] },
  { label: 'Closed',    statuses: ['completed', 'skipped'] },
]

type BulkAction = { label: string; color: 'warning' | 'error' | 'success' | 'primary'; fn: (ids: number[]) => Promise<unknown> }

const STATUS_COLORS: Record<JobStatus, string> = {
  scanned: '#6b7280',
  prescreened: '#6366f1',
  evaluated: '#22d3ee',
  applied: '#22c55e',
  interview: '#f59e0b',
  completed: '#10b981',
  skipped: '#4b5563',
}

const themeModeIcons: Record<ThemeMode, typeof LightMode> = {
  light: LightMode,
  dark: DarkMode,
  system: SettingsBrightness,
}

const themeModeLabels: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}

// ─── Greeting ─────────────────────────────────────────────────────────────────
function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good Morning'
  if (h < 18) return 'Good Afternoon'
  if (h < 22) return 'Good Evening'
  return 'Still up'
}

function getWittyMessage(): string {
  const now = new Date()
  const day = now.getDay()   // 0=Sun, 6=Sat
  const hour = now.getHours()

  if (day === 0) return "It's Sunday. LinkedIn doesn't rest and neither do you. That's called a problem."
  if (day === 6) return "It's Saturday — no hiring manager is looking at anything right now. Then again, every day kind of feels like Saturday now."
  if (day === 5 && hour >= 15) return "Friday afternoon. Your applications have been placed in a queue that expires at 5 PM. As tradition dictates."
  if (day === 5) return "It's Friday! The day no one processes applications. Maybe save your cover letter for Monday."
  if (day === 1 && hour < 10) return "Monday morning. The recruiter who ghosted you 3 weeks ago just posted the same role again. Deep breaths."

  if (hour < 6) return "Job hunting at this hour? Even the ATS is asleep. Bold strategy."
  if (hour >= 22) return "Late night job board doomscrolling detected. LinkedIn is pleased. Your future self is not."

  const messages = [
    "Your 'perfect match' has been ghosting you for 3 weeks. Sure, apply to 5 more — can't hurt.",
    "Today's forecast: 40% chance of rejection, 60% chance of being ignored entirely.",
    "Your application is being reviewed by an algorithm that failed its own Turing test.",
    "Position requires 3–5 years experience with a tool invented 18 months ago. The market is well.",
    "The recruiter will reach out soon. (They won't. But the thought is nice.)",
    "Your LinkedIn profile was viewed by someone who will not follow up. As is custom.",
    "Another company posted 'urgent hiring!' for a role they already filled internally. Classic.",
    "Good news: your resume made it past the ATS! Bad news: that's where the good news ends.",
    "Somewhere a hiring manager is reading your cover letter. Just kidding — no one reads those.",
    "Entry level position. Requires senior mindset, principal-level output, and 10 years experience. Pays in 'exposure'.",
    "You are one 'we've decided to move forward with other candidates' away from a personal record.",
    "The job description asked for a 'rockstar ninja' so you're probably fine not applying.",
  ]

  const idx = (now.getDate() + now.getMonth()) % messages.length
  return messages[idx]
}

// ─── Logo + company avatar ─────────────────────────────────────────────────────
function getLogoUrl(url?: string): string | null {
  try {
    const parsed = new URL(url ?? '')
    const host = parsed.hostname
    const pathParts = parsed.pathname.split('/').filter(Boolean)
    let domain: string
    if (host.includes('greenhouse.io') || host.includes('lever.co') || host.includes('ashbyhq.com')) {
      const slug = pathParts[0]
      if (!slug) return null
      domain = `${slug}.com`
    } else {
      domain = host.replace(/^www\./, '')
    }
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
  } catch { return null }
}

function CompanyAvatar({ logoUrl, company }: { logoUrl: string | null; company: string }) {
  const [failed, setFailed] = useState(false)
  const showImg = !!logoUrl && !failed
  return (
    <Avatar
      src={showImg ? logoUrl : undefined}
      alt={company}
      slotProps={{ img: { onError: () => setFailed(true) } }}
      sx={{
        width: 20, height: 20, fontSize: '0.6rem', flexShrink: 0,
        bgcolor: showImg ? 'transparent' : 'primary.dark',
        border: showImg ? '1px solid rgba(255,255,255,0.12)' : 'none',
        boxShadow: showImg ? '0 0 0 1px rgba(0,0,0,0.08)' : 'none',
      }}
    >
      {!showImg && company?.[0]?.toUpperCase()}
    </Avatar>
  )
}

function highlightKeywords(text: string, keywords: string[]): React.ReactNode {
  if (!text || keywords.length === 0) return text
  const escaped = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi')
  const parts = text.split(regex)
  return parts.map((part, i) =>
    regex.test(part) ? <strong key={i}>{part}</strong> : part
  )
}

function buildColumns(evaluatingJobId: number | null, positiveKeywords: string[]): GridColDef[] { return [
  {
    field: 'company', headerName: 'Company', flex: 1, minWidth: 160,
    renderCell: ({ value, row }) => (
      <Stack direction="row" alignItems="center" gap={1} sx={{ height: '100%' }}>
        {evaluatingJobId === row.id
          ? <CircularProgress size={18} thickness={5} sx={{ flexShrink: 0 }} />
          : <CompanyAvatar logoUrl={getLogoUrl(row.url)} company={value as string} />}
        <Typography variant="body2" noWrap>{value as string}</Typography>
      </Stack>
    ),
  },
  {
    field: 'title', headerName: 'Role', flex: 2, minWidth: 200,
    renderCell: ({ value }) => (
      <Typography variant="body2" noWrap component="span">
        {highlightKeywords(value as string, positiveKeywords)}
      </Typography>
    ),
  },
  {
    field: 'score',
    headerName: 'Score',
    width: 100,
    renderCell: ({ value }) => <ScoreChip score={value as number | null} />,
    sortComparator: (a, b) => (b ?? -1) - (a ?? -1),
  },
  {
    field: 'archetype', headerName: 'Archetype', width: 130,
    renderCell: ({ value }) => value
      ? <Chip label={value} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
      : null,
  },
  { field: 'location', headerName: 'Location', width: 160 },
  {
    field: 'status',
    headerName: 'Status',
    width: 110,
    renderCell: ({ value }) => (
      <Chip
        label={value}
        size="small"
        sx={{
          bgcolor: STATUS_COLORS[value as JobStatus] + '22',
          color: STATUS_COLORS[value as JobStatus],
          fontWeight: 600, fontSize: '0.7rem',
        }}
      />
    ),
  },
  {
    field: 'scraped_at',
    headerName: 'Found',
    width: 110,
    renderCell: ({ value }) => (
      <Typography variant="caption" color="text.secondary">
        {new Date(value as string).toLocaleDateString()}
      </Typography>
    ),
  },
]}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function PipelinePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { mode: themeMode, setMode: setThemeMode } = useThemeMode()

  // Header state
  const [firstName, setFirstName] = useState('David')
  const [themeMenuAnchor, setThemeMenuAnchor] = useState<HTMLElement | null>(null)
  const greeting = useMemo(() => getGreeting(), [])
  const wittyMessage = useMemo(() => getWittyMessage(), [])

  // Scan / evaluate state
  const [scanning, setScanning] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null)
  const [evalModel, setEvalModel] = useState<'haiku' | 'sonnet'>('haiku')
  const [evalLimit, setEvalLimit] = useState<number>(0)
  const [evalCompany, setEvalCompany] = useState<string | null>(null)
  const [companies, setCompanies] = useState<string[]>([])

  // Table state
  const [tab, setTab] = useState(0)
  const [jobs, setJobs] = useState<Job[]>([])
  const [stats, setStats] = useState<Stats>({})
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Job | null>(null)
  const [search, setSearch] = useState('')
  const [selectionModel, setSelectionModel] = useState<GridRowSelectionModel>([])
  const [bulkLoading, setBulkLoading] = useState<string | null>(null)
  const [evaluatingJobId, setEvaluatingJobId] = useState<number | null>(null)
  const [positiveKeywords, setPositiveKeywords] = useState<string[]>([])

  const selectedIds = selectionModel as number[]

  // Load first name from profile (candidate.full_name)
  useEffect(() => {
    api.settings.profile().then((p: unknown) => {
      const profile = p as Record<string, unknown>
      const candidate = profile?.candidate as Record<string, unknown> | undefined
      const raw = ((candidate?.full_name ?? candidate?.name ?? profile?.name ?? '') as string).trim()
      const first = raw.split(/\s+/)[0]
      if (first) setFirstName(first)
    }).catch(() => {})
  }, [])

  // SSE events (AppShell forwards them as window events)
  useEffect(() => {
    const handler = (e: Event) => {
      const evt = (e as CustomEvent<ScanEvent>).detail
      if (evt.type === 'start') { setScanning(true); setProgress('Scanning portals...') }
      if (evt.type === 'progress') {
        const closed = (evt.reskipped ?? 0) + (evt.linkClosed ?? 0)
        setProgress(`re-scan: ${evt.existing ?? 0} · new: ${evt.added ?? 0} · closed: ${closed}${evt.company ? ` · ${evt.company}` : ''}`)
      }
      if (evt.type === 'done') {
        setScanning(false)
        const closed = (evt.reskipped ?? 0) + (evt.linkClosed ?? 0)
        setProgress(`Done — re-scan: ${evt.existing ?? 0} · new: ${evt.added ?? 0} · closed: ${closed}`)
      }
      if (evt.type === 'scan_paused') {
        setScanning(false)
        const closed = (evt.reskipped ?? 0) + (evt.linkClosed ?? 0)
        setProgress(`Paused — re-scan: ${evt.existing ?? 0} · new: ${evt.added ?? 0} · closed: ${closed}`)
      }
      if (evt.type === 'eval_start') { setEvaluating(true); setProgress(`Evaluating ${evt.done ?? 0}/${evt.total ?? 0}: ${evt.company}`) }
      if (evt.type === 'eval_done') { setProgress(`Evaluated ${evt.done !== undefined ? evt.done + 1 : '?'}/${evt.total ?? '?'} · score ${evt.score}`) }
      if (evt.type === 'eval_all_done') { setEvaluating(false); setProgress('Evaluation complete') }
      if (evt.type === 'eval_paused') { setEvaluating(false); setProgress(`Paused — evaluated ${evt.done ?? 0} jobs`) }
      if (evt.type === 'error') setProgress(`Error: ${evt.message}`)
    }
    window.addEventListener('sse-scan', handler)
    return () => window.removeEventListener('sse-scan', handler)
  }, [])

  // Scan handlers
  const handleScan = async () => {
    setScanning(true)
    setProgress('Starting scan...')
    try { await api.scan() } catch (err) { setScanning(false); setProgress(`Scan failed: ${err}`) }
  }

  const handlePauseScan = async () => {
    try { await api.pauseScan(); setProgress('Pausing after current phase...') } catch { /* ignore */ }
  }

  // Evaluate handlers
  const runEvaluate = async (opts?: { model?: 'haiku' | 'sonnet'; limit?: number; company?: string }) => {
    setEvaluating(true)
    setProgress('Starting evaluation...')
    try {
      const result = await api.evaluate(opts)
      if (result.queued === 0) { setEvaluating(false); setProgress('No jobs to evaluate — run Scan first or check Inbox') }
    } catch (err) { setEvaluating(false); setProgress(`Evaluate failed: ${err}`) }
  }

  const handleEvaluate = () => runEvaluate({ model: evalModel, limit: evalLimit || undefined, company: evalCompany ?? undefined })

  const handleEvaluateFromPopover = () => {
    setPopoverAnchor(null)
    runEvaluate({ model: evalModel, limit: evalLimit || undefined, company: evalCompany ?? undefined })
  }

  const handlePauseEvaluate = async () => {
    try { await api.pauseEvaluate(); setProgress('Pausing after current job...') } catch { /* ignore */ }
  }

  const openPopover = async (e: React.MouseEvent<HTMLElement>) => {
    setPopoverAnchor(e.currentTarget)
    try { const list = await api.evaluateCompanies(); setCompanies(list) } catch { /* ignore */ }
  }

  // Table data
  const loadJobs = useCallback(async () => {
    setLoading(true)
    try {
      const results = await Promise.all(TABS[tab].statuses.map(s => api.jobs(s)))
      setJobs(results.flat().sort((a, b) => (b.score ?? -1) - (a.score ?? -1)))
    } catch { /* silently fail */ }
    setLoading(false)
  }, [tab])

  const loadStats = useCallback(async () => {
    try { setStats(await api.stats()) } catch { /* */ }
  }, [])

  useEffect(() => { loadJobs(); loadStats() }, [loadJobs, loadStats])

  useEffect(() => {
    api.settings.filters().then((f: unknown) => {
      const filters = f as Record<string, unknown>
      const tf = filters?.title_filter as Record<string, unknown> | undefined
      setPositiveKeywords((tf?.positive as string[]) ?? [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const handler = () => { loadJobs(); loadStats() }
    window.addEventListener('jobs-updated', handler)
    return () => window.removeEventListener('jobs-updated', handler)
  }, [loadJobs, loadStats])

  useEffect(() => {
    const onStart = (e: Event) => setEvaluatingJobId((e as CustomEvent<{ jobId: number }>).detail.jobId)
    const onDone = (e: Event) => {
      const { jobId } = ((e as CustomEvent<{ jobId?: number }>).detail ?? {})
      setEvaluatingJobId(null)
      if (jobId != null) setJobs(prev => prev.filter(j => j.id !== jobId))
    }
    window.addEventListener('eval-job-start', onStart)
    window.addEventListener('eval-job-done', onDone)
    return () => { window.removeEventListener('eval-job-start', onStart); window.removeEventListener('eval-job-done', onDone) }
  }, [])

  useEffect(() => { setSelectionModel([]) }, [tab])

  const columns = useMemo(() => buildColumns(evaluatingJobId, positiveKeywords), [evaluatingJobId, positiveKeywords])

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return jobs
    return jobs.filter(j =>
      j.company?.toLowerCase().includes(q) ||
      j.title?.toLowerCase().includes(q) ||
      j.location?.toLowerCase().includes(q) ||
      j.archetype?.toLowerCase().includes(q)
    )
  }, [jobs, search])

  const handleCellClick = async (params: GridCellParams) => {
    if (params.field === '__check__') return
    const job = jobs.find(j => j.id === params.id)
    if (!job) return
    const full = await api.job(job.id)
    setSelected(full)
  }

  const runBulkAction = async (action: BulkAction) => {
    if (selectedIds.length === 0) return
    setBulkLoading(action.label)
    try {
      await action.fn(selectedIds)
      setSelectionModel([])
      await Promise.all([loadJobs(), loadStats()])
    } finally {
      setBulkLoading(null)
    }
  }

  const bulkActions: BulkAction[] = useMemo(() => {
    switch (tab) {
      case 0: return [
        { label: 'Evaluate',    color: 'warning', fn: ids => api.evaluate({ ids }) },
        { label: 'Skip',        color: 'error',   fn: ids => api.bulkStatus(ids, 'skipped') },
      ]
      case 1: return [
        { label: 'Re-evaluate',  color: 'warning', fn: ids => api.evaluate({ ids }) },
        { label: 'Back to Inbox', color: 'primary', fn: ids => api.requeue(ids) },
        { label: 'Applied',      color: 'success', fn: ids => api.bulkStatus(ids, 'applied') },
        { label: 'Skip',         color: 'error',   fn: ids => api.bulkStatus(ids, 'skipped') },
      ]
      case 2: return [
        { label: 'Interview', color: 'warning', fn: ids => api.bulkStatus(ids, 'interview') },
        { label: 'Skip',      color: 'error',   fn: ids => api.bulkStatus(ids, 'skipped') },
      ]
      case 3: return [
        { label: 'Completed', color: 'success', fn: ids => api.bulkStatus(ids, 'completed') },
        { label: 'Skip',      color: 'error',   fn: ids => api.bulkStatus(ids, 'skipped') },
      ]
      default: return []
    }
  }, [tab])

  function tabCount(t: typeof TABS[number]): number {
    return t.statuses.reduce((acc, s) => acc + (stats[s] ?? 0), 0)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <Box sx={{ px: 3, pt: 3, pb: 0 }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
          {/* Greeting */}
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h4" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {greeting}, {firstName}!
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.75 }}>
              {wittyMessage}
            </Typography>
          </Box>

          {/* Action buttons */}
          <Stack direction="row" alignItems="center" spacing={1} sx={{ flexShrink: 0, mt: 0.5 }}>
            {/* SCAN */}
            <ButtonGroup size="small" disabled={evaluating} variant="contained">
              <Button
                startIcon={scanning ? <CircularProgress size={14} color="inherit" /> : <Search />}
                onClick={handleScan}
                disabled={scanning || evaluating}
                sx={{ minWidth: 110 }}
              >
                {scanning ? 'Scanning' : 'Scan'}
              </Button>
              <Tooltip title="Pause after current phase">
                <Button
                  onClick={handlePauseScan}
                  color="warning"
                  sx={{ px: 1, visibility: scanning ? 'visible' : 'hidden', width: 32 }}
                >
                  <Pause fontSize="small" />
                </Button>
              </Tooltip>
            </ButtonGroup>

            {/* EVALUATE */}
            <ButtonGroup size="small" disabled={scanning} variant="outlined">
              <Button
                startIcon={evaluating ? <CircularProgress size={14} color="inherit" /> : <Assessment />}
                onClick={handleEvaluate}
                disabled={scanning || evaluating}
                sx={{ minWidth: 100 }}
              >
                {evaluating ? 'Evaluating' : 'Evaluate'}
              </Button>
              {evaluating ? (
                <Tooltip title="Pause after current job">
                  <Button onClick={handlePauseEvaluate} color="warning" sx={{ px: 1 }}>
                    <Pause fontSize="small" />
                  </Button>
                </Tooltip>
              ) : (
                <Tooltip title="Evaluation options">
                  <Button onClick={openPopover} sx={{ px: 0.5 }}>
                    <ArrowDropDown fontSize="small" />
                  </Button>
                </Tooltip>
              )}
            </ButtonGroup>

            <Popover
              open={Boolean(popoverAnchor)}
              anchorEl={popoverAnchor}
              onClose={() => setPopoverAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            >
              <Box sx={{ p: 2.5, width: 300, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>Evaluation options</Typography>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', mb: 0.5, display: 'block' }}>Model</Typography>
                  <ToggleButtonGroup value={evalModel} exclusive onChange={(_, v) => { if (v) setEvalModel(v) }} size="small" fullWidth>
                    <ToggleButton value="haiku" sx={{ flex: 1 }}>Quick (Haiku)</ToggleButton>
                    <ToggleButton value="sonnet" sx={{ flex: 1 }}>Deep (Sonnet)</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <FormControl size="small" fullWidth>
                  <InputLabel>Jobs to evaluate</InputLabel>
                  <Select value={evalLimit} label="Jobs to evaluate" onChange={(e) => setEvalLimit(Number(e.target.value))}>
                    <MenuItem value={0}>All pending</MenuItem>
                    <MenuItem value={5}>5 jobs</MenuItem>
                    <MenuItem value={10}>10 jobs</MenuItem>
                    <MenuItem value={25}>25 jobs</MenuItem>
                    <MenuItem value={50}>50 jobs</MenuItem>
                  </Select>
                </FormControl>
                <Autocomplete
                  size="small"
                  options={companies}
                  value={evalCompany}
                  onChange={(_, v) => setEvalCompany(v)}
                  renderInput={(params) => <TextField {...params} label="Company (optional)" />}
                  noOptionsText="No prescreened companies"
                />
                <Button variant="contained" size="small" onClick={handleEvaluateFromPopover}>
                  Start evaluation
                </Button>
              </Box>
            </Popover>

            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

            {/* Theme */}
            <Tooltip title={`Theme: ${themeModeLabels[themeMode]}`}>
              <IconButton size="small" onClick={(e) => setThemeMenuAnchor(e.currentTarget)} sx={{ color: 'text.secondary' }}>
                {(() => { const Icon = themeModeIcons[themeMode]; return <Icon fontSize="small" /> })()}
              </IconButton>
            </Tooltip>
            <Menu
              anchorEl={themeMenuAnchor}
              open={Boolean(themeMenuAnchor)}
              onClose={() => setThemeMenuAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => {
                const Icon = themeModeIcons[m]
                return (
                  <MenuItem key={m} selected={themeMode === m} onClick={() => { setThemeMode(m); setThemeMenuAnchor(null) }} sx={{ gap: 1.5, minWidth: 130 }}>
                    <Icon fontSize="small" sx={{ color: 'text.secondary' }} />
                    {themeModeLabels[m]}
                  </MenuItem>
                )
              })}
            </Menu>

            {/* Settings */}
            <Tooltip title="Settings">
              <IconButton
                size="small"
                onClick={() => navigate(location.pathname === '/settings' ? '/pipeline' : '/settings')}
                sx={{ color: location.pathname === '/settings' ? 'primary.main' : 'text.secondary' }}
              >
                <Settings fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        {/* Progress text */}
        {progress && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1.5 }}>
            {progress}
          </Typography>
        )}

        <Divider sx={{ mt: 2 }} />
      </Box>

      {/* ── Pipeline table ──────────────────────────────────────────────── */}
      <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', p: 2, pt: 1.5, gap: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 600, px: 0.5 }}>Pipeline</Typography>

        <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Tabs
            value={tab}
            onChange={(_, v) => { setTab(v); setSearch('') }}
            sx={{ borderBottom: '1px solid', borderColor: 'divider', px: 2, minHeight: 44 }}
          >
            {TABS.map((t, i) => {
              const count = tabCount(t)
              return (
                <Tab
                  key={t.label}
                  value={i}
                  label={
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <span>{t.label}</span>
                      {count > 0 && (
                        <Badge
                          badgeContent={count}
                          max={999999}
                          color="primary"
                          sx={{ '& .MuiBadge-badge': { position: 'static', transform: 'none', fontSize: '0.65rem', height: 16, minWidth: 16 } }}
                        />
                      )}
                    </Stack>
                  }
                />
              )
            })}
          </Tabs>

          {selectedIds.length > 0 ? (
            <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', gap: 1, alignItems: 'center', bgcolor: 'action.selected' }}>
              <Typography variant="caption" sx={{ fontWeight: 700, mr: 1 }}>
                {selectedIds.length} selected
              </Typography>
              {bulkActions.map(action => (
                <Button
                  key={action.label}
                  size="small"
                  variant="outlined"
                  color={action.color}
                  disabled={!!bulkLoading}
                  onClick={() => runBulkAction(action)}
                  startIcon={bulkLoading === action.label ? <CircularProgress size={12} color="inherit" /> : undefined}
                >
                  {action.label}
                </Button>
              ))}
              <Box sx={{ flex: 1 }} />
              <Button size="small" variant="text" color="inherit" startIcon={<Close sx={{ fontSize: 14 }} />} onClick={() => setSelectionModel([])}>
                Clear
              </Button>
            </Box>
          ) : (
            <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField
                size="small"
                placeholder="Filter by company, role, location…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                fullWidth
                InputProps={{
                  startAdornment: <InputAdornment position="start"><Search sx={{ fontSize: 16, color: 'text.disabled' }} /></InputAdornment>,
                }}
                sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.85rem' } }}
              />
            </Box>
          )}

          <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <DataGrid
              rows={filteredJobs}
              columns={columns}
              loading={loading}
              checkboxSelection
              rowSelectionModel={selectionModel}
              onRowSelectionModelChange={setSelectionModel}
              onCellClick={handleCellClick}
              initialState={{ sorting: { sortModel: [{ field: 'score', sort: 'desc' }] } }}
              sx={{
                border: 'none',
                '& .MuiDataGrid-row': { cursor: 'pointer' },
                '& .MuiDataGrid-row:hover': { bgcolor: 'action.hover' },
                '& .MuiDataGrid-columnHeaders': { bgcolor: 'background.default' },
                '& .MuiDataGrid-cell': { borderColor: 'divider' },
              }}
              pageSizeOptions={[25, 50, 100]}
              density="compact"
            />
          </Box>
        </Paper>
      </Box>

      <JobDetailDrawer
        job={selected}
        onClose={() => setSelected(null)}
        onStatusChange={() => { loadJobs(); loadStats() }}
      />
    </Box>
  )
}
