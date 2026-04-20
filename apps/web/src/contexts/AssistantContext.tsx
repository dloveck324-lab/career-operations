import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { assistantApi, type AssistantModel } from '../api.js'

export interface AssistantToolUse {
  name: string
  hint: string
}

export type AssistantMessage =
  | { id: string; role: 'user'; text: string; ts: number }
  | {
      id: string
      role: 'assistant'
      text: string
      ts: number
      tools: AssistantToolUse[]
      streaming: boolean
      error?: string
    }

interface AssistantState {
  open: boolean
  setOpen: (v: boolean) => void
  sessionId: string | null
  model: AssistantModel
  setModel: (m: AssistantModel) => Promise<void>
  messages: AssistantMessage[]
  sending: boolean
  sendMessage: (text: string) => Promise<void>
  newSession: () => Promise<void>
  clear: () => void
}

const AssistantContext = createContext<AssistantState | null>(null)

export function useAssistant() {
  const ctx = useContext(AssistantContext)
  if (!ctx) throw new Error('useAssistant must be used within AssistantProvider')
  return ctx
}

interface StreamEvent {
  id: number
  ts: number
  kind: 'session' | 'thinking' | 'tool' | 'user' | 'result' | 'error' | 'status' | 'done'
  data: Record<string, unknown>
}

function uid(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [model, setModelState] = useState<AssistantModel>('opus')
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [sending, setSending] = useState(false)

  const esRef = useRef<EventSource | null>(null)
  const currentAssistantIdRef = useRef<string | null>(null)

  const closeStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
  }, [])

  const ensureAssistantMessage = useCallback((): string => {
    let id = currentAssistantIdRef.current
    if (id) return id
    id = uid()
    currentAssistantIdRef.current = id
    const newMsg: AssistantMessage = {
      id,
      role: 'assistant',
      text: '',
      ts: Date.now(),
      tools: [],
      streaming: true,
    }
    setMessages(prev => [...prev, newMsg])
    return id
  }, [])

  const closeAssistantMessage = useCallback(() => {
    const id = currentAssistantIdRef.current
    if (!id) return
    currentAssistantIdRef.current = null
    setMessages(prev => prev.map(m => (m.id === id && m.role === 'assistant' ? { ...m, streaming: false } : m)))
  }, [])

  const handleEvent = useCallback((ev: StreamEvent) => {
    const { kind, data } = ev
    if (kind === 'session') return
    if (kind === 'status') return
    if (kind === 'done') {
      closeAssistantMessage()
      return
    }
    if (kind === 'user') {
      // Server-echo of user message — we already added it optimistically on send.
      // Close any open assistant bubble so the next event starts fresh.
      closeAssistantMessage()
      return
    }
    if (kind === 'error') {
      const id = ensureAssistantMessage()
      const message = typeof data.message === 'string' ? data.message : 'Unknown error'
      setMessages(prev =>
        prev.map(m => (m.id === id && m.role === 'assistant' ? { ...m, error: message, streaming: false } : m)),
      )
      currentAssistantIdRef.current = null
      return
    }
    if (kind === 'thinking' || kind === 'result') {
      const id = ensureAssistantMessage()
      const text = typeof data.text === 'string' ? data.text : ''
      if (!text) return
      setMessages(prev =>
        prev.map(m => {
          if (m.id !== id || m.role !== 'assistant') return m
          return { ...m, text: m.text + text }
        }),
      )
      if (kind === 'result') {
        // result is the final answer — close bubble after appending
        closeAssistantMessage()
      }
      return
    }
    if (kind === 'tool') {
      const id = ensureAssistantMessage()
      const name = typeof data.name === 'string' ? data.name : 'tool'
      const hint = typeof data.hint === 'string' ? data.hint : ''
      setMessages(prev =>
        prev.map(m => {
          if (m.id !== id || m.role !== 'assistant') return m
          return { ...m, tools: [...m.tools, { name, hint }] }
        }),
      )
      return
    }
  }, [closeAssistantMessage, ensureAssistantMessage])

  const subscribe = useCallback(
    (sid: string) => {
      closeStream()
      const es = new EventSource(`/api/assistant/events/${sid}`)
      esRef.current = es
      es.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data as string) as StreamEvent
          handleEvent(parsed)
        } catch {
          /* ignore heartbeat */
        }
      }
      es.onerror = () => {
        // Browser will auto-reconnect. If the session has ended, server will 404.
      }
    },
    [closeStream, handleEvent],
  )

  const newSession = useCallback(async () => {
    closeStream()
    if (sessionId) {
      try { await assistantApi.endSession(sessionId) } catch { /* ignore */ }
    }
    currentAssistantIdRef.current = null
    setMessages([])
    setSessionId(null)
  }, [closeStream, sessionId])

  const clear = useCallback(() => {
    void newSession()
  }, [newSession])

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || sending) return
      setSending(true)
      try {
        let sid = sessionId
        if (!sid) {
          const info = await assistantApi.createSession(model)
          sid = info.sessionId
          setSessionId(sid)
          setModelState(info.model)
          subscribe(sid)
        }
        // Optimistically add the user message
        const userMsg: AssistantMessage = { id: uid(), role: 'user', text: trimmed, ts: Date.now() }
        setMessages(prev => [...prev, userMsg])
        currentAssistantIdRef.current = null
        await assistantApi.sendMessage(sid, trimmed)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setMessages(prev => [
          ...prev,
          {
            id: uid(),
            role: 'assistant',
            text: '',
            ts: Date.now(),
            tools: [],
            streaming: false,
            error: message,
          },
        ])
      } finally {
        setSending(false)
      }
    },
    [model, sending, sessionId, subscribe],
  )

  const setModel = useCallback(
    async (m: AssistantModel) => {
      setModelState(m)
      if (sessionId) {
        try { await assistantApi.changeModel(sessionId, m) } catch { /* surface error via SSE */ }
      }
    },
    [sessionId],
  )

  // Reconnect SSE if the panel reopens and we still have a session.
  useEffect(() => {
    if (open && sessionId && !esRef.current) {
      subscribe(sessionId)
    }
  }, [open, sessionId, subscribe])

  // Cleanup on unmount
  useEffect(() => {
    return () => { closeStream() }
  }, [closeStream])

  const value: AssistantState = {
    open,
    setOpen,
    sessionId,
    model,
    setModel,
    messages,
    sending,
    sendMessage,
    newSession,
    clear,
  }

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>
}
