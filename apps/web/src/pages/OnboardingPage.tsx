import { useState, useEffect, useRef } from 'react'
import {
  Box, Paper, Stack, Typography, Button, Stepper, Step, StepLabel, TextField,
  CircularProgress, Alert, Chip, FormControl, InputLabel, Select, MenuItem,
  Switch, FormControlLabel, Divider, IconButton, LinearProgress,
} from '@mui/material'
import { CheckCircle, Error as ErrorIcon, UploadFile, Delete, OpenInNew } from '@mui/icons-material'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { ChipArrayInput } from '../components/ChipArrayInput.js'

const STEPS = ['Welcome', 'Resume', 'Profile', 'Job filters', 'Done']

const STARTER_PORTALS: Array<{ name: string; type: string; company_id: string }> = [
  { name: 'Anthropic', type: 'greenhouse', company_id: 'anthropic' },
  { name: 'OpenAI', type: 'greenhouse', company_id: 'openai' },
  { name: 'Vercel', type: 'greenhouse', company_id: 'vercel' },
  { name: 'Retool', type: 'greenhouse', company_id: 'retool' },
  { name: 'ElevenLabs', type: 'ashby', company_id: 'elevenlabs' },
  { name: 'Langfuse', type: 'ashby', company_id: 'langfuse' },
  { name: 'n8n', type: 'lever', company_id: 'n8n-io' },
]

interface ParsedCv {
  contact: { name: string; location: string; phone: string; email: string; linkedin: string; website: string }
  summary: string
  experience: Array<{ role: string; company: string; startDate: string; endDate: string; description: string }>
  skills: Array<{ category: string; items: string }>
  leadership: Array<{ title: string; description: string }>
  education: Array<{ degree: string; institution: string }>
}

