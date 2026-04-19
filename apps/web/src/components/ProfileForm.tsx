import { useState, useEffect } from 'react'
import {
  Stack, TextField, MenuItem, Select, FormControl, InputLabel,
  Table, TableBody, TableCell, TableHead, TableRow, IconButton,
  Button, Box, Typography, FormControlLabel, Switch,
} from '@mui/material'
import { Add, Delete } from '@mui/icons-material'
import { api } from '../api.js'
import { ChipArrayInput } from './ChipArrayInput.js'
import { SectionHeader } from './SectionHeader.js'
import { SaveBar } from './SaveBar.js'

interface Archetype { name: string; level: string; fit: string }
interface ProofPoint { name: string; url: string; hero_metric: string }
interface ArchetypeKeywords { [slug: string]: string[] }

interface Candidate {
  full_name: string; email: string; phone: string; location: string; linkedin: string; portfolio_url: string; github: string
  // Application defaults (optional) — used by Auto Fill for screening/demographic questions.
  gender: string; pronouns: string; race_ethnicity: string; veteran_status: string; disability_status: string
  work_authorization: string; requires_sponsorship: string
  current_company: string; years_of_experience: string; how_did_you_hear: string
}

interface Profile {
  candidate: Candidate
  target_roles: { primary: string[]; archetypes: Archetype[] }
  narrative: { headline: string; exit_story: string; superpowers: string[]; proof_points: ProofPoint[] }
  compensation: { target_range: string; currency: string; minimum: string; location_flexibility: string }
  location: { country: string; city: string; timezone: string; visa_status: string }
  prescreen: {
    seniority_min: string
    comp_floor: number
    location_policy: {
      allow_onsite_cities: string[]
      require_remote_if_elsewhere: boolean
      require_us_or_remote: boolean
    }
    blocklist_titles: string[]
    archetype_keywords: ArchetypeKeywords
  }
}

const EMPTY: Profile = {
  candidate: {
    full_name: '', email: '', phone: '', location: '', linkedin: '', portfolio_url: '', github: '',
    gender: '', pronouns: '', race_ethnicity: '', veteran_status: '', disability_status: '',
    work_authorization: '', requires_sponsorship: '',
    current_company: '', years_of_experience: '', how_did_you_hear: '',
  },
  target_roles: { primary: [], archetypes: [] },
  narrative: { headline: '', exit_story: '', superpowers: [], proof_points: [] },
  compensation: { target_range: '', currency: 'USD', minimum: '', location_flexibility: '' },
  location: { country: '', city: '', timezone: '', visa_status: '' },
  prescreen: {
    seniority_min: 'Senior',
    comp_floor: 0,
    location_policy: { allow_onsite_cities: [], require_remote_if_elsewhere: true, require_us_or_remote: true },
    blocklist_titles: ['intern', 'internship', 'junior', 'entry-level'],
    archetype_keywords: {},
  },
}

const SENIORITY_OPTIONS = ['', 'Junior', 'Mid', 'Senior', 'Staff', 'Principal', 'Director', 'Head', 'VP']
const FIT_OPTIONS = ['primary', 'secondary', 'adjacent']

