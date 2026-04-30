import { useState, useEffect } from 'react'
import {
  Stack, TextField, MenuItem, Select, FormControl, InputLabel,
  IconButton, Button, Box, Typography, FormControlLabel, Switch, Divider,
} from '@mui/material'
import { Add, Delete } from '@mui/icons-material'
import { api } from '../api.js'
import { ChipArrayInput } from './ChipArrayInput.js'
import { SectionHeader } from './SectionHeader.js'
import { SaveBar } from './SaveBar.js'
import { useAutoSave } from '../hooks/useAutoSave.js'

interface TitleFilter { positive: string[]; negative: string[] }

interface LocationPolicy {
  allow_onsite_cities: string[]
  allowed_countries: string[]
  require_remote_if_elsewhere: boolean
  require_us_or_remote: boolean
  worldwide_remote_ok: boolean
}

interface Prescreen {
  seniority_min: string
  comp_floor: number
  location_policy: LocationPolicy
  blocklist_titles: string[]
  archetype_keywords: Record<string, string[]>
}

interface Profile { prescreen: Prescreen; [k: string]: unknown }

interface FiltersFile {
  portals?: unknown[]
  job_boards?: unknown[]
  title_filter?: TitleFilter
  location_blocklist?: string[]
}

const EMPTY_PRESCREEN: Prescreen = {
  seniority_min: 'Senior',
  comp_floor: 0,
  location_policy: {
    allow_onsite_cities: [],
    allowed_countries: [],
    require_remote_if_elsewhere: true,
    require_us_or_remote: true,
    worldwide_remote_ok: true,
  },
  blocklist_titles: [],
  archetype_keywords: {},
}

const SENIORITY_OPTIONS = ['', 'Junior', 'Mid', 'Senior', 'Staff', 'Principal', 'Director', 'Head', 'VP']