function serializeCv(d: ParsedCv): string {
  const lines: string[] = [`# ${d.contact.name || ''}`, '']
  const parts = [d.contact.location, d.contact.phone, d.contact.email, d.contact.linkedin, d.contact.website].filter(Boolean)
  if (parts.length) lines.push(parts.join(' | '))
  lines.push('', '---', '', '## Professional Summary', '', d.summary || '', '', '---', '', '## Professional Experience', '')
  for (const e of d.experience ?? []) {
    const period = e.endDate ? `${e.startDate} – ${e.endDate}` : e.startDate
    lines.push(`### ${e.role} | ${e.company} | ${period}`, '', e.description || '', '')
  }
  lines.push('---', '', '## Skills & Certifications', '')
  for (const s of d.skills ?? []) lines.push(s.category ? `- **${s.category}:** ${s.items}` : `- ${s.items}`)
  lines.push('', '---', '', '## Leadership & Mentorship', '')
  for (const l of d.leadership ?? []) lines.push(l.title ? `- **${l.title}:** ${l.description}` : `- ${l.description}`)
  lines.push('', '---', '', '## Education', '')
  for (const ed of d.education ?? []) {
    if (ed.degree && ed.institution) lines.push(`- **${ed.degree}** | ${ed.institution}`)
    else if (ed.degree) lines.push(`- **${ed.degree}**`)
    else if (ed.institution) lines.push(`- ${ed.institution}`)
  }
  lines.push('')
  return lines.join('\n')
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const finish = () => {
    localStorage.setItem('onboardingDismissed', '1')
    navigate('/pipeline')
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh', alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'center', bgcolor: 'background.default', p: { xs: 2, sm: 4 } }}>
      <Paper elevation={3} sx={{ p: { xs: 3, sm: 4 }, maxWidth: 720, width: '100%', borderRadius: 3 }}>
        <Stack spacing={1} mb={3}>
          <Typography variant="h5" fontWeight={700}>Welcome to Career Ops</Typography>
          <Typography variant="body2" color="text.secondary">A few quick steps so the app has what it needs to scan, evaluate, and apply on your behalf.</Typography>
        </Stack>

        <Stepper activeStep={step} alternativeLabel sx={{ mb: 4 }}>
          {STEPS.map(label => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
        </Stepper>

        {step === 0 && <WelcomeStep onNext={() => setStep(1)} onSkip={finish} />}
        {step === 1 && <ResumeStep onNext={() => setStep(2)} onSkip={() => setStep(2)} />}
        {step === 2 && <ProfileStep onBack={() => setStep(1)} onNext={() => setStep(3)} onSkip={() => setStep(3)} />}
        {step === 3 && <FiltersStep onBack={() => setStep(2)} onNext={() => setStep(4)} onSkip={() => setStep(4)} />}
        {step === 4 && <DoneStep onFinish={finish} />}
      </Paper>
    </Box>
  )
}

// ───────── Step 1: Welcome ─────────
function WelcomeStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [status, setStatus] = useState<{ pinchtab: { ok: boolean; message?: string }; claude: { ok: boolean; path?: string; message?: string } } | null>(null)
  useEffect(() => { api.settings.status().then(setStatus).catch(() => null) }, [])

  return (
    <Stack spacing={3}>
      <Typography variant="body1">
        Career Ops is a local-first dashboard for managing a job search. Two background services power it:
      </Typography>
      <Stack spacing={1.5}>
        <DepRow label="Claude CLI" ok={status?.claude.ok} hint="Used for resume parsing, job evaluation, and form autofill." installUrl="https://claude.ai/download" message={status?.claude.message} />
        <DepRow label="PinchTab daemon" ok={status?.pinchtab.ok} hint="Controls Chrome to autofill application forms." installCmd="pinchtab daemon install" message={status?.pinchtab.message} />
      </Stack>
      <Alert severity="info" sx={{ '& .MuiAlert-message': { fontSize: '0.85rem' } }}>
        You can continue even if a badge is red — fix it later from the Settings header. Resume parsing in the next step needs Claude CLI to be running.
      </Alert>
      <Stack direction="row" justifyContent="space-between">
        <Button onClick={onSkip} variant="text" color="inherit">Skip onboarding</Button>
        <Button onClick={onNext} variant="contained">Continue</Button>
      </Stack>
    </Stack>
  )
}

function DepRow({ label, ok, hint, installUrl, installCmd, message }: { label: string; ok?: boolean; hint: string; installUrl?: string; installCmd?: string; message?: string }) {
  const color = ok == null ? 'text.secondary' : ok ? 'success.main' : 'warning.main'
  const Icon = ok ? CheckCircle : ErrorIcon
  return (
    <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
      {ok != null && <Icon sx={{ color, mt: 0.25, fontSize: 20 }} />}
      {ok == null && <CircularProgress size={16} sx={{ mt: 0.5 }} />}
      <Box sx={{ flex: 1 }}>
        <Typography variant="subtitle2">{label} {ok === false && <Typography component="span" variant="caption" color="warning.main"> — not detected</Typography>}</Typography>
        <Typography variant="caption" color="text.secondary" display="block">{hint}</Typography>
        {ok === false && (
          <Box sx={{ mt: 0.5 }}>
            {installCmd && <Typography variant="caption" sx={{ fontFamily: 'monospace', bgcolor: 'action.hover', px: 0.75, py: 0.25, borderRadius: 0.5 }}>{installCmd}</Typography>}
            {installUrl && <Button size="small" variant="text" endIcon={<OpenInNew sx={{ fontSize: 14 }} />} href={installUrl} target="_blank" rel="noreferrer" sx={{ ml: installCmd ? 1 : 0, textTransform: 'none' }}>Install</Button>}
            {message && <Typography variant="caption" color="text.secondary" display="block" mt={0.25}>{message}</Typography>}
          </Box>
        )}
      </Box>
    </Paper>
  )
}

// ───────── Step 2: Resume ─────────
function ResumeStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedCv | null>(null)
  const [savingNext, setSavingNext] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const onFile = async (file: File) => {
    setUploading(true); setError(null)
    try {
      const result = await api.settings.uploadResume(file)
      setParsed(result.cv as ParsedCv)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const persistAndNext = async () => {
    if (!parsed) { onNext(); return }
    setSavingNext(true)
    try {
      await api.settings.saveCv(serializeCv(parsed))
      const c = parsed.contact ?? {}
      await api.settings.saveProfile({
        candidate: {
          full_name: c.name ?? '',
          email: c.email ?? '',
          phone: c.phone ?? '',
          location: c.location ?? '',
          linkedin: c.linkedin ?? '',
          portfolio_url: c.website ?? '',
        },
      })
      onNext()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save resume data.')
    } finally {
      setSavingNext(false)
    }
  }

  return (
    <Stack spacing={3}>
      <Typography variant="body2" color="text.secondary">
        Drop a PDF resume below. Claude will extract your contact info, experience, skills, and education. The PDF is also saved so the autofill agent can attach it to applications.
      </Typography>

      <Paper
        variant="outlined"
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void onFile(f) }}
        sx={{ p: 4, borderStyle: 'dashed', borderRadius: 2, textAlign: 'center', cursor: uploading ? 'default' : 'pointer', '&:hover': { borderColor: 'primary.main' } }}
        onClick={() => !uploading && fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept=".pdf,.txt,.md" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f) }} />
        <Stack spacing={1} alignItems="center">
          {uploading ? (
            <>
              <CircularProgress size={28} />
              <Typography variant="body2" color="text.secondary">Parsing resume with Claude…</Typography>
              <LinearProgress sx={{ width: '60%', mt: 1 }} />
            </>
          ) : parsed ? (
            <>
              <CheckCircle sx={{ fontSize: 32, color: 'success.main' }} />
              <Typography variant="body2" fontWeight={600}>Resume parsed</Typography>
              <Typography variant="caption" color="text.secondary">
                {parsed.contact?.name || 'Name not detected'} · {parsed.experience?.length ?? 0} positions · {parsed.skills?.length ?? 0} skill groups
              </Typography>
              <Button size="small" variant="text" onClick={e => { e.stopPropagation(); fileRef.current?.click() }}>Replace file</Button>
            </>
          ) : (
            <>
              <UploadFile sx={{ fontSize: 32, color: 'text.secondary' }} />
              <Typography variant="body2" fontWeight={600}>Drop your resume PDF here</Typography>
              <Typography variant="caption" color="text.secondary">…or click to browse. PDF, TXT, or MD.</Typography>
            </>
          )}
        </Stack>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}
      {parsed && (
        <Alert severity="success" sx={{ '& .MuiAlert-message': { fontSize: '0.85rem' } }}>
          You can review and edit the extracted details from <strong>Settings → CV</strong> after onboarding.
        </Alert>
      )}

      <Stack direction="row" justifyContent="space-between">
        <Button onClick={onSkip} variant="text" color="inherit" disabled={uploading || savingNext}>Skip — I'll add my CV later</Button>
        <Button onClick={persistAndNext} variant="contained" disabled={!parsed || uploading || savingNext}>
          {savingNext ? <><CircularProgress size={16} sx={{ mr: 1 }} color="inherit" />Saving…</> : 'Continue'}
        </Button>
      </Stack>
    </Stack>
  )
}

