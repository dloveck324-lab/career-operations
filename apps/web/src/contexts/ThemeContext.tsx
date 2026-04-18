import { createContext, useContext, useState, useMemo, useEffect, type ReactNode } from 'react'
import { ThemeProvider, CssBaseline, useMediaQuery } from '@mui/material'
import { createAppTheme } from '../theme.js'

export type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeContextValue {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue>({ mode: 'dark', setMode: () => {} })

export function useThemeMode() {
  return useContext(ThemeContext)
}

const STORAGE_KEY = 'job-pipeline:theme-mode'

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    return (localStorage.getItem(STORAGE_KEY) as ThemeMode) ?? 'dark'
  })

  const prefersLight = useMediaQuery('(prefers-color-scheme: light)')

  const resolvedMode: 'light' | 'dark' = mode === 'system'
    ? (prefersLight ? 'light' : 'dark')
    : mode

  const theme = useMemo(() => createAppTheme(resolvedMode), [resolvedMode])

  const setMode = (next: ThemeMode) => {
    setModeState(next)
    localStorage.setItem(STORAGE_KEY, next)
  }

  return (
    <ThemeContext.Provider value={{ mode, setMode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeContext.Provider>
  )
}
