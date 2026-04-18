import { useState, useEffect, useRef } from 'react'
import {
  Stack, Select, MenuItem, Switch,
  IconButton, Button, Typography, Box, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions,
  CircularProgress, Alert,
} from '@mui/material'
import { Add, Delete, OpenInNew, TravelExplore } from '@mui/icons-material'
import {
  DataGrid, type GridColDef, type GridRenderEditCellParams, useGridApiContext,
  type GridRowSelectionModel,
} from '@mui/x-data-grid'
import { api, type DiscoveredPortal } from '../api.js'
import { SaveBar } from './SaveBar.js'

type AtsType = 'greenhouse' | 'ashby' | 'lever' | 'workday' | 'custom'

interface Portal {
  name: string
  type: AtsType
  company_id: string
  url: string
  notes: string
  enabled: boolean
}

interface FiltersFile {
  portals?: Portal[]
  job_boards?: unknown[]
  title_filter?: unknown
}

type PortalRow = Portal & { id: number }

const EMPTY: Portal = { name: '', type: 'greenhouse', company_id: '', url: '', notes: '', enabled: true }
const ATS_TYPES: AtsType[] = ['greenhouse', 'ashby', 'lever', 'workday', 'custom']

const ATS_COLORS: Record<AtsType, 'primary' | 'secondary' | 'success' | 'warning' | 'default'> = {
  greenhouse: 'success',
  ashby: 'primary',
  lever: 'secondary',
  workday: 'warning',
  custom: 'default',
}

function AtsEditCell({ id, value, field }: GridRenderEditCellParams) {
  const apiRef = useGridApiContext()
  return (
    <Select
      value={value}
      size="small"
      variant="standard"
      fullWidth
      autoFocus
      onChange={async (e) => {
        await apiRef.current.setEditCellValue({ id, field, value: e.target.value })
        apiRef.current.stopCellEditMode({ id, field })
      }}
      sx={{ px: 1 }}
    >
      {ATS_TYPES.map(t => (
        <MenuItem key={t} value={t}>
          <Chip label={t} size="small" color={ATS_COLORS[t]} variant="outlined" sx={{ fontSize: '0.7rem' }} />
        </MenuItem>
      ))}
    </Select>
  )
}

