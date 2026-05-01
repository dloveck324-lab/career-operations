import { useState, useEffect, useRef } from 'react'
import {
  Box, Paper, Stack, Typography, Button, Stepper, Step, StepLabel, TextField,
  CircularProgress, Alert, Chip, FormControl, InputLabel, Select, MenuItem,
  Switch, FormControlLabel, Divider, IconButton, LinearProgress,
} from '@mui/material'
import { CheckCircle, Error as ErrorIcon, UploadFile, Delete, OpenInNew } from '@mui/icons-material'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api.js'
import { ChipArrayInput } from '../components/ChipArrayInput.js'

// Index ↔ slug ↔ label. The URL slug is what shows up in /welcome/<slug>
// for funnel tracking — every entry and transition fires an event so the
// server log shows where users drop off.
const STEP_SLUGS = ['welcome', 'resume', 'profile', 'filters', 'done'] as const
type StepSlug = typeof STEP_SLUGS[number]
const STEP_LABELS: Record<StepSlug, string> = {
  welcome: 'Welcome',
  resume: 'Resume',
  profile: 'Profile',
  filters: 'Job filters',
  done: 'Done',
}
const STEPS = STEP_SLUGS.map(s => STEP_LABELS[s])

type OnboardingAction = 'enter' | 'next' | 'back' | 'skip' | 'finish'
const trackEvent = (step: StepSlug, action: OnboardingAction) => {
  // Fire-and-forget; never block the UI on telemetry.
  api.onboardingEvent(step, action).catch(() => null)
}

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

interface Portal { name: string; type: string; company_id: string }

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

const portalKey = (p: Portal) => `${p.type}:${p.company_id}`

/**
 * Saves a profile patch without clobbering nested fields the patch doesn't
 * mention. The server's PUT /settings/profile does shallow merge at the top
 * level only — `body.candidate` replaces the full candidate object — so
 * sending {candidate: {work_authorization}} would wipe full_name, email,
 * etc. that the resume step had populated. This helper fetches current
 * profile and shallow-merges each top-level key before saving.
 */
