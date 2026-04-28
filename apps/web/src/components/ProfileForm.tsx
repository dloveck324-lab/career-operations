import { useState, useEffect } from 'react'
import {
  Stack, TextField, MenuItem, Select, FormControl, InputLabel,
  Table, TableBody, TableCell, TableHead, TableRow, IconButton,
  Button, Box, Typography, ToggleButton, ToggleButtonGroup,
} from '@mui/material'
import { Autocomplete } from '@mui/material'
import { Add, Delete } from '@mui/icons-material'
import { api } from '../api.js'
import { ChipArrayInput } from './ChipArrayInput.js'
import { SectionHeader } from './SectionHeader.js'
import { SaveBar } from './SaveBar.js'
import { useAutoSave } from '../hooks/useAutoSave.js'

interface Archetype { name: string; level: string; fit: string }
interface ProofPoint { name: string; url: string; hero_metric: string }
interface ArchetypeKeywords { [slug: string]: string[] }

interface Candidate {
  full_name: string; email: string; phone: string; location: string; linkedin: string; portfolio_url: string; github: string
  gender: string; pronouns: string; race_ethnicity: string; veteran_status: string; disability_status: string
  work_authorization: string; requires_sponsorship: string
  current_company: string; years_of_experience: string; how_did_you_hear: string
}

interface VariantNarrative {
  headline: string
  exit_story: string
  superpowers: string[]
  proof_points: ProofPoint[]
}

type ProfileVariantKey = 'healthcare' | 'generic'

