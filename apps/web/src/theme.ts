import { createTheme } from '@mui/material/styles'

export function createAppTheme(mode: 'light' | 'dark') {
  return createTheme({
    palette: {
      mode,
      primary: { main: '#6366f1' },
      secondary: { main: '#22d3ee' },
      success: { main: '#22c55e' },
      warning: { main: '#f59e0b' },
      error: { main: '#ef4444' },
      ...(mode === 'dark'
        ? { background: { default: '#0f0f13', paper: '#18181f' } }
        : { background: { default: '#f1f2f6', paper: '#ffffff' } }),
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: '"Inter", "Roboto", system-ui, sans-serif',
      h6: { fontWeight: 600 },
      subtitle2: { fontWeight: 500 },
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 500, fontSize: '0.72rem' },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 500, minHeight: 44 },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 600 },
        },
      },
    },
  })
}

export const theme = createAppTheme('dark')