async function patchProfile(patch: Record<string, Record<string, unknown>>) {
  const current = (await api.settings.profile().catch(() => null)) as Record<string, Record<string, unknown>> | null
  const merged: Record<string, Record<string, unknown>> = {}
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = { ...(current?.[key] ?? {}), ...value }
  }
  await api.settings.saveProfile(merged)
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const { step: stepParam } = useParams<{ step: string }>()
  const stepSlug: StepSlug = (STEP_SLUGS as readonly string[]).includes(stepParam ?? '')
    ? (stepParam as StepSlug)
    : 'welcome'
  const step = STEP_SLUGS.indexOf(stepSlug)
  const goto = (i: number, action: OnboardingAction = 'next') => {
    trackEvent(stepSlug, action)
    const target = STEP_SLUGS[Math.max(0, Math.min(STEP_SLUGS.length - 1, i))]
    navigate(`/welcome/${target}`)
  }

  // Fire an `enter` event for every step the user lands on (including via
  // browser back/forward and direct URL hits). Each entry is one funnel data
  // point — the gap between consecutive enters is your drop-off.
  useEffect(() => { trackEvent(stepSlug, 'enter') }, [stepSlug])

  // Resume — keeps the parsed CV preview in memory so navigating back still
  // shows the green "parsed" card without a re-upload.
  const [parsedCv, setParsedCv] = useState<ParsedCv | null>(null)

  // Profile fields — hydrated once on mount from the saved profile.yml.
  const [primary, setPrimary] = useState<string[]>([])
  const [targetRange, setTargetRange] = useState('')
  const [minimum, setMinimum] = useState('')
  const [workAuth, setWorkAuth] = useState('')
  const [sponsorship, setSponsorship] = useState('')
  const [locationFlex, setLocationFlex] = useState('')

  // Filters — hydrated once on mount from filters.yml. STARTER_PORTALS toggles
  // default to ON; any custom portal already in filters.yml is preserved.
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    () => Object.fromEntries(STARTER_PORTALS.map(p => [portalKey(p), true])),
  )
  const [customPortals, setCustomPortals] = useState<Portal[]>([])
  const [queries, setQueries] = useState<string[]>([])

  // One-shot hydrate. Skips loudly so a fresh install just sees defaults.
  useEffect(() => {
    api.settings.profile().then((p: unknown) => {
      const prof = (p ?? {}) as Record<string, Record<string, unknown>>
      const tr = prof.target_roles ?? {}
      const comp = prof.compensation ?? {}
      const cand = prof.candidate ?? {}
      const arr = (tr.primary ?? []) as string[]
      if (Array.isArray(arr) && arr.length) setPrimary(arr)
      setTargetRange((comp.target_range as string) ?? '')
      setMinimum((comp.minimum as string) ?? '')
      setWorkAuth((cand.work_authorization as string) ?? '')
      setSponsorship((cand.requires_sponsorship as string) ?? '')
      setLocationFlex((comp.location_flexibility as string) ?? '')
    }).catch(() => null)

    api.settings.filters().then((f: unknown) => {
      const filters = (f ?? {}) as { portals?: Array<Portal & { enabled?: boolean }>; job_boards?: Array<{ queries?: string[] }> }
      const known = new Set(STARTER_PORTALS.map(portalKey))
      const en: Record<string, boolean> = Object.fromEntries(STARTER_PORTALS.map(p => [portalKey(p), true]))
      const customs: Portal[] = []
      for (const p of filters.portals ?? []) {
        const k = portalKey(p)
        if (known.has(k)) {
          en[k] = p.enabled !== false
        } else if (p.name && p.type && p.company_id) {
          customs.push({ name: p.name, type: p.type, company_id: p.company_id })
          en[k] = p.enabled !== false
        }
      }
      setEnabled(en)
      setCustomPortals(customs)
      const qs = filters.job_boards?.[0]?.queries ?? []
      if (qs.length) setQueries(qs.filter(q => q && q.trim()))
    }).catch(() => null)
  }, [])

  const finish = () => {
    trackEvent(stepSlug, 'finish')
    localStorage.setItem('onboardingDismissed', '1')
    navigate('/pipeline')
  }

  // Step 2 → 3 mirror: paste the primary roles from the profile step over the
  // filters step's queries every time we move forward into filters. Per
  // product spec — the source of truth for "what to search" is the role list.
  const goToFilters = (action: OnboardingAction) => {
    setQueries(primary.filter(Boolean))
    goto(3, action)
  }

  return (
    <Box sx={{
      flex: 1,
      width: '100%',
      display: 'flex',
      minHeight: '100dvh',
      alignItems: { xs: 'flex-start', sm: 'center' },
      justifyContent: 'center',
      bgcolor: 'background.default',
      p: { xs: 1.5, sm: 3, md: 4 },
      overflowY: 'auto',
    }}>
      <Paper elevation={3} sx={{
        p: { xs: 2, sm: 3, md: 4 },
        maxWidth: 720,
        width: '100%',
        borderRadius: { xs: 2, sm: 3 },
      }}>
        <Stack spacing={1} mb={3}>
          <Typography variant="h5" fontWeight={700} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>Welcome to Career Ops</Typography>
          <Typography variant="body2" color="text.secondary">A few quick steps so the app has what it needs to scan, evaluate, and apply on your behalf.</Typography>
        </Stack>

        <Stepper
          activeStep={step}
          alternativeLabel
          sx={{
            mb: { xs: 3, sm: 4 },
            // Compact step labels on mobile so the header doesn't wrap awkwardly
            '& .MuiStepLabel-label': { fontSize: { xs: '0.7rem', sm: '0.8125rem' } },
            '& .MuiStepLabel-iconContainer': { transform: { xs: 'scale(0.85)', sm: 'none' } },
          }}
        >
          {STEPS.map(label => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
        </Stepper>

        {step === 0 && <WelcomeStep onNext={() => goto(1, 'next')} onSkip={finish} />}
        {step === 1 && (
          <ResumeStep
            parsed={parsedCv}
            setParsed={setParsedCv}
            onNext={() => goto(2, 'next')}
            onSkip={() => goto(2, 'skip')}
          />
        )}
        {step === 2 && (
          <ProfileStep
            primary={primary} setPrimary={setPrimary}
            targetRange={targetRange} setTargetRange={setTargetRange}
            minimum={minimum} setMinimum={setMinimum}
            workAuth={workAuth} setWorkAuth={setWorkAuth}
            sponsorship={sponsorship} setSponsorship={setSponsorship}
            locationFlex={locationFlex} setLocationFlex={setLocationFlex}
            onBack={() => goto(1, 'back')}
            onNext={() => goToFilters('next')}
            onSkip={() => goToFilters('skip')}
          />
        )}
        {step === 3 && (
          <FiltersStep
            enabled={enabled} setEnabled={setEnabled}
            customPortals={customPortals} setCustomPortals={setCustomPortals}
            queries={queries} setQueries={setQueries}
            onBack={() => goto(2, 'back')}
            onNext={() => goto(4, 'next')}
            onSkip={() => goto(4, 'skip')}
          />
        )}
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
      {status && (status.claude.ok === false || status.pinchtab.ok === false) && (
        <Alert severity="info" sx={{ '& .MuiAlert-message': { fontSize: '0.85rem' } }}>
          You can continue even if a badge is red — fix it later from the Settings header. Resume parsing in the next step needs Claude CLI to be running.
        </Alert>
      )}
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
interface ResumeStepProps {
  parsed: ParsedCv | null
  setParsed: (v: ParsedCv | null) => void
  onNext: () => void
  onSkip: () => void
}

function ResumeStep({ parsed, setParsed, onNext, onSkip }: ResumeStepProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      const c = parsed.contact ?? {} as Partial<ParsedCv['contact']>
      await patchProfile({
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
interface ProfileStepProps {
  primary: string[]; setPrimary: (v: string[]) => void
  targetRange: string; setTargetRange: (v: string) => void
  minimum: string; setMinimum: (v: string) => void
  workAuth: string; setWorkAuth: (v: string) => void
  sponsorship: string; setSponsorship: (v: string) => void
  locationFlex: string; setLocationFlex: (v: string) => void
  onBack: () => void; onNext: () => void; onSkip: () => void
}

function ProfileStep({
  primary, setPrimary, targetRange, setTargetRange, minimum, setMinimum,
  workAuth, setWorkAuth, sponsorship, setSponsorship, locationFlex, setLocationFlex,
  onBack, onNext, onSkip,
}: ProfileStepProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true); setError(null)
    try {
      await patchProfile({
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
interface FiltersStepProps {
  enabled: Record<string, boolean>; setEnabled: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void
  customPortals: Portal[]; setCustomPortals: (updater: (prev: Portal[]) => Portal[]) => void
  queries: string[]; setQueries: (v: string[]) => void
  onBack: () => void; onNext: () => void; onSkip: () => void
}

function FiltersStep({
  enabled, setEnabled, customPortals, setCustomPortals, queries, setQueries,
  onBack, onNext, onSkip,
}: FiltersStepProps) {
  const [newPortalName, setNewPortalName] = useState('')
  const [newPortalType, setNewPortalType] = useState('greenhouse')
  const [newPortalId, setNewPortalId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allPortals: Portal[] = [...STARTER_PORTALS, ...customPortals]

  const addCustom = () => {
    if (!newPortalName.trim() || !newPortalId.trim()) return
    const key = `${newPortalType}:${newPortalId}`
    if (allPortals.some(p => portalKey(p) === key)) return
    setCustomPortals(c => [...c, { name: newPortalName.trim(), type: newPortalType, company_id: newPortalId.trim() }])
    setEnabled(en => ({ ...en, [key]: true }))
    setNewPortalName(''); setNewPortalId('')
  }

  const removeCustom = (key: string) => {
    setCustomPortals(c => c.filter(p => portalKey(p) !== key))
    setEnabled(en => { const n = { ...en }; delete n[key]; return n })
  }

  const save = async () => {
    setSaving(true); setError(null)
    try {
      const portals = allPortals.map(p => ({ ...p, enabled: enabled[portalKey(p)] !== false }))
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
            const key = portalKey(p)
            const isCustom = customPortals.some(cp => portalKey(cp) === key)
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
      <Stack spacing={0.5}>
        <ChipArrayInput label="Job board search queries (Indeed RSS)" values={queries} onChange={setQueries} placeholder="senior product manager remote" />
        <Typography variant="caption" color="text.secondary">
          Pre-filled from your target roles in the previous step. Edit freely — these go to Indeed RSS as search terms.
        </Typography>
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

// ───────── Step 5: Done ─────────
function DoneStep({ onFinish }: { onFinish: () => void }) {
  return (
    <Stack spacing={3} alignItems="center" textAlign="center" sx={{ py: 2 }}>
      <CheckCircle sx={{ fontSize: 48, color: 'success.main' }} />
      <Stack spacing={1}>
        <Typography variant="h6">You're set up</Typography>
        <Typography variant="body2" color="text.secondary">
          Open the pipeline to start. Once you're there, click <strong>SCAN</strong> in the topbar to fetch jobs, then <strong>EVALUATE</strong> to score them. You can tweak any of this from <strong>Settings</strong> at any time.
        </Typography>
      </Stack>
      <Button onClick={onFinish} variant="contained" size="large">Open the pipeline</Button>
    </Stack>
  )
}
