import { useState, useEffect } from 'react'
import {
  Box, Tabs, Tab, Typography, Paper, Stack, Chip, IconButton,
  Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Divider, Switch, Button, CircularProgress,
  ToggleButtonGroup, ToggleButton, Alert,
} from '@mui/material'
import { Delete, CheckCircle, Error, AlarmOn, ArrowBack } from '@mui/icons-material'
import { useNavigate } from 'react-router-dom'
import { api, type AutomationConfig, type AutomationStatus } from '../api.js'
import { ProfileForm } from '../components/ProfileForm.js'
import { PortalsForm } from '../components/PortalsForm.js'
import { FiltersForm } from '../components/FiltersForm.js'
import { CvForm } from '../components/CvForm.js'

export function SettingsPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState(0)
  const [status, setStatus] = useState<{
    pinchtab: { ok: boolean; message?: string }
    claude: { ok: boolean; path?: string; message?: string }
  } | null>(null)

  useEffect(() => {
    api.settings.status().then(setStatus).catch(() => null)
  }, [])

  return (
    <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
      <Stack direction="row" spacing={2} alignItems="center" mb={3}>
        <IconButton size="small" onClick={() => navigate('/pipeline')} sx={{ color: 'text.secondary' }}>
          <ArrowBack fontSize="small" />
        </IconButton>
        <Typography variant="h6">Settings</Typography>
        <Stack direction="row" spacing={1}>
          <StatusBadge ok={status?.pinchtab.ok} label="PinchTab" hint={status?.pinchtab.message ?? 'pinchtab daemon install'} />
          <StatusBadge ok={status?.claude.ok} label="Claude CLI" hint={status?.claude.message ?? 'claude not in PATH'} />
        </Stack>
      </Stack>

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: '1px solid', borderColor: 'divider', px: 2 }}>
          <Tab label="Profile" />
          <Tab label="Portals" />
          <Tab label="Filters" />
          <Tab label="CV" />
          <Tab label="Field Mappings" />
          <Tab label="Automation" icon={<AlarmOn sx={{ fontSize: 16 }} />} iconPosition="start" />
        </Tabs>

        <Box sx={{ p: 3 }}>
          {tab === 0 && <ProfileForm />}
          {tab === 1 && <PortalsForm />}
          {tab === 2 && <FiltersForm />}
          {tab === 3 && <CvForm />}
          {tab === 4 && <FieldMappingsTab />}
          {tab === 5 && <AutomationTab />}
        </Box>
      </Paper>
    </Box>
  )
}

function StatusBadge({ ok, label, hint }: { ok?: boolean; label: string; hint: string }) {
  if (ok == null) return <Chip label={label} size="small" variant="outlined" />
  return (
    <Chip
      icon={ok ? <CheckCircle sx={{ fontSize: 14 }} /> : <Error sx={{ fontSize: 14 }} />}
      label={ok ? label : `${label} — ${hint}`}
      size="small"
      color={ok ? 'success' : 'warning'}
      variant="outlined"
      sx={{ fontSize: '0.75rem' }}
    />
  )
}