export function ScanFiltersForm() {
  const [titlePositive, setTitlePositive] = useState<string[]>([])
  const [titleNegative, setTitleNegative] = useState<string[]>([])
  const [locationBlocklist, setLocationBlocklist] = useState<string[]>([])
  const [filtersRaw, setFiltersRaw] = useState<FiltersFile>({})

  const [prescreen, setPrescreen] = useState<Prescreen>(EMPTY_PRESCREEN)

  const [newArchSlug, setNewArchSlug] = useState('')

  const formData = { titlePositive, titleNegative, locationBlocklist, prescreen }

  const save = async () => {
    await Promise.all([
      api.settings.saveFilters({
        ...filtersRaw,
        title_filter: { positive: titlePositive, negative: titleNegative },
        location_blocklist: locationBlocklist,
      }),
      // Send ONLY the section this form owns. Backend shallow-merges so other
      // top-level keys (candidate, narrative, compensation, location) are
      // preserved — prevents cross-tab clobbering when user edits Profile +
      // Scan tabs in the same session.
      api.settings.saveProfile({
        prescreen: { ...prescreen, blocklist_titles: [] },
      }),
    ])
  }

  const { saving, saved, error, setBaseline } = useAutoSave(formData, save)

  useEffect(() => {
    Promise.all([
      api.settings.filters().catch(() => null),
      api.settings.profile().catch(() => null),
    ]).then(([filtersData, profileData]) => {
      const f = (filtersData ?? {}) as FiltersFile
      const profileBlocklist = (profileData as Profile | null)?.prescreen?.blocklist_titles ?? []
      const tp = f.title_filter?.positive ?? []
      const tn = [...new Set([...(f.title_filter?.negative ?? []), ...profileBlocklist])]
      const lb = f.location_blocklist ?? []

      setFiltersRaw(f)
      setTitlePositive(tp)
      setTitleNegative(tn)
      setLocationBlocklist(lb)

      let ps = EMPTY_PRESCREEN
      if (profileData) {
        const p = profileData as Profile
        const raw = p.prescreen as Partial<Prescreen> | undefined
        ps = {
          seniority_min: raw?.seniority_min ?? EMPTY_PRESCREEN.seniority_min,
          comp_floor: raw?.comp_floor ?? 0,
          location_policy: {
            allow_onsite_cities: raw?.location_policy?.allow_onsite_cities ?? [],
            allowed_countries: raw?.location_policy?.allowed_countries ?? [],
            require_remote_if_elsewhere: raw?.location_policy?.require_remote_if_elsewhere ?? true,
            require_us_or_remote: raw?.location_policy?.require_us_or_remote ?? true,
            worldwide_remote_ok: raw?.location_policy?.worldwide_remote_ok !== false,
          },
          blocklist_titles: [],
          archetype_keywords: raw?.archetype_keywords ?? {},
        }
        setPrescreen(ps)
      }

      setBaseline({ titlePositive: tp, titleNegative: tn, locationBlocklist: lb, prescreen: ps })
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const setPolicy = (patch: Partial<LocationPolicy>) =>
    setPrescreen(p => ({ ...p, location_policy: { ...p.location_policy, ...patch } }))

  const addArchetypeSlug = () => {
    const slug = newArchSlug.trim().toLowerCase().replace(/\s+/g, '_')
    if (!slug || prescreen.archetype_keywords[slug] !== undefined) return
    setPrescreen(p => ({ ...p, archetype_keywords: { ...p.archetype_keywords, [slug]: [] } }))
    setNewArchSlug('')
  }
  const removeArchetypeSlug = (slug: string) => {
    const kw = { ...prescreen.archetype_keywords }
    delete kw[slug]
    setPrescreen(p => ({ ...p, archetype_keywords: kw }))
  }

  return (
    <Stack spacing={5} sx={{ maxWidth: 680 }}>

      {/* ── Title ── */}
      <Stack spacing={2}>
        <SectionHeader
          title="Title"
          description="Zero-token filter on job title. Whitelist requires at least one match; blocklist skips on any match. Whitelist keywords are also used as Indeed RSS search terms."
        />
        <ChipArrayInput
          label="Whitelist — must include at least one"
          values={titlePositive}
          onChange={setTitlePositive}
          placeholder="e.g. AI Engineer"
          color="success"
        />
        <ChipArrayInput
          label="Blocklist — skip if title contains"
          values={titleNegative}
          onChange={setTitleNegative}
          placeholder="e.g. Junior, Intern"
          color="error"
        />
      </Stack>

      <Divider />

      {/* ── Location ── */}
      <Stack spacing={2}>
        <SectionHeader
          title="Location"
          description="Rules applied to the job's location field. Keyword blocklist also matches against the job title."
        />

        <ChipArrayInput
          label="Keyword blocklist — skip if location or title contains"
          values={locationBlocklist}
          onChange={setLocationBlocklist}
          placeholder="e.g. Brazil, India, LATAM"
          color="warning"
        />

        <ChipArrayInput
          label="Allowed on-site cities (empty = any city)"
          values={prescreen.location_policy.allow_onsite_cities}
          onChange={v => setPolicy({ allow_onsite_cities: v })}
          placeholder="e.g. San Francisco"
        />
        <ChipArrayInput
          label="Allowed countries for remote jobs (beyond US)"
          values={prescreen.location_policy.allowed_countries}
          onChange={v => setPolicy({ allowed_countries: v })}
          placeholder="e.g. Canada"
        />

        <Stack spacing={1} sx={{ pl: 0.5 }}>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={prescreen.location_policy.require_us_or_remote}
                onChange={e => setPolicy({ require_us_or_remote: e.target.checked })}
              />
            }
            label={
              <Box>
                <Typography variant="body2">US-only + allowed-country remote</Typography>
                <Typography variant="caption" color="text.secondary">
                  Rejects non-US locations unless the country is in the list above.
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={prescreen.location_policy.worldwide_remote_ok}
                onChange={e => setPolicy({ worldwide_remote_ok: e.target.checked })}
              />
            }
            label={
              <Box>
                <Typography variant="body2">Accept worldwide remote ("Anywhere", "Global")</Typography>
                <Typography variant="caption" color="text.secondary">
                  Turn off to restrict to US and allowed countries only.
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={prescreen.location_policy.require_remote_if_elsewhere}
                onChange={e => setPolicy({ require_remote_if_elsewhere: e.target.checked })}
              />
            }
            label={
              <Box>
                <Typography variant="body2">Require remote outside allowed cities</Typography>
                <Typography variant="caption" color="text.secondary">
                  On-site roles in cities not listed above are skipped.
                </Typography>
              </Box>
            }
          />
        </Stack>
      </Stack>

      <Divider />

      {/* ── Seniority & Compensation ── */}
      <Stack spacing={2}>
        <SectionHeader
          title="Seniority & Compensation"
          description="Jobs below these thresholds are skipped when detectable from the title or description."
        />
        <Stack direction="row" spacing={2} alignItems="flex-start">
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Minimum seniority</InputLabel>
            <Select
              label="Minimum seniority"
              value={prescreen.seniority_min ?? ''}
              onChange={e => setPrescreen(p => ({ ...p, seniority_min: e.target.value }))}
            >
              {SENIORITY_OPTIONS.map(o => <MenuItem key={o} value={o}>{o || '(none)'}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField
            label="Min compensation (0 = off)"
            type="number"
            size="small"
            value={prescreen.comp_floor ?? 0}
            onChange={e => setPrescreen(p => ({ ...p, comp_floor: Number(e.target.value) }))}
            InputProps={{ inputProps: { min: 0, step: 1000 } }}
            sx={{ width: 220 }}
          />
        </Stack>
      </Stack>

      <Divider />

      {/* ── Archetypes ── */}
      <Stack spacing={2}>
        <SectionHeader
          title="Archetypes"
          description="Keyword map that pre-tags jobs before LLM evaluation."
        />
        <Stack spacing={2}>
          {Object.entries(prescreen.archetype_keywords).map(([slug, kws]) => (
            <Stack key={slug} direction="row" spacing={1} alignItems="flex-start">
              <Box sx={{ minWidth: 140, pt: 0.5 }}>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>{slug}</Typography>
                  <IconButton size="small" onClick={() => removeArchetypeSlug(slug)}>
                    <Delete sx={{ fontSize: 14 }} />
                  </IconButton>
                </Stack>
              </Box>
              <Box sx={{ flex: 1 }}>
                <ChipArrayInput
                  label=""
                  values={kws}
                  onChange={v => setPrescreen(p => ({ ...p, archetype_keywords: { ...p.archetype_keywords, [slug]: v } }))}
                  placeholder="Add keyword"
                />
              </Box>
            </Stack>
          ))}
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              value={newArchSlug}
              onChange={e => setNewArchSlug(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addArchetypeSlug() } }}
              placeholder="New archetype slug (e.g. llmops)"
              sx={{ width: 260 }}
            />
            <Button size="small" variant="outlined" startIcon={<Add />} onClick={addArchetypeSlug}>
              Add archetype
            </Button>
          </Stack>
        </Stack>
      </Stack>

      <SaveBar saving={saving} saved={saved} error={error} />
    </Stack>
  )
}