// ───────── Step 3: Profile essentials ─────────
function ProfileStep({ onBack, onNext, onSkip }: { onBack: () => void; onNext: () => void; onSkip: () => void }) {
  const [primary, setPrimary] = useState<string[]>([])
  const [targetRange, setTargetRange] = useState('')
  const [minimum, setMinimum] = useState('')
  const [workAuth, setWorkAuth] = useState('')
  const [sponsorship, setSponsorship] = useState('')
  const [locationFlex, setLocationFlex] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.settings.profile().then((p: unknown) => {
      const prof = (p ?? {}) as Record<string, Record<string, unknown>>
      const tr = prof.target_roles ?? {}
      const comp = prof.compensation ?? {}
      const cand = prof.candidate ?? {}
      const arr = (tr.primary ?? []) as string[]
      setPrimary(Array.isArray(arr) ? arr : [])
      setTargetRange((comp.target_range as string) ?? '')
      setMinimum((comp.minimum as string) ?? '')
      setWorkAuth((cand.work_authorization as string) ?? '')
      setSponsorship((cand.requires_sponsorship as string) ?? '')
      setLocationFlex((comp.location_flexibility as string) ?? '')
    }).catch(() => null)
  }, [])

  const save = async () => {
    setSaving(true); setError(null)
    try {
      await api.settings.saveProfile({
        target_roles: { primary, archetypes: primary.map(name => ({ name, level: 'Senior', fit: 'primary' })) },
        compensation: { target_range: targetRange, currency: 'USD', minimum, location_flexibility: locationFlex },
        candidate: { work_authorization: workAuth, requires_sponsorship: sponsorship },
      })
      onNext()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack spacing={3}>
      <Typography variant="body2" color="text.secondary">
        These answers shape both prescreening (zero tokens) and the AI evaluation. You can refine everything later in Settings → Profile.
      </Typography>

      <Stack spacing={2}>
        <ChipArrayInput
          label="Target roles"
          values={primary}
          onChange={setPrimary}
          placeholder="e.g. Senior Product Manager"
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField label="Target compensation" value={targetRange} onChange={e => setTargetRange(e.target.value)} size="small" fullWidth placeholder="$150K–200K" />
          <TextField label="Minimum (walk-away)" value={minimum} onChange={e => setMinimum(e.target.value)} size="small" fullWidth placeholder="$120K" />
        </Stack>

        <TextField label="Location flexibility" value={locationFlex} onChange={e => setLocationFlex(e.target.value)} size="small" fullWidth placeholder="Remote preferred, open to occasional travel" />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <FormControl size="small" fullWidth>
            <InputLabel>Authorized to work?</InputLabel>
            <Select label="Authorized to work?" value={workAuth} onChange={e => setWorkAuth(e.target.value)}>
              <MenuItem value=""><em>(skip — agent will ask)</em></MenuItem>
              <MenuItem value="Yes">Yes</MenuItem>
              <MenuItem value="No">No</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel>Need visa sponsorship?</InputLabel>
            <Select label="Need visa sponsorship?" value={sponsorship} onChange={e => setSponsorship(e.target.value)}>
              <MenuItem value=""><em>(skip — agent will ask)</em></MenuItem>
              <MenuItem value="No">No</MenuItem>
              <MenuItem value="Yes">Yes</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" justifyContent="space-between">
        <Button onClick={onBack} variant="text" color="inherit">Back</Button>
        <Stack direction="row" spacing={1}>
          <Button onClick={onSkip} variant="text" color="inherit" disabled={saving}>Skip</Button>
          <Button onClick={save} variant="contained" disabled={saving}>
            {saving ? <><CircularProgress size={16} sx={{ mr: 1 }} color="inherit" />Saving…</> : 'Continue'}
          </Button>
        </Stack>
      </Stack>
    </Stack>
  )
}