interface Profile {
  candidate: Candidate
  target_roles: { primary: string[]; archetypes: Archetype[] }
  narrative: {
    headline: string
    exit_story: string
    superpowers: string[]
    proof_points: ProofPoint[]
    variants?: Partial<Record<ProfileVariantKey, VariantNarrative>>
  }
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

const EMPTY_VARIANT_NARRATIVE: VariantNarrative = {
  headline: '', exit_story: '', superpowers: [], proof_points: [],
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

const FIT_OPTIONS = ['primary', 'secondary', 'adjacent']

export function ProfileForm() {
  const [profile, setProfile] = useState<Profile>(EMPTY)
  const [activeVariant, setActiveVariant] = useState<ProfileVariantKey>('generic')

  const save = async () => { await api.settings.saveProfile(profile) }
  const { saving, saved, error, setBaseline } = useAutoSave(profile, save)

  useEffect(() => {
    api.settings.profile().then(v => {
      if (v) {
        const loaded = deepMerge(EMPTY, v as Partial<Profile>)
        setProfile(loaded)
        setBaseline(loaded)
      }
    }).catch(() => null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Profile>(section: K, value: Profile[K]) =>
    setProfile(p => ({ ...p, [section]: value }))

  const setCandidate = (field: keyof Profile['candidate'], value: string) =>
    set('candidate', { ...profile.candidate, [field]: value })

  // Read narrative fields from the active variant block, falling back to the
  // top-level narrative (which Step 1's loaders also use as fallback). Writes
  // always go to the variant block — top-level stays untouched so legacy
  // single-profile reads still work.
  const variantBlock: VariantNarrative = {
    ...EMPTY_VARIANT_NARRATIVE,
    ...{
      headline: profile.narrative.headline,
      exit_story: profile.narrative.exit_story,
      superpowers: profile.narrative.superpowers,
      proof_points: profile.narrative.proof_points,
    },
    ...(profile.narrative.variants?.[activeVariant] ?? {}),
  }

  const setNarrative = (field: keyof VariantNarrative, value: unknown) => {
    const currentVariants = profile.narrative.variants ?? {}
    const currentBlock = currentVariants[activeVariant] ?? variantBlock
    set('narrative', {
      ...profile.narrative,
      variants: {
        ...currentVariants,
        [activeVariant]: { ...currentBlock, [field]: value },
      },
    })
  }

  const copyFromOtherVariant = () => {
    const other: ProfileVariantKey = activeVariant === 'healthcare' ? 'generic' : 'healthcare'
    const sourceBlock = profile.narrative.variants?.[other] ?? variantBlock
    set('narrative', {
      ...profile.narrative,
      variants: {
        ...(profile.narrative.variants ?? {}),
        [activeVariant]: { ...sourceBlock },
      },
    })
  }

  const setCompensation = (field: keyof Profile['compensation'], value: string) =>
    set('compensation', { ...profile.compensation, [field]: value })

  const setLocation = (field: keyof Profile['location'], value: string) =>
    set('location', { ...profile.location, [field]: value })

  return (
    <Stack spacing={4} sx={{ maxWidth: 780 }}>

      {/* ── Candidate ── */}
      <Stack spacing={2}>
        <SectionHeader title="Personal Info" description="Contact info used to fill application forms. Name, email, phone, and links come from your CV." />
        <TextField label="LinkedIn" value={profile.candidate.linkedin} onChange={e => setCandidate('linkedin', e.target.value)} size="small" fullWidth placeholder="linkedin.com/in/..." />
        <TextField label="Portfolio / Website" value={profile.candidate.portfolio_url} onChange={e => setCandidate('portfolio_url', e.target.value)} size="small" fullWidth />
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
        <TextField label="GitHub" value={profile.candidate.github} onChange={e => setCandidate('github', e.target.value)} size="small" fullWidth placeholder="github.com/..." />

        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>Demographics (optional, used for self-ID screens)</Typography>
        <Stack direction="row" spacing={2}>
          <TextField label="Gender" value={profile.candidate.gender} onChange={e => setCandidate('gender', e.target.value)} size="small" fullWidth placeholder="e.g. Male / Female / Non-binary" />
          <FreeDropdown
            label="Pronouns"
            value={profile.candidate.pronouns}
            onChange={v => setCandidate('pronouns', v)}
            options={['he/him', 'she/her', 'they/them', 'he/they', 'she/they', 'Decline to self-identify']}
          />
        </Stack>
        <FreeDropdown
          label="Race / Ethnicity"
          value={profile.candidate.race_ethnicity}
          onChange={v => setCandidate('race_ethnicity', v)}
          options={[
            'White', 'Hispanic or Latino', 'Black or African American',
            'Asian', 'Native Hawaiian or Pacific Islander',
            'American Indian or Alaska Native', 'Two or more races',
            'Decline to self-identify',
          ]}
        />
        <Stack direction="row" spacing={2}>
          <FreeDropdown
            label="Veteran status"
            value={profile.candidate.veteran_status}
            onChange={v => setCandidate('veteran_status', v)}
            options={[
              'I am not a protected veteran',
              'I am a protected veteran',
              'Decline to self-identify',
            ]}
          />
          <FreeDropdown
            label="Disability status"
            value={profile.candidate.disability_status}
            onChange={v => setCandidate('disability_status', v)}
            options={[
              'No, I do not have a disability',
              'Yes, I have a disability',
              'Decline to self-identify',
            ]}
          />
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

      {/* ── Narrative (per-variant) ── */}
      <Stack spacing={2}>
        <SectionHeader
          title="Narrative"
          description="Used in evaluation prompts. Two variants — pick the tab to edit one. Other fields (candidate, compensation, location) are shared across variants."
        />
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          justifyContent="space-between"
          sx={{ flexWrap: 'wrap' }}
        >
          <ToggleButtonGroup
            value={activeVariant}
            exclusive
            size="small"
            onChange={(_, v) => v && setActiveVariant(v as ProfileVariantKey)}
          >
            <ToggleButton value="generic">Generic</ToggleButton>
            <ToggleButton value="healthcare">Healthcare</ToggleButton>
          </ToggleButtonGroup>
          <Button size="small" variant="text" onClick={copyFromOtherVariant}>
            Copy from {activeVariant === 'healthcare' ? 'Generic' : 'Healthcare'}
          </Button>
        </Stack>
        <TextField label="Headline" value={variantBlock.headline} onChange={e => setNarrative('headline', e.target.value)} fullWidth size="small" placeholder="ML Engineer turned AI product builder" />
        <TextField label="Exit story / unique angle" value={variantBlock.exit_story} onChange={e => setNarrative('exit_story', e.target.value)} fullWidth size="small" multiline minRows={2} />
        <ChipArrayInput label="Superpowers" values={variantBlock.superpowers} onChange={v => setNarrative('superpowers', v)} placeholder="e.g. Fast prototyping" />

        <Typography variant="caption" color="text.secondary">Proof points</Typography>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 480 }}>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>URL</TableCell>
                <TableCell>Hero metric</TableCell>
                <TableCell width={40} />
              </TableRow>
            </TableHead>
            <TableBody>
              {variantBlock.proof_points.map((p, i) => (
                <TableRow key={i}>
                  <TableCell><TextField variant="standard" value={p.name} size="small" onChange={e => setNarrative('proof_points', variantBlock.proof_points.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /></TableCell>
                  <TableCell><TextField variant="standard" value={p.url} size="small" fullWidth onChange={e => setNarrative('proof_points', variantBlock.proof_points.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} /></TableCell>
                  <TableCell><TextField variant="standard" value={p.hero_metric} size="small" onChange={e => setNarrative('proof_points', variantBlock.proof_points.map((x, j) => j === i ? { ...x, hero_metric: e.target.value } : x))} /></TableCell>
                  <TableCell><IconButton size="small" onClick={() => setNarrative('proof_points', variantBlock.proof_points.filter((_, j) => j !== i))}><Delete fontSize="small" /></IconButton></TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={4}>
                  <Button size="small" startIcon={<Add />} onClick={() => setNarrative('proof_points', [...variantBlock.proof_points, { name: '', url: '', hero_metric: '' }])}>Add proof point</Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Box>
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

      <SaveBar saving={saving} saved={saved} error={error} />
    </Stack>
  )
}

function FreeDropdown({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]
}) {
  return (
    <Autocomplete
      freeSolo
      size="small"
      fullWidth
      options={options}
      value={value}
      onInputChange={(_, v) => onChange(v)}
      renderInput={params => <TextField {...params} label={label} />}
    />
  )
}

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
