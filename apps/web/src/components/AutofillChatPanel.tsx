import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Typography, Paper, Stack, TextField, IconButton, Chip, CircularProgress,
  Collapse, Button,
} from '@mui/material'
import { Send, Cancel, ExpandMore, ExpandLess } from '@mui/icons-material'
import { api } from '../api.js'

type EventKind =
  | 'prompt' | 'session' | 'thinking' | 'tool' | 'user'
  | 'compact' | 'status' | 'result' | 'error' | 'done'

interface StreamEvent {
  id: number
  kind: EventKind
  ts: number
  data: Record<string, unknown>
}

interface Props {
  runId: string
  jobId: number
}

export function AutofillChatPanel({ runId }: Props) {
  const [events, setEvents] = useState<StreamEvent[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<'queued' | 'running' | 'done' | 'failed' | 'cancelled'>('queued')
  const [hasSession, setHasSession] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const es = new EventSource(`/api/apply/runs/${runId}/events`)

    const handle = (kind: EventKind) => (msgEvent: MessageEvent) => {
      try {
        const payload = JSON.parse(msgEvent.data) as Record<string, unknown>
        setEvents(prev => [...prev, { id: prev.length, kind, ts: (payload.ts as number) ?? Date.now(), data: payload }])
        if (kind === 'status' && typeof payload.status === 'string') setStatus(payload.status as typeof status)
        if (kind === 'done') setStatus(prev => (prev === 'running' ? 'done' : prev))
        if (kind === 'session' && typeof payload.sessionId === 'string') setHasSession(true)
      } catch { /* ignore */ }
    }

    const kinds: EventKind[] = ['prompt', 'session', 'thinking', 'tool', 'user', 'compact', 'status', 'result', 'error', 'done']
    for (const k of kinds) es.addEventListener(k, handle(k))
    es.onerror = () => { /* browser auto-retries */ }

    return () => es.close()
  }, [runId])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [events.length])

  const prompt = useMemo(() => events.find(e => e.kind === 'prompt')?.data.text as string | undefined, [events])
  const isRunning = status === 'running' || status === 'queued'
  const canSend = isRunning || hasSession  // can chat post-hoc via --resume

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending || !canSend) return
    setSending(true)
    try {
      await api.applySendMessage(runId, text)
      setInput('')
    } catch (err) {
      setEvents(prev => [...prev, { id: prev.length, kind: 'error', ts: Date.now(), data: { message: `send failed: ${err}` } }])
    } finally {
      setSending(false)
    }
  }

  const handleCancel = async () => {
    if (!isRunning) return
    try { await api.applyCancelRun(runId) } catch { /* ignore */ }
  }

  return (
    <Paper variant="outlined" sx={{ display: 'flex', flexDirection: 'column', height: 480, bgcolor: 'background.default' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Chip
          size="small"
          label={status}
          color={status === 'done' ? 'success' : status === 'failed' || status === 'cancelled' ? 'error' : 'warning'}
          icon={isRunning ? <CircularProgress size={10} color="inherit" /> : undefined}
        />
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          run {runId}
        </Typography>
        {isRunning && (
          <IconButton size="small" onClick={handleCancel} title="Cancel run">
            <Cancel fontSize="small" />
          </IconButton>
        )}
      </Stack>

      {prompt && (
        <Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
          <Button
            size="small"
            onClick={() => setPromptOpen(o => !o)}
            startIcon={promptOpen ? <ExpandLess /> : <ExpandMore />}
            sx={{ textTransform: 'none', px: 1, py: 0.25, fontSize: '0.75rem', color: 'text.secondary' }}
          >
            system prompt ({prompt.length} chars)
          </Button>
          <Collapse in={promptOpen}>
            <Box sx={{ px: 2, pb: 1, maxHeight: 160, overflow: 'auto' }}>
              <pre style={{ fontSize: '0.7rem', margin: 0, whiteSpace: 'pre-wrap', color: 'var(--mui-palette-text-secondary)' }}>{prompt}</pre>
            </Box>
          </Collapse>
        </Box>
      )}

      <Box ref={scrollerRef} sx={{ flex: 1, overflow: 'auto', px: 1.5, py: 1 }}>
        {events.length === 0 && (
          <Typography variant="caption" color="text.secondary">Waiting for agent…</Typography>
        )}
        {events.map(ev => <EventRow key={ev.id} ev={ev} />)}
      </Box>

      <Stack direction="row" spacing={1} sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider' }}>
        <TextField
          size="small"
          fullWidth
          placeholder={
            isRunning ? 'Ask Claude about this run…' :
            canSend  ? 'Resume this session — ask a follow-up, request a fix…' :
            'No session id to resume'
          }
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void handleSend()
            }
          }}
          disabled={!canSend || sending}
          multiline
          maxRows={4}
          sx={{ '& .MuiInputBase-input': { fontSize: '0.8rem' } }}
        />
        <IconButton onClick={() => void handleSend()} disabled={!input.trim() || !canSend || sending} size="small">
          {sending ? <CircularProgress size={16} /> : <Send fontSize="small" />}
        </IconButton>
      </Stack>
    </Paper>
  )
}

