import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Paper, Stack, Typography, IconButton, TextField, Tooltip, CircularProgress,
  Select, MenuItem, type SelectChangeEvent,
} from '@mui/material'
import { Close, Send, RestartAlt, DragIndicator } from '@mui/icons-material'
import { marked } from 'marked'
import { useAssistant, type AssistantMessage } from '../contexts/AssistantContext.js'
import type { AssistantModel } from '../api.js'

const POS_KEY = 'dave-assistant-pos'
const PANEL_WIDTH = 420
const PANEL_HEIGHT = 600

interface Position { x: number; y: number }

function loadPosition(): Position | null {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Position
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed
  } catch { /* ignore */ }
  return null
}

function savePosition(pos: Position) {
  try { localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch { /* ignore */ }
}

function clampPosition(pos: Position, width: number, height: number): Position {
  const maxX = Math.max(0, window.innerWidth - width)
  const maxY = Math.max(0, window.innerHeight - height)
  return {
    x: Math.min(Math.max(0, pos.x), maxX),
    y: Math.min(Math.max(0, pos.y), maxY),
  }
}

function defaultPosition(width: number, height: number): Position {
  return {
    x: Math.max(0, window.innerWidth - width - 24),
    y: Math.max(0, window.innerHeight - height - 24),
  }
}

export function AssistantPanel() {
  const {
    open, setOpen, messages, sending, sendMessage, model, setModel, clear, sessionId,
  } = useAssistant()

  const width = Math.min(PANEL_WIDTH, Math.floor(window.innerWidth * 0.9))
  const height = Math.min(PANEL_HEIGHT, Math.floor(window.innerHeight * 0.8))

  const [position, setPosition] = useState<Position>(() => {
    const saved = loadPosition()
    return clampPosition(saved ?? defaultPosition(width, height), width, height)
  })
  const [dragging, setDragging] = useState(false)
  const dragOffsetRef = useRef<{ dx: number; dy: number } | null>(null)
  const [input, setInput] = useState('')
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  // Keep the panel in-bounds across viewport resize.
  useEffect(() => {
    const handler = () => setPosition(prev => clampPosition(prev, width, height))
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [width, height])

  // Auto-scroll on new message/content.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  const onHeaderPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('[data-assistant-nodrag]')) return
    const rect = (e.currentTarget.parentElement as HTMLElement | null)?.getBoundingClientRect()
    if (!rect) return
    dragOffsetRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onHeaderPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !dragOffsetRef.current) return
    const { dx, dy } = dragOffsetRef.current
    const next = clampPosition({ x: e.clientX - dx, y: e.clientY - dy }, width, height)
    setPosition(next)
  }, [dragging, width, height])

  const onHeaderPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setDragging(false)
    dragOffsetRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    savePosition(position)
  }, [dragging, position])

  const handleSend = async () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    await sendMessage(text)
  }

  const handleModelChange = async (e: SelectChangeEvent<AssistantModel>) => {
    await setModel(e.target.value as AssistantModel)
  }

  if (!open) return null

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        width,
        height,
        zIndex: 1300,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: 'background.paper',
      }}
    >
      {/* Header — drag handle */}
      <Box
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.25,
          py: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          cursor: dragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          bgcolor: 'background.default',
        }}
      >
        <DragIndicator fontSize="small" sx={{ color: 'text.secondary' }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 600, flexShrink: 0 }}>
          Dave Assistant
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Box data-assistant-nodrag onPointerDown={(e) => e.stopPropagation()}>
          <Select
            value={model}
            onChange={handleModelChange}
            size="small"
            variant="standard"
            disableUnderline
            sx={{
              fontSize: '0.75rem',
              '& .MuiSelect-select': { py: 0.25, pr: '20px !important', pl: 0.5 },
            }}
          >
            <MenuItem value="opus">Opus</MenuItem>
            <MenuItem value="sonnet">Sonnet</MenuItem>
            <MenuItem value="haiku">Haiku</MenuItem>
          </Select>
        </Box>
        <Tooltip title="New session">
          <span data-assistant-nodrag onPointerDown={(e) => e.stopPropagation()}>
            <IconButton size="small" onClick={() => void clear()} disabled={!sessionId && messages.length === 0}>
              <RestartAlt fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Close">
          <span data-assistant-nodrag onPointerDown={(e) => e.stopPropagation()}>
            <IconButton size="small" onClick={() => setOpen(false)}>
              <Close fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* Messages */}
      <Box ref={scrollerRef} sx={{ flex: 1, overflow: 'auto', px: 1.5, py: 1.5 }}>
        {messages.length === 0 ? (
          <Box sx={{ color: 'text.secondary', fontSize: '0.8rem', px: 1, py: 2 }}>
            <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }}>
              Ask a question, request a change to the app, or review a job.
            </Typography>
            <Typography variant="caption" component="div" sx={{ lineHeight: 1.6 }}>
              e.g. "review job 42", "why does autofill fail on Workday?", "rebuild after editing theme.ts".
            </Typography>
          </Box>
        ) : (
          <Stack spacing={1.25}>
            {messages.map(m => <MessageRow key={m.id} msg={m} />)}
          </Stack>
        )}
      </Box>

      {/* Input */}
      <Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" spacing={1} alignItems="flex-end">
          <TextField
            size="small"
            fullWidth
            multiline
            maxRows={6}
            placeholder="Ask Dave…   (Ctrl/Cmd+Enter to send)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void handleSend()
              }
            }}
            disabled={sending}
            sx={{ '& .MuiInputBase-input': { fontSize: '0.85rem' } }}
          />
          <IconButton
            onClick={() => void handleSend()}
            disabled={!input.trim() || sending}
            size="small"
            color="primary"
          >
            {sending ? <CircularProgress size={16} /> : <Send fontSize="small" />}
          </IconButton>
        </Stack>
      </Box>
    </Paper>
  )
}

