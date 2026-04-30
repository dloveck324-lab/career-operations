import { useEffect, useRef, useState, useCallback } from 'react'

/**
 * Debounced auto-save hook.
 *
 * Usage:
 *   const { saving, saved, error, setBaseline } = useAutoSave(formData, saveFn)
 *
 * Call `setBaseline(loadedData)` inside your data-load effect AFTER setting
 * state. This tells the hook "this is what was last saved" so it won't fire
 * on the initial load.
 */
export function useAutoSave<T>(
  data: T,
  saveFn: () => Promise<void>,
  delay = 800,
): {
  saving: boolean
  saved: boolean
  error: string | null
  setBaseline: (v: T) => void
} {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const baselineRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Always keep a ref to the latest saveFn so the debounced callback is never stale
  const saveFnRef = useRef(saveFn)
  useEffect(() => { saveFnRef.current = saveFn })

  const setBaseline = useCallback((value: T) => {
    baselineRef.current = JSON.stringify(value)
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const serialized = JSON.stringify(data)

    // No baseline yet — data hasn't loaded from the server. Skip.
    if (baselineRef.current === null) return

    // Nothing changed since last save. Skip.
    if (serialized === baselineRef.current) return

    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setSaving(true)
      setError(null)
      try {
        await saveFnRef.current()
        baselineRef.current = serialized
        setSaved(true)
        clearTimeout(savedTimerRef.current)
        savedTimerRef.current = setTimeout(() => setSaved(false), 2500)
      } catch (e) {
        setError(String(e))
      } finally {
        setSaving(false)
      }
    }, delay)

    return () => clearTimeout(timerRef.current)
  }, [JSON.stringify(data)]) // eslint-disable-line react-hooks/exhaustive-deps

  return { saving, saved, error, setBaseline }
}
