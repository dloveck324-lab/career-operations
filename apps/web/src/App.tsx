import { Routes, Route, Navigate } from 'react-router-dom'
import { Box } from '@mui/material'
import { AppShell } from './components/AppShell.js'
import { PipelinePage } from './pages/PipelinePage.js'
import { SettingsPage } from './pages/SettingsPage.js'

export default function App() {
  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <AppShell>
        <Routes>
          <Route path="/" element={<Navigate to="/pipeline" replace />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </AppShell>
    </Box>
  )
}
