import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Box, Tabs, Tab, Paper, Chip, Typography, Stack, Badge,
  TextField, InputAdornment, Button, CircularProgress, Avatar,
} from '@mui/material'
import { Search, Close } from '@mui/icons-material'
import {
  DataGrid, type GridColDef, type GridCellParams, type GridRowSelectionModel,
} from '@mui/x-data-grid'
import { api, type Job, type JobStatus, type Stats } from '../api.js'
import { ScoreChip } from '../components/ScoreChip.js'
import { JobDetailDrawer } from '../components/JobDetailDrawer.js'

const TABS: Array<{ label: string; statuses: JobStatus[] }> = [
  { label: 'Inbox',     statuses: ['scanned', 'prescreened'] },
  { label: 'Evaluated', statuses: ['evaluated'] },
  { label: 'Applied',   statuses: ['applied'] },
  { label: 'Interview', statuses: ['interview'] },
  { label: 'Closed',    statuses: ['completed', 'skipped'] },
]

// Bulk actions available per tab index
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
    width: 80,
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

export function PipelinePage() {
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
    api.settings.filters().then((f: any) => {
      setPositiveKeywords(f?.title_filter?.positive ?? [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const handler = () => { loadJobs(); loadStats() }
    window.addEventListener('jobs-updated', handler)
    return () => window.removeEventListener('jobs-updated', handler)
  }, [loadJobs, loadStats])

  useEffect(() => {
    const onStart = (e: Event) => setEvaluatingJobId((e as CustomEvent<{ jobId: number }>).detail.jobId)
    const onDone = () => setEvaluatingJobId(null)
    window.addEventListener('eval-job-start', onStart)
    window.addEventListener('eval-job-done', onDone)
    return () => { window.removeEventListener('eval-job-start', onStart); window.removeEventListener('eval-job-done', onDone) }
  }, [])

  // Clear selection when switching tabs
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
      case 0: // Inbox
        return [
          { label: 'Evaluate',   color: 'warning', fn: ids => api.evaluate({ ids }) },
          { label: 'Skip',       color: 'error',   fn: ids => api.bulkStatus(ids, 'skipped') },
        ]
      case 1: // Evaluated
        return [
          { label: 'Re-evaluate',  color: 'warning', fn: ids => api.evaluate({ ids }) },
          { label: 'Back to Inbox', color: 'primary', fn: ids => api.requeue(ids) },
          { label: 'Applied',      color: 'success', fn: ids => api.bulkStatus(ids, 'applied') },
          { label: 'Skip',         color: 'error',   fn: ids => api.bulkStatus(ids, 'skipped') },
        ]
      case 2: // Applied
        return [
          { label: 'Interview', color: 'warning', fn: ids => api.bulkStatus(ids, 'interview') },
          { label: 'Skip',      color: 'error',   fn: ids => api.bulkStatus(ids, 'skipped') },
        ]
      case 3: // Interview
        return [
          { label: 'Completed', color: 'success', fn: ids => api.bulkStatus(ids, 'completed') },
          { label: 'Skip',      color: 'error',   fn: ids => api.bulkStatus(ids, 'skipped') },
        ]
      default:
        return []
    }
  }, [tab])

  function tabCount(t: typeof TABS[number]): number {
    return t.statuses.reduce((acc, s) => acc + (stats[s] ?? 0), 0)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: 2, gap: 2 }}>
      <Stack direction="row" spacing={3} alignItems="center">
        <Typography variant="h6">Pipeline</Typography>
        {Object.values(stats).some(v => v) && (
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {Object.entries(stats).map(([status, count]) => count > 0 && (
              <Chip
                key={status} label={`${count} ${status}`} size="small" variant="outlined"
                sx={{ fontSize: '0.7rem', borderColor: STATUS_COLORS[status as JobStatus] + '66', color: STATUS_COLORS[status as JobStatus] }}
              />
            ))}
          </Stack>
        )}
      </Stack>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Tabs
          value={tab}
          onChange={(_, v) => { setTab(v); setSearch('') }}
          sx={{ borderBottom: '1px solid', borderColor: 'divider', px: 2, minHeight: 44 }}
        >
          {TABS.map((t, i) => (
            <Tab
              key={t.label}
              value={i}
              label={
                <Stack direction="row" spacing={0.75} alignItems="center">
                  <span>{t.label}</span>
                  {tabCount(t) > 0 && (
                    <Badge
                      badgeContent={tabCount(t)} color="primary"
                      sx={{ '& .MuiBadge-badge': { position: 'static', transform: 'none', fontSize: '0.65rem', height: 16, minWidth: 16 } }}
                    />
                  )}
                </Stack>
              }
            />
          ))}
        </Tabs>

        {/* Toolbar: bulk action bar when rows are selected, search bar otherwise */}
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
            <Button
              size="small"
              variant="text"
              color="inherit"
              startIcon={<Close sx={{ fontSize: 14 }} />}
              onClick={() => setSelectionModel([])}
            >
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

      <JobDetailDrawer
        job={selected}
        onClose={() => setSelected(null)}
        onStatusChange={() => { loadJobs(); loadStats() }}
      />
    </Box>
  )
}
