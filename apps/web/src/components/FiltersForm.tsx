import { useState, useEffect } from 'react'
import { Stack } from '@mui/material'
import { api } from '../api.js'
import { ChipArrayInput } from './ChipArrayInput.js'
import { SectionHeader } from './SectionHeader.js'
import { SaveBar } from './SaveBar.js'

interface TitleFilter { positive: string[]; negative: string[] }
interface FiltersFile {
  portals?: unknown[]
  job_boards?: unknown[]
  title_filter?: TitleFilter
  location_blocklist?: string[]
}

export function FiltersForm() {
  const [titleFilter, setTitleFilter] = useState<TitleFilter>({ positive: [], negative: [] })
  const [locationBlocklist, setLocationBlocklist] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.settings.filters().then(v => {
      if (!v) return
      const f = v as FiltersFile
      setTitleFilter(f.title_filter ?? { positive: [], negative: [] })
      setLocationBlocklist(f.location_blocklist ?? [])
    }).catch(() => null)
  }, [])

  const save = async () => {
    setSaving(true); setError(null)
    try {
      const current = (await api.settings.filters()) as FiltersFile ?? {}
      await api.settings.saveFilters({ ...current, title_filter: titleFilter, location_blocklist: locationBlocklist })
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  return (
    <Stack spacing={4} sx={{ maxWidth: 680 }}>
      <Stack spacing={2}>
        <SectionHeader
          title="Title Filter"
          description="Applied before any API call — zero tokens. Jobs must match at least one positive keyword and none of the negative ones. Also used as Indeed RSS search terms."
        />
        <ChipArrayInput
          label="Must include (at least one)"
          values={titleFilter.positive}
          onChange={v => setTitleFilter(t => ({ ...t, positive: v }))}
          placeholder="e.g. AI Engineer"
          color="success"
        />
        <ChipArrayInput
          label="Exclude if title contains"
          values={titleFilter.negative}
          onChange={v => setTitleFilter(t => ({ ...t, negative: v }))}
          placeholder="e.g. Junior"
          color="error"
        />
      </Stack>

      <Stack spacing={2}>
        <SectionHeader
          title="Location Blocklist"
          description="If a job's location field contains any of these keywords, it is skipped — regardless of other location rules."
        />
        <ChipArrayInput
          label="Skip if location contains"
          values={locationBlocklist}
          onChange={setLocationBlocklist}
          placeholder="e.g. Brazil, India, LATAM"
          color="warning"
        />
      </Stack>

      <SaveBar onSave={save} saving={saving} saved={saved} error={error} />
    </Stack>
  )
}
