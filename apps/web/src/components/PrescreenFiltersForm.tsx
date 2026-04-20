import { useState, useEffect } from 'react'
import {
  Stack, TextField, MenuItem, Select, FormControl, InputLabel,
  IconButton, Button, Box, Typography, FormControlLabel, Switch,
  Table, TableBody, TableCell, TableHead, TableRow,
} from '@mui/material'
import { Add, Delete } from '@mui/icons-material'
import { api } from '../api.js'
import { ChipArrayInput } from './ChipArrayInput.js'
import { SectionHeader } from './SectionHeader.js'
import { SaveBar } from './SaveBar.js'

interface LocationPolicy {
  allow_onsite_cities: string[]
  allowed_countries: string[]
  require_remote_if_elsewhere: boolean
  require_us_or_remote: boolean
  worldwide_remote_ok?: boolean
}

interface Prescreen {
  seniority_min: string
  comp_floor: number
  location_policy: LocationPolicy
  blocklist_titles: string[]
  archetype_keywords: Record<string, string[]>
}

interface Profile { prescreen: Prescreen; [k: string]: unknown }

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
  blocklist_titles: ['intern', 'internship', 'junior', 'entry-level'],
  archetype_keywords: {},
}

const SENIORITY_OPTIONS = ['', 'Junior', 'Mid', 'Senior', 'Staff', 'Principal', 'Director', 'Head', 'VP']

export function PrescreenFiltersForm() {
  const [prescreen, setPrescreen] = useState<Prescreen>(EMPTY_PRESCREEN)
  const [fullProfile, setFullProfile] = useState<Profile | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newArchSlug, setNewArchSlug] = useState('')

  useEffect(() => {
    api.settings.profile().then(v => {
      if (!v) return
      const p = v as Profile
      setFullProfile(p)
      const ps = p.prescreen as Partial<Prescreen> | undefined
      if (ps) {
        setPrescreen({
          seniority_min: ps.seniority_min ?? EMPTY_PRESCREEN.seniority_min,
          comp_floor: ps.comp_floor ?? 0,
          location_policy: {
            allow_onsite_cities: ps.location_policy?.allow_onsite_cities ?? [],
            allowed_countries: ps.location_policy?.allowed_countries ?? [],
            require_remote_if_elsewhere: ps.location_policy?.require_remote_if_elsewhere ?? true,
            require_us_or_remote: ps.location_policy?.require_us_or_remote ?? true,
            worldwide_remote_ok: ps.location_policy?.worldwide_remote_ok !== false,
          },
          blocklist_titles: ps.blocklist_titles ?? EMPTY_PRESCREEN.blocklist_titles,
          archetype_keywords: ps.archetype_keywords ?? {},
        })
      }
    }).catch(() => null)
  }, [])

  const set = (field: keyof Prescreen, value: unknown) =>
    setPrescreen(p => ({ ...p, [field]: value }))

  const save = async () => {
    setSaving(true); setError(null)
    try {
      const base = fullProfile ?? {}
      await api.settings.saveProfile({ ...base, prescreen })
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  const addArchetypeSlug = () => {
    const slug = newArchSlug.trim().toLowerCase().replace(/\s+/g, '_')
    if (!slug || prescreen.archetype_keywords[slug] !== undefined) return
    set('archetype_keywords', { ...prescreen.archetype_keywords, [slug]: [] })
    setNewArchSlug('')
  }
  const removeArchetypeSlug = (slug: string) => {
    const kw = { ...prescreen.archetype_keywords }
    delete kw[slug]
    set('archetype_keywords', kw)
  }

  return (
    <Stack spacing={4} sx={{ maxWidth: 680 }}>
      <Stack spacing={3}>
        <SectionHeader title="Pre-scan Filters" description="Applied locally before any LLM call — zero token cost." />

        <Stack direction="row" spacing={2} alignItems="flex-start">
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Minimum seniority</InputLabel>
            <Select label="Minimum seniority" value={prescreen.seniority_min ?? ''} onChange={e => set('seniority_min', e.target.value)}>
              {SENIORITY_OPTIONS.map(o => <MenuItem key={o} value={o}>{o || '(none)'}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label="Min compensation (0 = off)" type="number" size="small"
            value={prescreen.comp_floor ?? 0}
            onChange={e => set('comp_floor', Number(e.target.value))}
            InputProps={{ inputProps: { min: 0, step: 1000 } }}
            sx={{ width: 220 }}
          />
        </Stack>

        <ChipArrayInput
          label="Blocklist titles"
          values={prescreen.blocklist_titles}
          onChange={v => set('blocklist_titles', v)}
          placeholder="e.g. intern"
          color="error"
        />

        <ChipArrayInput
          label="Allowed on-site cities (empty = any)"
          values={prescreen.location_policy?.allow_onsite_cities ?? []}
          onChange={v => set('location_policy', { ...prescreen.location_policy, allow_onsite_cities: v })}
          placeholder="e.g. San Francisco"
        />
        <ChipArrayInput
          label="Allowed countries for remote jobs (beyond US)"
          values={prescreen.location_policy?.allowed_countries ?? []}
          onChange={v => set('location_policy', { ...prescreen.location_policy, allowed_countries: v })}
          placeholder="e.g. Canada"
        />

        <Stack spacing={0.5}>
          <FormControlLabel
            control={
              <Switch
                checked={prescreen.location_policy?.require_us_or_remote ?? true}
                onChange={e => set('location_policy', { ...prescreen.location_policy, require_us_or_remote: e.target.checked })}
                size="small"
              />
            }
            label={
              <Box>
                <Typography variant="body2">Only US or allowed-country remote</Typography>
                <Typography variant="caption" color="text.secondary">
                  Rejects non-US locations unless the country is listed above. "Remote – Canada" passes if Canada is in the list.
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            control={
              <Switch
                checked={prescreen.location_policy?.worldwide_remote_ok !== false}
                onChange={e => set('location_policy', { ...prescreen.location_policy, worldwide_remote_ok: e.target.checked })}
                size="small"
              />
            }
            label={
              <Box>
                <Typography variant="body2">Accept worldwide remote ("Anywhere", "Global")</Typography>
                <Typography variant="caption" color="text.secondary">
                  When on, roles listed as "Anywhere" or "Worldwide" pass. Turn off to restrict to US and allowed countries only.
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            control={
              <Switch
                checked={prescreen.location_policy?.require_remote_if_elsewhere ?? true}
                onChange={e => set('location_policy', { ...prescreen.location_policy, require_remote_if_elsewhere: e.target.checked })}
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
            {Object.entries(prescreen.archetype_keywords).map(([slug, kws]) => (
              <Stack key={slug} direction="row" spacing={1} alignItems="flex-start">
                <Box sx={{ minWidth: 130, pt: 0.5 }}>
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>{slug}</Typography>
                    <IconButton size="small" onClick={() => removeArchetypeSlug(slug)}><Delete sx={{ fontSize: 14 }} /></IconButton>
                  </Stack>
                </Box>
                <Box sx={{ flex: 1 }}>
                  <ChipArrayInput label="" values={kws} onChange={v => set('archetype_keywords', { ...prescreen.archetype_keywords, [slug]: v })} placeholder="Add keyword" />
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