function MessageRow({ msg }: { msg: AssistantMessage }) {
  if (msg.role === 'user') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Box
          sx={{
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            px: 1.25, py: 0.75,
            borderRadius: 2,
            maxWidth: '85%',
            fontSize: '0.85rem',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {msg.text}
        </Box>
      </Box>
    )
  }

  return <AssistantBubble msg={msg} />
}

function AssistantBubble({ msg }: { msg: Extract<AssistantMessage, { role: 'assistant' }> }) {
  const html = useMemo(() => {
    if (!msg.text) return ''
    try {
      return marked.parse(msg.text, { breaks: true }) as string
    } catch {
      return msg.text
    }
  }, [msg.text])

  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
      <Box
        sx={{
          bgcolor: 'action.hover',
          px: 1.25, py: 0.75,
          borderRadius: 2,
          maxWidth: '90%',
          fontSize: '0.85rem',
          wordBreak: 'break-word',
        }}
      >
        {msg.tools.length > 0 && (
          <Stack spacing={0.25} sx={{ mb: msg.text ? 0.75 : 0 }}>
            {msg.tools.map((t, i) => (
              <Typography
                key={i}
                variant="caption"
                sx={{
                  display: 'block',
                  color: 'text.secondary',
                  fontFamily: 'ui-monospace, Menlo, monospace',
                  fontSize: '0.72rem',
                }}
              >
                🔧 {t.name}{t.hint ? `: ${t.hint}` : ''}
              </Typography>
            ))}
          </Stack>
        )}
        {html ? (
          <Box
            sx={{
              '& p': { m: 0, mb: 0.5 },
              '& p:last-child': { mb: 0 },
              '& pre': {
                bgcolor: 'background.paper',
                p: 1,
                borderRadius: 1,
                overflow: 'auto',
                fontSize: '0.75rem',
                m: 0,
                my: 0.5,
              },
              '& code': {
                fontFamily: 'ui-monospace, Menlo, monospace',
                fontSize: '0.78rem',
                bgcolor: 'background.paper',
                px: 0.5,
                borderRadius: 0.5,
              },
              '& pre code': { bgcolor: 'transparent', p: 0 },
              '& ul, & ol': { m: 0, my: 0.5, pl: 3 },
              '& a': { color: 'primary.main' },
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          !msg.error && msg.streaming && (
            <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              Thinking…
            </Typography>
          )
        )}
        {msg.streaming && html && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, fontStyle: 'italic' }}>
            Streaming…
          </Typography>
        )}
        {msg.error && (
          <Typography variant="caption" sx={{ display: 'block', color: 'error.main', mt: 0.5 }}>
            ✕ {msg.error}
          </Typography>
        )}
      </Box>
    </Box>
  )
}
