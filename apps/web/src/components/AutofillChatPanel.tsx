import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Typography, Paper, Stack, TextField, IconButton, Chip, CircularProgress,
  Collapse, Button, Checkbox, Alert, Popper, List, ListItemButton, ListItemText,
} from '@mui/material'
import { Send, Stop, ExpandMore, ExpandLess } from '@mui/icons-material'
import { api } from '../api.js'

interface SlashCommand { name: string; description: string; source: string }

type EventKind =
  | 'prompt' | 'session' | 'thinking' | 'tool' | 'user'
  | 'compact' | 'status' | 'result' | 'error' | 'done' | 'suggestions'

interface Suggestion { id: string; question: string; answer: string }

interface StreamEvent {
  id: number
  kind: EventKind
  ts: number
  data: Record<string, unknown>
}

interface Props {
  runId: string
  jobId: number
  model?: string   // short ('haiku'|'sonnet'|'opus') or full model id; shown as chip
  onStatusChange?: (status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled') => void
}

function modelLabel(id: string): string {
  if (id.includes('haiku')) return 'Haiku 4.5'
  if (id.includes('sonnet')) return 'Sonnet 4.6'
  if (id.includes('opus')) return 'Opus 4.7'
  return id
}

export function AutofillChatPanel({ runId, model: modelProp, onStatusChange }: Props) {
  const [events, setEvents] = useState<StreamEvent[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<'queued' | 'running' | 'done' | 'failed' | 'cancelled'>('queued')
  const [hasSession, setHasSession] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [savingMappings, setSavingMappings] = useState(false)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLDivElement | null>(null)
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([])
  const [cmdMenuOpen, setCmdMenuOpen] = useState(false)
  const [cmdHighlight, setCmdHighlight] = useState(0)

  useEffect(() => {
    const es = new EventSource(`/api/apply/runs/${runId}/events`)

    const handle = (kind: EventKind) => (msgEvent: MessageEvent) => {
      try {
        const payload = JSON.parse(msgEvent.data) as Record<string, unknown>
        setEvents(prev => [...prev, { id: prev.length, kind, ts: (payload.ts as number) ?? Date.now(), data: payload }])
        if (kind === 'status' && typeof payload.status === 'string') {
          const s = payload.status as typeof status
          setStatus(s)
          onStatusChange?.(s)
        }
        if (kind === 'done') {
          setStatus(prev => {
            const next = prev === 'running' ? 'done' : prev
            if (next !== prev) onStatusChange?.(next)
            return next
          })
        }
        if (kind === 'session' && typeof payload.sessionId === 'string') setHasSession(true)
        if (kind === 'suggestions' && Array.isArray(payload.items)) {
          const items = (payload.items as Suggestion[]).filter(
            it => it && typeof it.id === 'string' && typeof it.question === 'string' && typeof it.answer === 'string',
          )
          setSuggestions(prev => {
            const seen = new Set(prev.map(p => p.id))
            const merged = [...prev]
            for (const it of items) if (!seen.has(it.id)) merged.push({ id: it.id, question: it.question, answer: it.answer })
            return merged
          })
          setSelected(prev => {
            const next = new Set(prev)
            for (const it of items) next.add(it.id)
            return next
          })
        }
      } catch { /* ignore */ }
    }

    const kinds: EventKind[] = ['prompt', 'session', 'thinking', 'tool', 'user', 'compact', 'status', 'result', 'error', 'done', 'suggestions']
    for (const k of kinds) es.addEventListener(k, handle(k))
    es.onerror = () => { /* browser auto-retries */ }

    return () => es.close()
  }, [runId])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [events.length])

  useEffect(() => {
    api.settings.slashCommands().then(setSlashCommands).catch(() => {})
  }, [])

  const slashQuery = input.match(/^\/([a-z-]*)$/i)?.[1] ?? null
  const filteredCmds = slashQuery !== null
    ? slashCommands.filter(c => c.name.startsWith(slashQuery.toLowerCase()))
    : []

  useEffect(() => {
    if (filteredCmds.length > 0) {
      setCmdMenuOpen(true)
      setCmdHighlight(0)
    } else {
      setCmdMenuOpen(false)
    }
  }, [input])  // eslint-disable-line react-hooks/exhaustive-deps

  const selectCommand = (cmd: SlashCommand) => {
    setInput(`/${cmd.name} `)
    setCmdMenuOpen(false)
  }

  const prompt = useMemo(() => events.find(e => e.kind === 'prompt')?.data.text as string | undefined, [events])
  const modelFromEvent = useMemo(() => {
    const ev = events.find(e => typeof e.data.model === 'string')
    return ev?.data.model as string | undefined
  }, [events])
  const model = modelFromEvent ?? modelProp
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

  const toggleSelected = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const updateSuggestionAnswer = (id: string, answer: string) => {
    setSuggestions(prev => prev.map(s => s.id === id ? { ...s, answer } : s))
  }

  const handleSaveMappings = async () => {
    const items = suggestions
      .filter(s => selected.has(s.id))
      .map(s => ({ question: s.question, answer: s.answer }))
    if (items.length === 0 || savingMappings) return
    setSavingMappings(true)
    try {
      const { saved, skipped } = await api.applySaveMappings(runId, items)
      setSavedMessage(`Saved ${saved} mapping${saved === 1 ? '' : 's'}${skipped ? ` (${skipped} already existed)` : ''}`)
      setSuggestions([])
      setSelected(new Set())
      setTimeout(() => setSavedMessage(null), 4000)
    } catch (err) {
      setEvents(prev => [...prev, { id: prev.length, kind: 'error', ts: Date.now(), data: { message: `save mappings failed: ${err}` } }])
    } finally {
      setSavingMappings(false)
    }
  }

  const handleDismissSuggestions = () => {
    setSuggestions([])
    setSelected(new Set())
  }

  return (
    <Paper variant="outlined" sx={{ display: 'flex', flexDirection: 'column', height: 480, bgcolor: 'background.default' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        {model && (
          <Chip
            size="small"
            label={modelLabel(model)}
            variant="outlined"
            color="primary"
            sx={{ fontSize: '0.7rem', height: 20 }}
          />
        )}
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
          <Button
            size="small"
            variant="contained"
            color="error"
            startIcon={<Stop fontSize="small" />}
            onClick={handleCancel}
            sx={{ textTransform: 'none', py: 0.25, minHeight: 0 }}
          >
            Stop
          </Button>
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

      {suggestions.length > 0 && (
        <Box sx={{ borderTop: '1px solid', borderColor: 'divider', p: 1, bgcolor: 'action.hover', maxHeight: 260, overflow: 'auto' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.8rem' }}>
              Save these answers as field mappings?
            </Typography>
            <Button size="small" onClick={handleDismissSuggestions} sx={{ textTransform: 'none', fontSize: '0.7rem', minWidth: 0, px: 0.75 }}>
              Dismiss
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.7rem', mb: 1 }}>
            Claude generated these for fields it didn't have a cached answer for. Saving them means the next autofill won't need to regenerate them.
          </Typography>
          <Stack spacing={0.75}>
            {suggestions.map(s => {
              const isChecked = selected.has(s.id)
              return (
                <Box key={s.id} sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start', bgcolor: 'background.paper', p: 0.75, borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                  <Checkbox
                    size="small"
                    checked={isChecked}
                    onChange={() => toggleSelected(s.id)}
                    sx={{ p: 0.25, mt: '1px' }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      title={s.question}
                      sx={{ display: 'block', fontSize: '0.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {s.question}
                    </Typography>
                    <TextField
                      value={s.answer}
                      onChange={e => updateSuggestionAnswer(s.id, e.target.value)}
                      multiline
                      maxRows={3}
                      size="small"
                      fullWidth
                      disabled={savingMappings}
                      sx={{
                        mt: 0.25,
                        '& .MuiInputBase-input': {
                          fontFamily: 'ui-monospace, Menlo, monospace',
                          fontSize: '0.75rem',
                          whiteSpace: 'pre-wrap',
                        },
                      }}
                    />
                  </Box>
                </Box>
              )
            })}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }} alignItems="center">
            <Button
              variant="contained"
              size="small"
              onClick={() => void handleSaveMappings()}
              disabled={selected.size === 0 || savingMappings}
              startIcon={savingMappings ? <CircularProgress size={12} color="inherit" /> : undefined}
              sx={{ textTransform: 'none', fontSize: '0.75rem' }}
            >
              Save selected ({selected.size})
            </Button>
          </Stack>
        </Box>
      )}

      {savedMessage && (
        <Alert severity="success" sx={{ mx: 1, my: 0.5, py: 0, fontSize: '0.75rem' }}>
          {savedMessage}
        </Alert>
      )}

      <Box ref={inputRef} sx={{ position: 'relative' }}>
        <Popper
          open={cmdMenuOpen && filteredCmds.length > 0}
          anchorEl={inputRef.current}
          placement="top-start"
          style={{ zIndex: 1300, width: inputRef.current?.offsetWidth ?? 300 }}
        >
          <Paper variant="outlined" sx={{ maxHeight: 220, overflow: 'auto', bgcolor: 'background.paper' }}>
            <List dense disablePadding>
              {filteredCmds.map((cmd, i) => (
                <ListItemButton
                  key={cmd.name}
                  selected={i === cmdHighlight}
                  onClick={() => selectCommand(cmd)}
                  sx={{ py: 0.5, px: 1 }}
                >
                  <ListItemText
                    primary={
                      <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography component="span" sx={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'primary.main', fontWeight: 600 }}>
                          /{cmd.name}
                        </Typography>
                        <Chip
                          size="small"
                          label={cmd.source}
                          sx={{ fontSize: '0.6rem', height: 16, '& .MuiChip-label': { px: 0.5 } }}
                        />
                      </Box>
                    }
                    secondary={
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {cmd.description}
                      </Typography>
                    }
                  />
                </ListItemButton>
              ))}
            </List>
          </Paper>
        </Popper>
        <Stack direction="row" spacing={1} sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <TextField
            size="small"
            fullWidth
            placeholder={
              isRunning ? 'Ask Claude… type / for commands' :
              canSend  ? 'Resume session — ask a follow-up, type / for commands' :
              'No session id to resume'
            }
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (cmdMenuOpen && filteredCmds.length > 0) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setCmdHighlight(h => Math.min(h + 1, filteredCmds.length - 1)); return }
                if (e.key === 'ArrowUp') { e.preventDefault(); setCmdHighlight(h => Math.max(h - 1, 0)); return }
                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); selectCommand(filteredCmds[cmdHighlight]); return }
                if (e.key === 'Escape') { setCmdMenuOpen(false); return }
              }
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
      </Box>
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
    case 'tool':
      return null   // hidden from chat UI — show only Claude/user messages
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
