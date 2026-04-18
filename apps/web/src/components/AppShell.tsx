import { useState, useEffect, type ReactNode } from 'react'
import {
  Box, AppBar, Toolbar, Typography, Button, Chip, Tooltip,
  CircularProgress, Stack, IconButton, Divider, ButtonGroup,
  Popover, ToggleButtonGroup, ToggleButton, Select, MenuItem,
  FormControl, InputLabel, Autocomplete, TextField, Menu,
} from '@mui/material'
import {
  WorkOutline, Settings, Search, Assessment,
  CheckCircleOutline, ErrorOutline, ArrowDropDown, Pause,
  LightMode, DarkMode, SettingsBrightness,
} from '@mui/icons-material'
import { useNavigate, useLocation } from 'react-router-dom'
import { api, createSseConnection, type Job } from '../api.js'
import { useThemeMode, type ThemeMode } from '../contexts/ThemeContext.js'

interface AppShellProps { children: ReactNode }

interface ScanEvent { type: string; found?: number; added?: number; skipped?: number; existing?: number; reskipped?: number; linkClosed?: number; company?: string; title?: string; jobId?: number; score?: number; total?: number; done?: number; message?: string }

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

export function AppShell({ children }: AppShellProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { mode: themeMode, setMode: setThemeMode } = useThemeMode()
  const [themeMenuAnchor, setThemeMenuAnchor] = useState<HTMLElement | null>(null)
  const [scanning, setScanning] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [health, setHealth] = useState<{ pinchtab: boolean; claude: boolean } | null>(null)
  const [tokens, setTokens] = useState(0)

  // Evaluate options
  const [popoverAnchor, setPopoverAnchor] = useState<HTMLElement | null>(null)
  const [evalModel, setEvalModel] = useState<'haiku' | 'sonnet'>('haiku')
  const [evalLimit, setEvalLimit] = useState<number>(0)
  const [evalCompany, setEvalCompany] = useState<string | null>(null)
  const [companies, setCompanies] = useState<string[]>([])

  useEffect(() => {
    const load = async () => {
      try {
        const [h, status] = await Promise.all([api.health(), api.settings.status()])
        setTokens(h.tokens.total)
        setHealth({ pinchtab: status.pinchtab.ok, claude: status.claude.ok })
      } catch { /* server might not be ready */ }
    }
    load()
  }, [])

  useEffect(() => {
    const disconnect = createSseConnection('/scan/events', (evt) => {
      const e = evt as ScanEvent
      if (e.type === 'start') { setScanning(true); setProgress('Scanning portals...') }
      if (e.type === 'progress') {
        const closed = (e.reskipped ?? 0) + (e.linkClosed ?? 0)
        setProgress(`re-scan: ${e.existing ?? 0} · new: ${e.added ?? 0} · closed: ${closed}${e.company ? ` · ${e.company}` : ''}`)
      }
      if (e.type === 'done') {
        setScanning(false)
        const closed = (e.reskipped ?? 0) + (e.linkClosed ?? 0)
        setProgress(`Done — re-scan: ${e.existing ?? 0} · new: ${e.added ?? 0} · closed: ${closed}`)
        window.dispatchEvent(new CustomEvent('jobs-updated'))
      }
      if (e.type === 'scan_paused') {
        setScanning(false)
        const closed = (e.reskipped ?? 0) + (e.linkClosed ?? 0)
        setProgress(`Paused — re-scan: ${e.existing ?? 0} · new: ${e.added ?? 0} · closed: ${closed}`)
        window.dispatchEvent(new CustomEvent('jobs-updated'))
      }
      if (e.type === 'eval_start') { setEvaluating(true); setProgress(`Evaluating ${e.done ?? 0}/${e.total ?? 0}: ${e.company}`); window.dispatchEvent(new CustomEvent('eval-job-start', { detail: { jobId: e.jobId } })) }
      if (e.type === 'eval_done') { setProgress(`Evaluated ${e.done !== undefined ? e.done + 1 : '?'}/${(evt as ScanEvent).total ?? '?'} · score ${e.score}`); window.dispatchEvent(new CustomEvent('eval-job-done')) }
      if (e.type === 'eval_all_done') { setEvaluating(false); setProgress('Evaluation complete'); window.dispatchEvent(new CustomEvent('eval-job-done')); window.dispatchEvent(new CustomEvent('jobs-updated')) }
      if (e.type === 'eval_paused') { setEvaluating(false); setProgress(`Paused — evaluated ${e.done ?? 0} jobs`); window.dispatchEvent(new CustomEvent('eval-job-done')); window.dispatchEvent(new CustomEvent('jobs-updated')) }
      if (e.type === 'error') setProgress(`Error: ${e.message}`)
    })
    return disconnect
  }, [])

  const handleScan = async () => {
    setScanning(true)
    setProgress('Starting scan...')
    try {
      await api.scan()
    } catch (err) {
      setScanning(false)
      setProgress(`Scan failed: ${err}`)
    }
  }

  const handlePauseScan = async () => {
    try {
      await api.pauseScan()
      setProgress('Pausing after current phase...')
    } catch { /* ignore */ }
  }

  const runEvaluate = async (opts?: { model?: 'haiku' | 'sonnet'; limit?: number; company?: string }) => {
    setEvaluating(true)
    setProgress('Starting evaluation...')
    try {
      const result = await api.evaluate(opts)
      if (result.queued === 0) {
        setEvaluating(false)
        setProgress('No jobs to evaluate — run Scan first or check Inbox')
      }
    } catch (err) {
      setEvaluating(false)
      setProgress(`Evaluate failed: ${err}`)
    }
  }

  const handleEvaluate = () => {
    runEvaluate({ model: evalModel, limit: evalLimit || undefined, company: evalCompany ?? undefined })
  }

  const handleEvaluateFromPopover = () => {
    setPopoverAnchor(null)
    runEvaluate({ model: evalModel, limit: evalLimit || undefined, company: evalCompany ?? undefined })
  }

  const handlePause = async () => {
    try {
      await api.pauseEvaluate()
      setProgress('Pausing after current job...')
    } catch { /* ignore */ }
  }

  const openPopover = async (e: React.MouseEvent<HTMLElement>) => {
    setPopoverAnchor(e.currentTarget)
    try {
      const list = await api.evaluateCompanies()
      setCompanies(list)
    } catch { /* ignore */ }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 2, minHeight: 56 }}>
          <WorkOutline sx={{ color: 'primary.main' }} />
          <Typography variant="h6" sx={{ color: 'text.primary', mr: 2 }}>
            Job Pipeline
          </Typography>

          <ButtonGroup size="small" disabled={evaluating} variant="contained">
            <Button
              startIcon={scanning ? <CircularProgress size={14} color="inherit" /> : <Search />}
              onClick={handleScan}
              disabled={scanning || evaluating}
              sx={{ minWidth: 90 }}
            >
              {scanning ? 'Scanning' : 'Scan'}
            </Button>
            {scanning && (
              <Tooltip title="Pause after current phase">
                <Button onClick={handlePauseScan} color="warning" sx={{ px: 1 }}>
                  <Pause fontSize="small" />
                </Button>
              </Tooltip>
            )}
          </ButtonGroup>

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
                <Button onClick={handlePause} color="warning" sx={{ px: 1 }}>
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
                <ToggleButtonGroup
                  value={evalModel}
                  exclusive
                  onChange={(_, v) => { if (v) setEvalModel(v) }}
                  size="small"
                  fullWidth
                >
                  <ToggleButton value="haiku" sx={{ flex: 1 }}>Quick (Haiku)</ToggleButton>
                  <ToggleButton value="sonnet" sx={{ flex: 1 }}>Deep (Sonnet)</ToggleButton>
                </ToggleButtonGroup>
              </Box>

              <FormControl size="small" fullWidth>
                <InputLabel>Jobs to evaluate</InputLabel>
                <Select
                  value={evalLimit}
                  label="Jobs to evaluate"
                  onChange={(e) => setEvalLimit(Number(e.target.value))}
                >
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

          {progress && (
            <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {progress}
            </Typography>
          )}

          <Box sx={{ flex: 1 }} />

          <Stack direction="row" spacing={1} alignItems="center">
            {tokens > 0 && (
              <Chip label={`${tokens.toLocaleString()} tokens today`} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
            )}

            {health && (
              <>
                <Tooltip title={health.pinchtab ? 'PinchTab connected' : 'PinchTab not found — run: pinchtab daemon install'}>
                  {health.pinchtab
                    ? <CheckCircleOutline sx={{ fontSize: 18, color: 'success.main' }} />
                    : <ErrorOutline sx={{ fontSize: 18, color: 'warning.main' }} />
                  }
                </Tooltip>
                <Tooltip title={health.claude ? 'Claude CLI found' : 'claude CLI not in PATH'}>
                  {health.claude
                    ? <CheckCircleOutline sx={{ fontSize: 18, color: 'success.main' }} />
                    : <ErrorOutline sx={{ fontSize: 18, color: 'error.main' }} />
                  }
                </Tooltip>
              </>
            )}

            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
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
                  <MenuItem
                    key={m}
                    selected={themeMode === m}
                    onClick={() => { setThemeMode(m); setThemeMenuAnchor(null) }}
                    sx={{ gap: 1.5, minWidth: 130 }}
                  >
                    <Icon fontSize="small" sx={{ color: 'text.secondary' }} />
                    {themeModeLabels[m]}
                  </MenuItem>
                )
              })}
            </Menu>
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
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </Box>
    </Box>
  )
}
