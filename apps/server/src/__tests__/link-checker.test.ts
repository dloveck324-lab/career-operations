import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkUrl } from '../scanner/link-checker.js'

// Build a Response whose body is a ReadableStream that yields a single chunk —
// matches what fetch() returns in production so our streamed soft-404 reader
// hits the cancel/decode paths.
function makeStreamingResponse(body: string, status = 200): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body))
      controller.close()
    },
  })
  return new Response(stream, { status, headers: { 'content-type': 'text/html' } })
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('checkUrl', () => {
  it('returns closed on HEAD 404', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
    expect(await checkUrl('https://x/job')).toBe('closed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns closed on HEAD 410', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 410 }))
    expect(await checkUrl('https://x/job')).toBe('closed')
  })

  it('returns unknown on HEAD 5xx', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
    expect(await checkUrl('https://x/job')).toBe('unknown')
    expect(fetchMock).toHaveBeenCalledTimes(1) // no GET fallback on 5xx
  })

  it('returns unknown on HEAD 401/403 (login wall)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }))
    expect(await checkUrl('https://x/job')).toBe('unknown')
  })

  it('returns active when HEAD 200 and body has no closed-phrase', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(makeStreamingResponse('<html><body>Apply now</body></html>'))
    expect(await checkUrl('https://x/job')).toBe('active')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns closed via soft-404: "no longer accepting applications"', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(makeStreamingResponse('<html>We are no longer accepting applications for this role.</html>'))
    expect(await checkUrl('https://x/job')).toBe('closed')
  })

  it('returns closed via soft-404: "this position has been filled"', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(makeStreamingResponse('Sorry — this position has been filled.'))
    expect(await checkUrl('https://x/job')).toBe('closed')
  })

  it('returns closed via soft-404: "no longer available"', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(makeStreamingResponse('<title>Job no longer available</title>'))
    expect(await checkUrl('https://x/job')).toBe('closed')
  })

  it('returns unknown when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    expect(await checkUrl('https://x/job')).toBe('unknown')
  })

  it('returns active when GET fallback also returns 200 with normal body', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(makeStreamingResponse('<html><body>Senior PM role description</body></html>'))
    expect(await checkUrl('https://x/job')).toBe('active')
  })
})
