import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Box } from '@mui/material'
import { AppShell } from './components/AppShell.js'
import { PipelinePage } from './pages/PipelinePage.js'
import { SettingsPage } from './pages/SettingsPage.js'
import { LoginPage } from './pages/LoginPage.js'
import { api } from './api.js'

export default function App() {
  const [checked, setChecked] = useState(false)
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    api.auth.me()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false))
      .finally(() => setChecked(true))
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
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/pipeline" replace />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/pipeline" replace />} />
        </Routes>
      </AppShell>
    </Box>
  )
}