function AutomationTab() {
  const [status, setStatus] = useState<AutomationStatus | null>(null)
  const [config, setConfig] = useState<AutomationConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.settings.automation().then(data => {
      const { lastScanAt, nextScanAt, keepAwakeSupported, ...cfg } = data
      setConfig(cfg)
      setStatus(data)
    }).catch(() => null)
  }, [])

  const save = async () => {
    if (!config) return
    setSaving(true)
    try {
      await api.settings.saveAutomation(config)
      const fresh = await api.settings.automation()
      setStatus(fresh)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const update = (patch: Partial<AutomationConfig>) =>
    setConfig(c => c ? { ...c, ...patch } : c)

  if (!config || !status) return <CircularProgress size={20} />

  return (
    <Stack spacing={3}>
      {/* Auto Scan */}
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box>
              <Typography variant="subtitle2">Auto Scan</Typography>
              <Typography variant="caption" color="text.secondary">
                Runs a scan automatically at a regular interval
              </Typography>
            </Box>
            <Switch
              checked={config.autoScan.enabled}
              onChange={e => update({ autoScan: { ...config.autoScan, enabled: e.target.checked } })}
            />
          </Stack>

          {config.autoScan.enabled && (
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Typography variant="body2" color="text.secondary">Every</Typography>
              <TextField
                type="number"
                size="small"
                value={config.autoScan.intervalHours}
                onChange={e => update({ autoScan: { ...config.autoScan, intervalHours: Math.max(1, Number(e.target.value)) } })}
                inputProps={{ min: 1, max: 168 }}
                sx={{ width: 80 }}
              />
              <Typography variant="body2" color="text.secondary">hours</Typography>
            </Stack>
          )}

          {config.autoScan.enabled && status.nextScanAt && (
            <Typography variant="caption" color="text.secondary">
              Next scan: {new Date(status.nextScanAt).toLocaleString()}
              {status.lastScanAt && ` · Last: ${new Date(status.lastScanAt).toLocaleString()}`}
            </Typography>
          )}
        </Stack>
      </Paper>

      {/* Auto Evaluate */}
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box>
              <Typography variant="subtitle2">Auto Evaluate</Typography>
              <Typography variant="caption" color="text.secondary">
                Evaluates inbox jobs a few minutes after each scan completes
              </Typography>
            </Box>
            <Switch
              checked={config.autoEvaluate.enabled}
              onChange={e => update({ autoEvaluate: { ...config.autoEvaluate, enabled: e.target.checked } })}
            />
          </Stack>

          {config.autoEvaluate.enabled && (
            <Stack spacing={2}>
              <Stack direction="row" alignItems="center" spacing={1.5}>
                <Typography variant="body2" color="text.secondary">Wait</Typography>
                <TextField
                  type="number"
                  size="small"
                  value={config.autoEvaluate.delayMinutes}
                  onChange={e => update({ autoEvaluate: { ...config.autoEvaluate, delayMinutes: Math.max(1, Number(e.target.value)) } })}
                  inputProps={{ min: 1, max: 1440 }}
                  sx={{ width: 80 }}
                />
                <Typography variant="body2" color="text.secondary">minutes after scan finishes</Typography>
              </Stack>

              <Box>
                <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>Model</Typography>
                <ToggleButtonGroup
                  value={config.autoEvaluate.model}
                  exclusive
                  onChange={(_, v) => { if (v) update({ autoEvaluate: { ...config.autoEvaluate, model: v } }) }}
                  size="small"
                >
                  <ToggleButton value="haiku">Quick (Haiku)</ToggleButton>
                  <ToggleButton value="sonnet">Deep (Sonnet)</ToggleButton>
                </ToggleButtonGroup>
              </Box>
            </Stack>
          )}
        </Stack>
      </Paper>

      {/* Keep Awake */}
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box>
              <Typography variant="subtitle2">Keep Awake</Typography>
              <Typography variant="caption" color="text.secondary">
                Prevents the computer from sleeping while the server is running
              </Typography>
            </Box>
            <Switch
              checked={config.keepAwake.enabled}
              disabled={!status.keepAwakeSupported}
              onChange={e => update({ keepAwake: { enabled: e.target.checked } })}
            />
          </Stack>

          {!status.keepAwakeSupported && (
            <Alert severity="info" sx={{ py: 0.5 }}>
              Keep Awake uses <code>caffeinate</code> and is only supported on macOS.
            </Alert>
          )}
        </Stack>
      </Paper>

      <Stack direction="row" justifyContent="flex-end">
        <Button
          variant="contained"
          onClick={save}
          disabled={saving}
          startIcon={saving
            ? <CircularProgress size={14} color="inherit" />
            : saved ? <CheckCircle sx={{ fontSize: 16 }} /> : undefined}
        >
          {saved ? 'Saved' : 'Save'}
        </Button>
      </Stack>
    </Stack>
  )
}

function FieldMappingsTab() {
  const [mappings, setMappings] = useState<Array<{
    id: number; question_text: string; answer: string; ats_type?: string; use_count: number
  }>>([])
  const [editing, setEditing] = useState<Record<number, string>>({})

  const load = async () => {
    const data = await api.settings.fieldMappings()
    setMappings(data as typeof mappings)
  }

  useEffect(() => { load() }, [])

  const remove = async (id: number) => {
    await api.settings.deleteMapping(id)
    load()
  }

  const saveEdit = async (id: number) => {
    const newAnswer = editing[id]
    if (newAnswer === undefined) return
    // Optimistic update via re-save: delete + re-add via the answer edit
    // For now update locally and notify user to re-apply if needed
    setMappings(m => m.map(x => x.id === id ? { ...x, answer: newAnswer } : x))
    setEditing(e => { const n = { ...e }; delete n[id]; return n })
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Cached answers for application form fields. Built automatically as you apply to jobs.
        Edit incorrect answers inline or delete to force a fresh Claude response next time.
      </Typography>
      <Divider />
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Question</TableCell>
            <TableCell>Answer</TableCell>
            <TableCell>ATS</TableCell>
            <TableCell align="right">Uses</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {mappings.map(m => (
            <TableRow key={m.id}>
              <TableCell sx={{ fontSize: '0.78rem', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.question_text}
              </TableCell>
              <TableCell sx={{ maxWidth: 260 }}>
                {editing[m.id] !== undefined ? (
                  <TextField
                    variant="standard"
                    value={editing[m.id]}
                    size="small"
                    fullWidth
                    autoFocus
                    onChange={e => setEditing(ed => ({ ...ed, [m.id]: e.target.value }))}
                    onBlur={() => saveEdit(m.id)}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(m.id) }}
                  />
                ) : (
                  <Typography
                    variant="caption"
                    sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' }, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    onClick={() => setEditing(ed => ({ ...ed, [m.id]: m.answer }))}
                    title="Click to edit"
                  >
                    {m.answer}
                  </Typography>
                )}
              </TableCell>
              <TableCell>
                <Chip label={m.ats_type ?? '—'} size="small" variant="outlined" sx={{ fontSize: '0.68rem' }} />
              </TableCell>
              <TableCell align="right">
                <Typography variant="caption">{m.use_count}</Typography>
              </TableCell>
              <TableCell>
                <IconButton size="small" onClick={() => remove(m.id)}><Delete fontSize="small" /></IconButton>
              </TableCell>
            </TableRow>
          ))}
          {mappings.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>
                <Typography variant="caption" color="text.secondary">
                  No mappings yet. They accumulate automatically as you apply to jobs.
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Stack>
  )
}