export function PortalsForm() {
  const [rows, setRows] = useState<PortalRow[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const idRef = useRef(0)
  const [discoverOpen, setDiscoverOpen] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [discovered, setDiscovered] = useState<(DiscoveredPortal & { _new: boolean })[]>([])
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [selection, setSelection] = useState<GridRowSelectionModel>([])

  useEffect(() => {
    api.settings.filters().then(v => {
      if (!v) return
      const f = v as FiltersFile
      setRows((f.portals ?? []).map(p => ({ ...p, id: idRef.current++ })))
    }).catch(() => null)
  }, [])

  const save = async () => {
    setSaving(true); setError(null)
    try {
      const portals = rows.map(({ id: _id, ...p }) => p)
      const current = (await api.settings.filters()) as FiltersFile ?? {}
      await api.settings.saveFilters({ ...current, portals })
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  const processRowUpdate = (newRow: PortalRow) => {
    setRows(rs => rs.map(r => r.id === newRow.id ? newRow : r))
    return newRow
  }

  const toggleEnabled = (id: number, enabled: boolean) =>
    setRows(rs => rs.map(r => r.id === id ? { ...r, enabled } : r))

  const add = () => setRows(rs => [...rs, { ...EMPTY, id: idRef.current++ }])
  const remove = (id: number) => setRows(rs => rs.filter(r => r.id !== id))

  const openDiscover = async () => {
    setDiscoverOpen(true)
    setDiscovering(true)
    setDiscoverError(null)
    setDiscovered([])
    try {
      const res = await api.portals.discover()
      const existing = new Set(rows.map(r => r.company_id))
      const withNew = res.portals.map(p => ({ ...p, _new: !existing.has(p.company_id) }))
      setDiscovered(withNew)
      setSelection(withNew.filter(p => p._new).map(p => p.company_id))
    } catch (e) {
      setDiscoverError(String(e))
    } finally {
      setDiscovering(false)
    }
  }

  const importSelected = () => {
    const sel = new Set(selection as string[])
    const existing = new Set(rows.map(r => r.company_id))
    const toAdd = discovered
      .filter(p => sel.has(p.company_id) && !existing.has(p.company_id))
      .map(p => ({ name: p.name, type: p.type as AtsType, company_id: p.company_id, url: p.url, notes: p.notes, enabled: true, id: idRef.current++ }))
    setRows(rs => [...rs, ...toAdd])
    setDiscoverOpen(false)
  }

  const enabledCount = rows.filter(r => r.enabled).length
  const byType = ATS_TYPES.reduce(
    (acc, t) => ({ ...acc, [t]: rows.filter(r => r.type === t && r.enabled).length }),
    {} as Record<AtsType, number>,
  )

  const columns: GridColDef<PortalRow>[] = [
    {
      field: 'enabled',
      headerName: 'On',
      width: 60,
      sortable: true,
      renderCell: ({ row }) => (
        <Switch size="small" checked={row.enabled} onChange={e => toggleEnabled(row.id, e.target.checked)} />
      ),
    },
    { field: 'name', headerName: 'Company', flex: 1, minWidth: 140, editable: true },
    {
      field: 'type',
      headerName: 'ATS',
      width: 120,
      editable: true,
      renderCell: ({ value }) => (
        <Chip label={value} size="small" color={ATS_COLORS[value as AtsType]} variant="filled"
          sx={{ fontSize: '0.68rem', height: 20 }} />
      ),
      renderEditCell: (params) => <AtsEditCell {...params} />,
    },
    { field: 'company_id', headerName: 'Slug / ID', width: 150, editable: true },
    {
      field: 'url',
      headerName: 'Careers URL',
      flex: 2,
      minWidth: 200,
      editable: true,
      renderCell: ({ value }) => (
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ width: '100%', overflow: 'hidden' }}>
          <Typography variant="caption" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
            {value}
          </Typography>
          {value && (
            <IconButton
              size="small"
              component="a"
              href={value}
              target="_blank"
              rel="noopener"
              onClick={e => e.stopPropagation()}
              sx={{ flexShrink: 0, p: 0.25 }}
            >
              <OpenInNew sx={{ fontSize: 13 }} />
            </IconButton>
          )}
        </Stack>
      ),
    },
    {
      field: 'notes',
      headerName: 'Notes',
      flex: 1,
      minWidth: 160,
      editable: true,
      renderCell: ({ value }) => (
        <Typography variant="caption" color="text.secondary"
          sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {value}
        </Typography>
      ),
    },
    {
      field: '_actions',
      headerName: '',
      width: 44,
      sortable: false,
      disableColumnMenu: true,
      renderCell: ({ row }) => (
        <IconButton size="small" onClick={() => remove(row.id)}
          sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}>
          <Delete fontSize="small" />
        </IconButton>
      ),
    },
  ]

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
        <Typography variant="body2" color="text.secondary">
          {enabledCount} of {rows.length} enabled
        </Typography>
        {ATS_TYPES.filter(t => byType[t] > 0).map(t => (
          <Chip key={t} label={`${byType[t]} ${t}`} size="small" color={ATS_COLORS[t]}
            variant="outlined" sx={{ fontSize: '0.7rem' }} />
        ))}
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" startIcon={<TravelExplore />} onClick={openDiscover}>
          Scan for portals
        </Button>
      </Stack>

      <Box sx={{ height: 500 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          processRowUpdate={processRowUpdate}
          onProcessRowUpdateError={() => {}}
          density="compact"
          disableRowSelectionOnClick
          getRowClassName={({ row }) => row.enabled ? '' : 'row-disabled'}
          initialState={{ sorting: { sortModel: [{ field: 'name', sort: 'asc' }] } }}
          pageSizeOptions={[25, 50, 100]}
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            '& .MuiDataGrid-columnHeaders': { bgcolor: 'background.default' },
            '& .MuiDataGrid-cell': { borderColor: 'divider' },
            '& .row-disabled': { opacity: 0.4 },
            '& .MuiDataGrid-cell--editable:hover': { bgcolor: 'action.hover', cursor: 'text' },
          }}
          slots={{
            footer: () => (
              <Box sx={{ px: 1, py: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
                <Button size="small" startIcon={<Add />} onClick={add}>Add portal</Button>
              </Box>
            ),
          }}
        />
      </Box>

      <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, px: 1.5, py: 1 }}>
        <Typography variant="caption" color="text.secondary" component="div">
          <strong>Finding slugs:</strong>&nbsp;
          Greenhouse → <code>boards-api.greenhouse.io/v1/boards/<strong>slug</strong>/jobs</code>&nbsp;·&nbsp;
          Ashby → <code>api.ashbyhq.com/posting-api/job-board/<strong>slug</strong></code>&nbsp;·&nbsp;
          Lever → <code>api.lever.co/v0/postings/<strong>slug</strong></code>
        </Typography>
      </Box>

      <SaveBar onSave={save} saving={saving} saved={saved} error={error} />

      <Dialog open={discoverOpen} onClose={() => setDiscoverOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Scan for portals</DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {discovering && (
            <Stack alignItems="center" justifyContent="center" sx={{ py: 6 }} spacing={2}>
              <CircularProgress size={32} />
              <Typography variant="body2" color="text.secondary">
                Scanning Greenhouse, Ashby and Lever boards…
              </Typography>
            </Stack>
          )}
          {discoverError && (
            <Box sx={{ p: 2 }}>
              <Alert severity="error">{discoverError}</Alert>
            </Box>
          )}
          {!discovering && discovered.length > 0 && (
            <Box sx={{ height: 480 }}>
              <DataGrid
                rows={discovered.map(p => ({ ...p, id: p.company_id }))}
                checkboxSelection
                rowSelectionModel={selection}
                onRowSelectionModelChange={setSelection}
                isRowSelectable={({ row }) => !!(row as { _new?: boolean })._new}
                density="compact"
                disableRowSelectionOnClick={false}
                columns={[
                  { field: 'name', headerName: 'Company', flex: 1, minWidth: 160 },
                  {
                    field: 'type',
                    headerName: 'ATS',
                    width: 110,
                    renderCell: ({ value }) => (
                      <Chip label={value} size="small"
                        color={ATS_COLORS[value as AtsType] ?? 'default'}
                        variant="filled" sx={{ fontSize: '0.68rem', height: 20 }} />
                    ),
                  },
                  { field: 'company_id', headerName: 'Slug', width: 150 },
                  { field: 'source', headerName: 'Source', width: 160 },
                  {
                    field: '_new',
                    headerName: 'Status',
                    width: 110,
                    renderCell: ({ value }) => (
                      <Chip
                        label={value ? 'New' : 'Already added'}
                        size="small"
                        color={value ? 'success' : 'default'}
                        variant={value ? 'filled' : 'outlined'}
                        sx={{ fontSize: '0.68rem', height: 20 }}
                      />
                    ),
                  },
                ] as GridColDef[]}
                sx={{
                  border: 'none',
                  '& .MuiDataGrid-columnHeaders': { bgcolor: 'background.default' },
                  '& .MuiDataGrid-row.Mui-disabled': { opacity: 0.4 },
                }}
                initialState={{ sorting: { sortModel: [{ field: '_new', sort: 'desc' }] } }}
                pageSizeOptions={[25, 50, 100]}
              />
            </Box>
          )}
          {!discovering && discovered.length === 0 && !discoverError && (
            <Box sx={{ p: 3 }}>
              <Typography variant="body2" color="text.secondary">No new portals found.</Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, borderTop: '1px solid', borderColor: 'divider' }}>
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            {(selection as string[]).length} selected · {discovered.filter(p => p._new).length} new portals found
          </Typography>
          <Button onClick={() => setDiscoverOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={discovering || (selection as string[]).length === 0}
            onClick={importSelected}
          >
            Import {(selection as string[]).length > 0 ? `${(selection as string[]).length} portals` : ''}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