export function ProfileForm() {
  const [profile, setProfile] = useState<Profile>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.settings.profile().then(v => {
      if (v) setProfile(deepMerge(EMPTY, v as Partial<Profile>))
    }).catch(() => null)
  }, [])

  const set = <K extends keyof Profile>(section: K, value: Profile[K]) =>
    setProfile(p => ({ ...p, [section]: value }))

  const setCandidate = (field: keyof Profile['candidate'], value: string) =>
    set('candidate', { ...profile.candidate, [field]: value })

  const setNarrative = (field: keyof Profile['narrative'], value: unknown) =>
    set('narrative', { ...profile.narrative, [field]: value })

  const setCompensation = (field: keyof Profile['compensation'], value: string) =>
    set('compensation', { ...profile.compensation, [field]: value })

  const setLocation = (field: keyof Profile['location'], value: string) =>
    set('location', { ...profile.location, [field]: value })

  const setPrescreen = (field: keyof Profile['prescreen'], value: unknown) =>
    set('prescreen', { ...profile.prescreen, [field]: value })

  const save = async () => {
    setSaving(true); setError(null)
    try {
      await api.settings.saveProfile(profile)
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  // ── Archetype keywords helper ─────────────────────────────────────────────
  const [newArchSlug, setNewArchSlug] = useState('')
  const addArchetypeSlug = () => {
    const slug = newArchSlug.trim().toLowerCase().replace(/\s+/g, '_')
    if (!slug || profile.prescreen.archetype_keywords[slug] !== undefined) return
    setPrescreen('archetype_keywords', { ...profile.prescreen.archetype_keywords, [slug]: [] })
    setNewArchSlug('')
  }
  const removeArchetypeSlug = (slug: string) => {
    const kw = { ...profile.prescreen.archetype_keywords }
    delete kw[slug]
    setPrescreen('archetype_keywords', kw)
  }
  const setArchetypeKeywords = (slug: string, kws: string[]) =>
    setPrescreen('archetype_keywords', { ...profile.prescreen.archetype_keywords, [slug]: kws })

  return (
    <Stack spacing={4} sx={{ maxWidth: 780 }}>

      {/* ── Candidate ── */}
      <Stack spacing={2}>
        <SectionHeader title="Personal Info" description="Same fields as the CV tab — saving either one syncs the other." />
        <Stack direction="row" spacing={2}>
          <TextField label="Full name" value={profile.candidate.full_name} onChange={e => setCandidate('full_name', e.target.value)} fullWidth size="small" />
          <TextField label="Email" value={profile.candidate.email} onChange={e => setCandidate('email', e.target.value)} fullWidth size="small" />
        </Stack>
        <Stack direction="row" spacing={2}>
          <TextField label="Phone" value={profile.candidate.phone} onChange={e => setCandidate('phone', e.target.value)} fullWidth size="small" />
          <TextField label="Location" value={profile.candidate.location} onChange={e => setCandidate('location', e.target.value)} fullWidth size="small" placeholder="San Francisco, CA" />
        </Stack>
        <Stack direction="row" spacing={2}>
          <TextField label="LinkedIn" value={profile.candidate.linkedin} onChange={e => setCandidate('linkedin', e.target.value)} fullWidth size="small" placeholder="linkedin.com/in/..." />
          <TextField label="GitHub" value={profile.candidate.github} onChange={e => setCandidate('github', e.target.value)} fullWidth size="small" placeholder="github.com/..." />
        </Stack>
        <TextField label="Portfolio / Website" value={profile.candidate.portfolio_url} onChange={e => setCandidate('portfolio_url', e.target.value)} size="small" />
      </Stack>

      {/* ── Application Defaults ── */}
      <Stack spacing={2}>
        <SectionHeader
          title="Application Defaults"
          description="Answers Auto Fill pre-seeds into the field-mapping cache so you stop typing them on every form. Leave any field blank to let the agent ask/skip it."
        />
        <Stack direction="row" spacing={2}>
          <FormControl size="small" fullWidth>
            <InputLabel>Authorized to work (country of the role)</InputLabel>
            <Select label="Authorized to work (country of the role)" value={profile.candidate.work_authorization} onChange={e => setCandidate('work_authorization', e.target.value)}>
              <MenuItem value="">(ask)</MenuItem>
              <MenuItem value="Yes">Yes</MenuItem>
              <MenuItem value="No">No</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel>Require visa sponsorship?</InputLabel>
            <Select label="Require visa sponsorship?" value={profile.candidate.requires_sponsorship} onChange={e => setCandidate('requires_sponsorship', e.target.value)}>
              <MenuItem value="">(ask)</MenuItem>
              <MenuItem value="No">No</MenuItem>
              <MenuItem value="Yes">Yes</MenuItem>
            </Select>
          </FormControl>
        </Stack>
        <Stack direction="row" spacing={2}>
          <TextField label="Current company" value={profile.candidate.current_company} onChange={e => setCandidate('current_company', e.target.value)} size="small" fullWidth />
          <TextField label="Years of experience" value={profile.candidate.years_of_experience} onChange={e => setCandidate('years_of_experience', e.target.value)} size="small" fullWidth placeholder="e.g. 8" />
        </Stack>
        <TextField label="How did you hear about us? (default answer)" value={profile.candidate.how_did_you_hear} onChange={e => setCandidate('how_did_you_hear', e.target.value)} size="small" fullWidth placeholder="e.g. LinkedIn" />

        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>Demographics (optional, used for self-ID screens)</Typography>
        <Stack direction="row" spacing={2}>
          <TextField label="Gender" value={profile.candidate.gender} onChange={e => setCandidate('gender', e.target.value)} size="small" fullWidth placeholder="e.g. Male / Female / Non-binary / Decline to self-identify" />
          <TextField label="Pronouns" value={profile.candidate.pronouns} onChange={e => setCandidate('pronouns', e.target.value)} size="small" fullWidth placeholder="e.g. he/him" />
        </Stack>
        <Stack direction="row" spacing={2}>
          <TextField label="Race / Ethnicity" value={profile.candidate.race_ethnicity} onChange={e => setCandidate('race_ethnicity', e.target.value)} size="small" fullWidth placeholder="e.g. White / Hispanic or Latino / Decline to self-identify" />
        </Stack>
        <Stack direction="row" spacing={2}>
          <TextField label="Veteran status" value={profile.candidate.veteran_status} onChange={e => setCandidate('veteran_status', e.target.value)} size="small" fullWidth placeholder="e.g. I am not a protected veteran" />
          <TextField label="Disability status" value={profile.candidate.disability_status} onChange={e => setCandidate('disability_status', e.target.value)} size="small" fullWidth placeholder="e.g. No, I do not have a disability" />
        </Stack>
      </Stack>

      {/* ── Target Roles ── */}
      <Stack spacing={2}>
        <SectionHeader title="Target Roles" />
        <ChipArrayInput
          label="Primary roles"
          values={profile.target_roles.primary}
          onChange={v => set('target_roles', { ...profile.target_roles, primary: v })}
          placeholder="e.g. Senior AI Engineer"
        />
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>Archetypes</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Role name</TableCell>
              <TableCell>Level</TableCell>
              <TableCell>Fit</TableCell>
              <TableCell width={40} />
            </TableRow>
          </TableHead>
          <TableBody>
            {profile.target_roles.archetypes.map((a, i) => (
              <TableRow key={i}>
                <TableCell>
                  <TextField variant="standard" value={a.name} size="small" fullWidth
                    onChange={e => set('target_roles', { ...profile.target_roles, archetypes: profile.target_roles.archetypes.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
                </TableCell>
                <TableCell>
                  <TextField variant="standard" value={a.level} size="small"
                    onChange={e => set('target_roles', { ...profile.target_roles, archetypes: profile.target_roles.archetypes.map((x, j) => j === i ? { ...x, level: e.target.value } : x) })} />
                </TableCell>
                <TableCell>
                  <Select variant="standard" value={a.fit} size="small"
                    onChange={e => set('target_roles', { ...profile.target_roles, archetypes: profile.target_roles.archetypes.map((x, j) => j === i ? { ...x, fit: e.target.value } : x) })}>
                    {FIT_OPTIONS.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                  </Select>
                </TableCell>
                <TableCell>
                  <IconButton size="small" onClick={() => set('target_roles', { ...profile.target_roles, archetypes: profile.target_roles.archetypes.filter((_, j) => j !== i) })}>
                    <Delete fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={4}>
                <Button size="small" startIcon={<Add />}
                  onClick={() => set('target_roles', { ...profile.target_roles, archetypes: [...profile.target_roles.archetypes, { name: '', level: 'Senior', fit: 'primary' }] })}>
                  Add archetype
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Stack>

      {/* ── Narrative ── */}
      <Stack spacing={2}>
        <SectionHeader title="Narrative" description="Used in evaluation prompts to give Claude context about you." />
        <TextField label="Headline" value={profile.narrative.headline} onChange={e => setNarrative('headline', e.target.value)} fullWidth size="small" placeholder="ML Engineer turned AI product builder" />
        <TextField label="Exit story / unique angle" value={profile.narrative.exit_story} onChange={e => setNarrative('exit_story', e.target.value)} fullWidth size="small" multiline minRows={2} />
        <ChipArrayInput label="Superpowers" values={profile.narrative.superpowers} onChange={v => setNarrative('superpowers', v)} placeholder="e.g. Fast prototyping" />

        <Typography variant="caption" color="text.secondary">Proof points</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>URL</TableCell>
              <TableCell>Hero metric</TableCell>
              <TableCell width={40} />
            </TableRow>
          </TableHead>
          <TableBody>
            {profile.narrative.proof_points.map((p, i) => (
              <TableRow key={i}>
                <TableCell><TextField variant="standard" value={p.name} size="small" onChange={e => setNarrative('proof_points', profile.narrative.proof_points.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /></TableCell>
                <TableCell><TextField variant="standard" value={p.url} size="small" fullWidth onChange={e => setNarrative('proof_points', profile.narrative.proof_points.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} /></TableCell>
                <TableCell><TextField variant="standard" value={p.hero_metric} size="small" onChange={e => setNarrative('proof_points', profile.narrative.proof_points.map((x, j) => j === i ? { ...x, hero_metric: e.target.value } : x))} /></TableCell>
                <TableCell><IconButton size="small" onClick={() => setNarrative('proof_points', profile.narrative.proof_points.filter((_, j) => j !== i))}><Delete fontSize="small" /></IconButton></TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={4}>
                <Button size="small" startIcon={<Add />} onClick={() => setNarrative('proof_points', [...profile.narrative.proof_points, { name: '', url: '', hero_metric: '' }])}>Add proof point</Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Stack>

      {/* ── Compensation ── */}
      <Stack spacing={2}>
        <SectionHeader title="Compensation" />
        <Stack direction="row" spacing={2}>
          <TextField label="Target range" value={profile.compensation.target_range} onChange={e => setCompensation('target_range', e.target.value)} size="small" placeholder="$150K–200K" />
          <TextField label="Minimum (walk-away)" value={profile.compensation.minimum} onChange={e => setCompensation('minimum', e.target.value)} size="small" placeholder="$120K" />
          <TextField label="Currency" value={profile.compensation.currency} onChange={e => setCompensation('currency', e.target.value)} size="small" sx={{ width: 100 }} />
        </Stack>
        <TextField label="Location flexibility" value={profile.compensation.location_flexibility} onChange={e => setCompensation('location_flexibility', e.target.value)} size="small" fullWidth placeholder="Remote preferred, 1 week/month on-site possible" />
      </Stack>

      {/* ── Location ── */}
      <Stack spacing={2}>
        <SectionHeader title="Location" />
        <Stack direction="row" spacing={2}>
          <TextField label="Country" value={profile.location.country} onChange={e => setLocation('country', e.target.value)} size="small" fullWidth />
          <TextField label="City" value={profile.location.city} onChange={e => setLocation('city', e.target.value)} size="small" fullWidth />
        </Stack>
        <Stack direction="row" spacing={2}>
          <TextField label="Timezone" value={profile.location.timezone} onChange={e => setLocation('timezone', e.target.value)} size="small" fullWidth placeholder="PST" />
          <TextField label="Visa status" value={profile.location.visa_status} onChange={e => setLocation('visa_status', e.target.value)} size="small" fullWidth placeholder="No sponsorship needed" />
        </Stack>
      </Stack>

      {/* ── Prescreen ── */}
      <Stack spacing={2}>
        <SectionHeader title="Pre-scan Filters" description="Applied locally before any LLM call — zero token cost." />
        <Stack direction="row" spacing={2} alignItems="flex-start">
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Minimum seniority</InputLabel>
            <Select label="Minimum seniority" value={profile.prescreen.seniority_min ?? ''} onChange={e => setPrescreen('seniority_min', e.target.value)}>
              {SENIORITY_OPTIONS.map(o => <MenuItem key={o} value={o}>{o || '(none)'}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label="Min compensation (0 = off)" type="number" size="small"
            value={profile.prescreen.comp_floor ?? 0}
            onChange={e => setPrescreen('comp_floor', Number(e.target.value))}
            InputProps={{ inputProps: { min: 0, step: 1000 } }}
            sx={{ width: 220 }}
          />
        </Stack>
        <ChipArrayInput
          label="Blocklist titles"
          values={profile.prescreen.blocklist_titles}
          onChange={v => setPrescreen('blocklist_titles', v)}
          placeholder="e.g. intern"
          color="error"
        />
        <ChipArrayInput
          label="Allowed on-site cities (empty = any)"
          values={profile.prescreen.location_policy?.allow_onsite_cities ?? []}
          onChange={v => setPrescreen('location_policy', { ...profile.prescreen.location_policy, allow_onsite_cities: v })}
          placeholder="e.g. San Francisco"
        />

        <Stack spacing={0.5}>
          <FormControlLabel
            control={
              <Switch
                checked={profile.prescreen.location_policy?.require_us_or_remote ?? true}
                onChange={e => setPrescreen('location_policy', { ...profile.prescreen.location_policy, require_us_or_remote: e.target.checked })}
                size="small"
              />
            }
            label={
              <Box>
                <Typography variant="body2">Only US or worldwide remote</Typography>
                <Typography variant="caption" color="text.secondary">
                  Rejects non-US locations. "Remote – UK" or "Remote – Turkey" are blocked; "Remote", "Worldwide", and US cities pass.
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            control={
              <Switch
                checked={profile.prescreen.location_policy?.require_remote_if_elsewhere ?? true}
                onChange={e => setPrescreen('location_policy', { ...profile.prescreen.location_policy, require_remote_if_elsewhere: e.target.checked })}
                size="small"
              />
            }
            label={
              <Box>
                <Typography variant="body2">Require remote outside allowed cities</Typography>
                <Typography variant="caption" color="text.secondary">
                  If a role is on-site in a city not listed above, it is skipped.
                </Typography>
              </Box>
            }
          />
        </Stack>

        <Box>
          <Typography variant="caption" color="text.secondary" display="block" mb={1}>
            Archetype keyword map — pre-tags jobs before LLM eval
          </Typography>
          <Stack spacing={2}>
            {Object.entries(profile.prescreen.archetype_keywords).map(([slug, kws]) => (
              <Stack key={slug} direction="row" spacing={1} alignItems="flex-start">
                <Box sx={{ minWidth: 130, pt: 0.5 }}>
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>{slug}</Typography>
                    <IconButton size="small" onClick={() => removeArchetypeSlug(slug)}><Delete sx={{ fontSize: 14 }} /></IconButton>
                  </Stack>
                </Box>
                <Box sx={{ flex: 1 }}>
                  <ChipArrayInput label="" values={kws} onChange={v => setArchetypeKeywords(slug, v)} placeholder="Add keyword" />
                </Box>
              </Stack>
            ))}
            <Stack direction="row" spacing={1}>
              <TextField size="small" value={newArchSlug} onChange={e => setNewArchSlug(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addArchetypeSlug() } }}
                placeholder="New archetype slug (e.g. llmops)" sx={{ width: 260 }} />
              <Button size="small" variant="outlined" startIcon={<Add />} onClick={addArchetypeSlug}>Add archetype</Button>
            </Stack>
          </Stack>
        </Box>
      </Stack>

      <SaveBar onSave={save} saving={saving} saved={saved} error={error} />
    </Stack>
  )
}

// Simple deep merge for filling defaults
function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target } as Record<string, unknown>
  for (const key in source) {
    const s = (source as Record<string, unknown>)[key]
    const t = (target as Record<string, unknown>)[key]
    if (s !== null && typeof s === 'object' && !Array.isArray(s) && typeof t === 'object' && t !== null && !Array.isArray(t)) {
      result[key] = deepMerge(t as Record<string, unknown>, s as Record<string, unknown>)
    } else if (s !== undefined) {
      result[key] = s
    }
  }
  return result as T
}
