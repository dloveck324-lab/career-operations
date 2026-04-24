import { useState, useCallback, useEffect } from 'react'
import type { GridSortModel, GridColumnVisibilityModel } from '@mui/x-data-grid'

export function useGridState(
  storageKey: string,
  defaults: {
    sortModel?: GridSortModel
    columnVisibilityModel?: GridColumnVisibilityModel
  } = {},
): {
  sortModel: GridSortModel
  onSortModelChange: (m: GridSortModel) => void
  columnVisibilityModel: GridColumnVisibilityModel
  onColumnVisibilityModelChange: (m: GridColumnVisibilityModel) => void
} {
  const defaultSort = defaults.sortModel ?? []
  const defaultVis = defaults.columnVisibilityModel ?? {}

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

  useEffect(() => {
    try {
      const s = localStorage.getItem(`grid:${storageKey}:sort`)
      setSortModel(s ? (JSON.parse(s) as GridSortModel) : defaultSort)
      const v = localStorage.getItem(`grid:${storageKey}:vis`)
      setColVis(v ? (JSON.parse(v) as GridColumnVisibilityModel) : defaultVis)
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

  return { sortModel, onSortModelChange, columnVisibilityModel, onColumnVisibilityModelChange }
}
