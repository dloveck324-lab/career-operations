import { useState, useCallback, useEffect } from 'react'
import type { GridSortModel, GridColumnVisibilityModel, GridFilterModel } from '@mui/x-data-grid'

/**
 * Persists a DataGrid's sort + column visibility + filter model to localStorage
 * under the given key. Returns the controlled props to spread onto the grid.
 *
 * Usage:
 *   const grid = useGridState('pipeline:tab-0', {
 *     sortModel: [{ field: 'score', sort: 'desc' }],
 *   })
 *   <DataGrid {...grid} ... />
 */
export function useGridState(
  storageKey: string,
  defaults: {
    sortModel?: GridSortModel
    columnVisibilityModel?: GridColumnVisibilityModel
    filterModel?: GridFilterModel
  } = {},
): {
  sortModel: GridSortModel
  onSortModelChange: (m: GridSortModel) => void
  columnVisibilityModel: GridColumnVisibilityModel
  onColumnVisibilityModelChange: (m: GridColumnVisibilityModel) => void
  filterModel: GridFilterModel
  onFilterModelChange: (m: GridFilterModel) => void
} {
  const defaultSort = defaults.sortModel ?? []
  const defaultVis = defaults.columnVisibilityModel ?? {}
  const defaultFilter = defaults.filterModel ?? { items: [] }

  const [sortModel, setSortModel] = useState<GridSortModel>(() => {
    try {
      const raw = localStorage.getItem(`grid:${storageKey}:sort`)
      if (raw) return JSON.parse(raw) as GridSortModel
    } catch { /* ignore */ }
    return defaultSort
  })

  const [columnVisibilityModel, setColVis] = useState<GridColumnVisibilityModel>(() => {
    try {
      const raw = localStorage.getItem(`grid:${storageKey}:vis`)
      if (raw) return JSON.parse(raw) as GridColumnVisibilityModel
    } catch { /* ignore */ }
    return defaultVis
  })

  const [filterModel, setFilterModel] = useState<GridFilterModel>(() => {
    try {
      const raw = localStorage.getItem(`grid:${storageKey}:filter`)
      if (raw) return JSON.parse(raw) as GridFilterModel
    } catch { /* ignore */ }
    return defaultFilter
  })

  // Re-hydrate if the key changes (e.g. switching pipeline tabs)
  useEffect(() => {
    try {
      const s = localStorage.getItem(`grid:${storageKey}:sort`)
      setSortModel(s ? (JSON.parse(s) as GridSortModel) : defaultSort)
      const v = localStorage.getItem(`grid:${storageKey}:vis`)
      setColVis(v ? (JSON.parse(v) as GridColumnVisibilityModel) : defaultVis)
      const f = localStorage.getItem(`grid:${storageKey}:filter`)
      setFilterModel(f ? (JSON.parse(f) as GridFilterModel) : defaultFilter)
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  const onSortModelChange = useCallback((m: GridSortModel) => {
    setSortModel(m)
    try { localStorage.setItem(`grid:${storageKey}:sort`, JSON.stringify(m)) } catch { /* quota */ }
  }, [storageKey])

  const onColumnVisibilityModelChange = useCallback((m: GridColumnVisibilityModel) => {
    setColVis(m)
    try { localStorage.setItem(`grid:${storageKey}:vis`, JSON.stringify(m)) } catch { /* quota */ }
  }, [storageKey])

  const onFilterModelChange = useCallback((m: GridFilterModel) => {
    setFilterModel(m)
    try { localStorage.setItem(`grid:${storageKey}:filter`, JSON.stringify(m)) } catch { /* quota */ }
  }, [storageKey])

  return {
    sortModel, onSortModelChange,
    columnVisibilityModel, onColumnVisibilityModelChange,
    filterModel, onFilterModelChange,
  }
}
