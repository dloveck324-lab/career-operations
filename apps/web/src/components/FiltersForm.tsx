import { useState, useEffect } from 'react'
import { Stack, Switch, FormControlLabel, Typography } from '@mui/material'
import { api } from '../api.js'
import { ChipArrayInput } from './ChipArrayInput.js'
import { SectionHeader } from './SectionHeader.js'
import { SaveBar } from './SaveBar.js'

interface TitleFilter { positive: string[]; negative: string[] }
interface JobBoard { type: string; queries: string[]; enabled: boolean }
interface FiltersFile {
  portals?: unknown[]
  job_boards?: JobBoard[]
  title_filter?: TitleFilter
}

export function FiltersForm() {
  const [titleFilter, setTitleFilter] = useState<TitleFilter>({ positive: [], negative: [] })
  const [jobBoards, setJobBoards] = useState<JobBoard[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.settings.filters().then(v => {
      if (!v) return
      const f = v as FiltersFile
      setTitleFilter(f.title_filter ?? { positive: [], negative: [] })
      setJobBoards(f.job_boards ?? [])
    }).catch(() => null)
  }, [])

  const save = async () => {
    setSaving(true); setError(null)
    try {
      const current = (await api.settings.filters()) as FiltersFile ?? {}
      await api.settings.saveFilters({ ...current, job_boards: jobBoards, title_filter: titleFilter })
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  const rssBoard = jobBoards.find(b => b.type === 'indeed_rss') ?? { type: 'indeed_rss', queries: [], enabled: true }

  const updateRss = (patch: Partial<typeof rssBoard>) => {
    const updated = { ...rssBoard, ...patch }
    const exists = jobBoards.some(b => b.type === 'indeed_rss')
    setJobBoards(exists
      ? jobBoards.map(b => b.type === 'indeed_rss' ? updated : b)
      : [...jobBoards, updated]
    )
  }

  return (
    <Stack spacing={4} sx={{ maxWidth: 680 }}>

      <Stack spacing={2}>
        <SectionHeader
          title="Title Filter"
          description="Applied before any API call — zero tokens. Jobs must match at least one positive keyword and none of the negative ones."
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
        <SectionHeader title="Job Boards" description="Indeed RSS — ~30% coverage, no authentication needed." />
        <FormControlLabel
          control={
            <Switch size="small" checked={rssBoard.enabled} onChange={e => updateRss({ enabled: e.target.checked })} />
          }
          label={<Typography variant="body2">Indeed RSS</Typography>}
        />
        <ChipArrayInput
          label="Search queries"
          values={rssBoard.queries}
          onChange={queries => updateRss({ queries })}
          placeholder="e.g. senior AI engineer remote"
        />
      </Stack>

      <SaveBar onSave={save} saving={saving} saved={saved} error={error} />
    </Stack>
  )
}
