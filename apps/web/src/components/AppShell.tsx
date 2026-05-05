import { useEffect, type ReactNode } from 'react'
import { Box } from '@mui/material'
import { createSseConnection } from '../api.js'
import { AssistantPanel } from './AssistantPanel.js'

interface AppShellProps { children: ReactNode }
interface ScanEvent { type: string; existing?: number; added?: number; reskipped?: number; linkClosed?: number; company?: string; jobId?: number; score?: number; total?: number; done?: number; message?: string; running?: boolean; kind?: string; attempts?: number; skipped?: boolean }

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
      // Sync the EVALUATE button state on initial connect + at start/end of
      // each batch. Lets the button stay disabled across page reloads while
      // a batch is in flight on the server.
      if (e.type === 'eval_state') {
        window.dispatchEvent(new CustomEvent('eval-state', { detail: { running: !!e.running } }))
      }
      // Surface credit / rate-limit / auth issues with a persistent banner.
      if (e.type === 'eval_credits_low') {
        window.dispatchEvent(new CustomEvent('eval-credits-low', {
          detail: { message: e.message ?? '', kind: e.kind ?? 'credits' },
        }))
      }
    })
    return disconnect
  }, [])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      {children}
      <AssistantPanel />
    </Box>
  )
}
