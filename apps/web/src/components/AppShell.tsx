import { useEffect, type ReactNode } from 'react'
import { Box } from '@mui/material'
import { createSseConnection } from '../api.js'

interface AppShellProps { children: ReactNode }
interface ScanEvent { type: string; existing?: number; added?: number; reskipped?: number; linkClosed?: number; company?: string; jobId?: number; score?: number; total?: number; done?: number; message?: string }

export function AppShell({ children }: AppShellProps) {
  useEffect(() => {
    const disconnect = createSseConnection('/scan/events', (evt) => {
      const e = evt as ScanEvent
      // Forward all SSE events to PipelinePage via window events
      window.dispatchEvent(new CustomEvent('sse-scan', { detail: e }))
      if (e.type === 'done' || e.type === 'scan_paused') {
        window.dispatchEvent(new CustomEvent('jobs-updated'))
      }
      if (e.type === 'eval_start') {
        window.dispatchEvent(new CustomEvent('eval-job-start', { detail: { jobId: e.jobId } }))
      }
      if (e.type === 'eval_done') {
        window.dispatchEvent(new CustomEvent('eval-job-done', { detail: { jobId: e.jobId } }))
      }
      if (e.type === 'eval_all_done' || e.type === 'eval_paused') {
        window.dispatchEvent(new CustomEvent('eval-job-done'))
        window.dispatchEvent(new CustomEvent('jobs-updated'))
      }
    })
    return disconnect
  }, [])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      {children}
    </Box>
  )
}