function EventRow({ ev }: { ev: StreamEvent }) {
  switch (ev.kind) {
    case 'session':
      return <MetaLine text={`session ${String(ev.data.sessionId).slice(0, 8)} started`} />
    case 'status':
      return <MetaLine text={`status → ${String(ev.data.status ?? ev.data.stage ?? '')}${ev.data.instanceUrl ? ` (${ev.data.instanceUrl})` : ''}${ev.data.tabId ? ` tab ${String(ev.data.tabId).slice(0, 8)}` : ''}`} />
    case 'compact':
      return <MetaLine text="context compacted" italic />
    case 'done':
      return <MetaLine text={`done — ${String(ev.data.summary ?? '')}`} bold />
    case 'error':
      return (
        <Box sx={{ bgcolor: 'error.dark', color: 'error.contrastText', p: 1, borderRadius: 1, my: 0.5 }}>
          <Typography variant="caption">✕ {String(ev.data.message ?? '')}</Typography>
        </Box>
      )
    case 'thinking':
      return (
        <Box sx={{ my: 0.5 }}>
          <Typography variant="caption" color="text.secondary">Claude</Typography>
          <Box sx={{ bgcolor: 'action.hover', p: 1, borderRadius: 1, fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>
            {String(ev.data.text ?? '')}
          </Box>
        </Box>
      )
    case 'result':
      return (
        <Box sx={{ my: 0.5 }}>
          <Typography variant="caption" color="text.secondary">Result</Typography>
          <Box sx={{ bgcolor: 'success.dark', color: 'success.contrastText', p: 1, borderRadius: 1, fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>
            {String(ev.data.text ?? '')}
          </Box>
        </Box>
      )
    case 'user':
      return (
        <Box sx={{ my: 0.5, textAlign: 'right' }}>
          <Typography variant="caption" color="text.secondary">You</Typography>
          <Box sx={{ bgcolor: 'primary.dark', color: 'primary.contrastText', p: 1, borderRadius: 1, fontSize: '0.8rem', display: 'inline-block', maxWidth: '85%', textAlign: 'left' }}>
            {String(ev.data.text ?? '')}
          </Box>
        </Box>
      )
    case 'tool': {
      const hint = String(ev.data.hint ?? '')
      return (
        <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ my: 0.25 }}>
          <Chip size="small" label={String(ev.data.name ?? 'tool')} sx={{ fontSize: '0.65rem', height: 18 }} />
          <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.72rem', color: 'text.secondary', overflowWrap: 'anywhere' }}>
            {hint}
          </Typography>
        </Stack>
      )
    }
    case 'prompt':
      return null   // rendered separately via the collapsible header
    default:
      return null
  }
}

function MetaLine({ text, italic, bold }: { text: string; italic?: boolean; bold?: boolean }) {
  return (
    <Typography
      variant="caption"
      sx={{ display: 'block', color: 'text.secondary', fontStyle: italic ? 'italic' : 'normal', fontWeight: bold ? 600 : 400, my: 0.25 }}
    >
      · {text}
    </Typography>
  )
}
