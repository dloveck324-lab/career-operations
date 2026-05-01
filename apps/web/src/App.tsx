import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Box } from '@mui/material'
import { AppShell } from './components/AppShell.js'
import { PipelinePage } from './pages/PipelinePage.js'
import { SettingsPage } from './pages/SettingsPage.js'
import { LoginPage } from './pages/LoginPage.js'
import { OnboardingPage } from './pages/OnboardingPage.js'
import { api } from './api.js'

export default function App() {
  const [checked, setChecked] = useState(false)
  const [authed, setAuthed] = useState(false)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.auth.me()
      .then(async () => {
        if (cancelled) return
        setAuthed(true)
        const dismissed = localStorage.getItem('onboardingDismissed') === '1'
        if (!dismissed) {
          try {
            const status = await api.onboardingStatus()
            if (!cancelled) setNeedsOnboarding(status.needsOnboarding)
          } catch { /* fall through to pipeline */ }
        }
      })
      .catch(() => setAuthed(false))
      .finally(() => { if (!cancelled) setChecked(true) })
    return () => { cancelled = true }
  }, [])

  if (!checked) return null

  if (!authed) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Box sx={{ display: 'flex', height: { xs: 'auto', sm: '100vh' }, minHeight: { xs: '100dvh', sm: 'unset' }, overflow: { xs: 'auto', sm: 'hidden' } }}>
      <AuthedRoutes needsOnboarding={needsOnboarding} />
    </Box>
  )
}

function AuthedRoutes({ needsOnboarding }: { needsOnboarding: boolean }) {
  const { pathname } = useLocation()

  if (pathname.startsWith('/welcome')) {
    return (
      <Routes>
        <Route path="/welcome" element={<Navigate to="/welcome/welcome" replace />} />
        <Route path="/welcome/:step" element={<OnboardingPage />} />
        <Route path="/welcome/*" element={<Navigate to="/welcome/welcome" replace />} />
      </Routes>
    )
  }

  if (needsOnboarding && pathname !== '/login') {
    return <Navigate to="/welcome/welcome" replace />
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/pipeline" replace />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/pipeline" replace />} />
      </Routes>
    </AppShell>
  )
}