// ───────── Step 4: Filters ─────────
function FiltersStep({ onBack, onNext, onSkip }: { onBack: () => void; onNext: () => void; onSkip: () => void }) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    () => Object.fromEntries(STARTER_PORTALS.map(p => [`${p.type}:${p.company_id}`, true])),
  )
  const [customPortals, setCustomPortals] = useState<Array<{ name: string; type: string; company_id: string }>>([])
  const [newPortalName, setNewPortalName] = useState('')
  const [newPortalType, setNewPortalType] = useState('greenhouse')
  const [newPortalId, setNewPortalId] = useState('')
  const [queries, setQueries] = useState<string[]>(['senior product manager remote'])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allPortals = [...STARTER_PORTALS, ...customPortals]

  const addCustom = () => {
    if (!newPortalName.trim() || !newPortalId.trim()) return
    const key = `${newPortalType}:${newPortalId}`
    if (allPortals.some(p => `${p.type}:${p.company_id}` === key)) return
    setCustomPortals(c => [...c, { name: newPortalName.trim(), type: newPortalType, company_id: newPortalId.trim() }])
    setEnabled(en => ({ ...en, [key]: true }))
    setNewPortalName(''); setNewPortalId('')
  }

  const removeCustom = (key: string) => {
    setCustomPortals(c => c.filter(p => `${p.type}:${p.company_id}` !== key))
    setEnabled(en => { const n = { ...en }; delete n[key]; return n })
  }

  const save = async () => {
    setSaving(true); setError(null)
    try {
      const portals = allPortals.map(p => ({ ...p, enabled: enabled[`${p.type}:${p.company_id}`] !== false }))
      await api.settings.saveFilters({
        portals,
        job_boards: [{ type: 'indeed_rss', queries: queries.filter(q => q.trim()), enabled: queries.some(q => q.trim()) }],
        required_keywords: [],
      })
      onNext()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack spacing={3}>
      <Typography variant="body2" color="text.secondary">
        Pick which company career pages to scan. Toggle off any you don't care about, or add your own — the company ID is the slug from their careers URL (e.g. boards.greenhouse.io/<strong>anthropic</strong>).
      </Typography>

      <Paper variant="outlined" sx={{ maxHeight: 280, overflow: 'auto' }}>
        <Stack divider={<Divider />}>
          {allPortals.map(p => {
            const key = `${p.type}:${p.company_id}`
            const isCustom = customPortals.some(cp => `${cp.type}:${cp.company_id}` === key)
            return (
              <Stack key={key} direction="row" alignItems="center" spacing={1.5} sx={{ px: 2, py: 1 }}>
                <FormControlLabel
                  sx={{ flex: 1, m: 0 }}
                  control={<Switch size="small" checked={enabled[key] !== false} onChange={e => setEnabled(en => ({ ...en, [key]: e.target.checked }))} />}
                  label={<Stack direction="row" spacing={1} alignItems="center"><Typography variant="body2">{p.name}</Typography><Chip label={p.type} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} /><Typography variant="caption" color="text.secondary">{p.company_id}</Typography></Stack>}
                />
                {isCustom && <IconButton size="small" onClick={() => removeCustom(key)}><Delete fontSize="small" /></IconButton>}
              </Stack>
            )
          })}
        </Stack>
      </Paper>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-end' }}>
        <TextField size="small" label="Add a portal" placeholder="Stripe" value={newPortalName} onChange={e => setNewPortalName(e.target.value)} sx={{ flex: 2 }} />
        <FormControl size="small" sx={{ flex: 1, minWidth: 120 }}>
          <InputLabel>Type</InputLabel>
          <Select label="Type" value={newPortalType} onChange={e => setNewPortalType(e.target.value)}>
            <MenuItem value="greenhouse">greenhouse</MenuItem>
            <MenuItem value="ashby">ashby</MenuItem>
            <MenuItem value="lever">lever</MenuItem>
          </Select>
        </FormControl>
        <TextField size="small" label="Company ID" placeholder="stripe" value={newPortalId} onChange={e => setNewPortalId(e.target.value)} sx={{ flex: 2 }} />
        <Button onClick={addCustom} variant="outlined" disabled={!newPortalName.trim() || !newPortalId.trim()}>Add</Button>
      </Stack>

      <Divider />
      <ChipArrayInput label="Job board search queries (Indeed RSS)" values={queries} onChange={setQueries} placeholder="senior product manager remote" />

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" justifyContent="space-between">
        <Button onClick={onBack} variant="text" color="inherit">Back</Button>
        <Stack direction="row" spacing={1}>
          <Button onClick={onSkip} variant="text" color="inherit" disabled={saving}>Skip</Button>
          <Button onClick={save} variant="contained" disabled={saving}>
            {saving ? <><CircularProgress size={16} sx={{ mr: 1 }} color="inherit" />Saving…</> : 'Continue'}
          </Button>
        </Stack>
      </Stack>
    </Stack>
  )
}

// ───────── Step 5: Done ─────────
function DoneStep({ onFinish }: { onFinish: () => void }) {
  return (
    <Stack spacing={3} alignItems="center" textAlign="center" sx={{ py: 2 }}>
      <CheckCircle sx={{ fontSize: 48, color: 'success.main' }} />
      <Stack spacing={1}>
        <Typography variant="h6">You're set up</Typography>
        <Typography variant="body2" color="text.secondary">
          Click <strong>SCAN</strong> in the topbar to fetch jobs, then <strong>EVALUATE</strong> to score them. Tweak any of this from <strong>Settings</strong> at any time.
        </Typography>
      </Stack>
      <Button onClick={onFinish} variant="contained" size="large">Open the pipeline</Button>
    </Stack>
  )
}
