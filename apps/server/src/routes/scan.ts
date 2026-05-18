import type { FastifyInstance, FastifyReply } from 'fastify'
import { runScan, type ScanEvent } from '../scanner/runner.js'
import { runStandaloneLinkCheck, recheckSingleJob } from '../scanner/link-checker.js'
import { startScanRun, updateScanRun } from '../db/queries.js'

// Clients waiting for SSE events during a scan
const sseClients = new Set<FastifyReply>()
let scanPauseRequested = false

const scanCompletionHandlers: Array<() => void> = []

export function onScanComplete(cb: () => void): () => void {
  scanCompletionHandlers.push(cb)
  return () => {
    const idx = scanCompletionHandlers.indexOf(cb)
    if (idx >= 0) scanCompletionHandlers.splice(idx, 1)
  }
}

export function broadcastScanEvent(event: ScanEvent) {
  const data = `data: ${JSON.stringify(event)}\n\n`
  for (const client of sseClients) {
    try { client.raw.write(data) } catch { sseClients.delete(client) }
  }
}

export async function scanRoutes(app: FastifyInstance) {
  // SSE stream — client connects before clicking SCAN
  app.get('/scan/events', async (req, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.raw.flushHeaders()

    sseClients.add(reply)
    req.raw.on('close', () => sseClients.delete(reply))

    // Keep alive ping every 15s
    const keepAlive = setInterval(() => {
      try { reply.raw.write(': ping\n\n') } catch { clearInterval(keepAlive) }
    }, 15_000)

    req.raw.on('close', () => clearInterval(keepAlive))

    // Wait indefinitely (SSE)
    await new Promise(() => {})
  })

  app.post('/scan/pause', async () => {
    scanPauseRequested = true
    return { ok: true }
  })

  app.post('/scan', async (req) => {
    const runId = startScanRun()
    scanPauseRequested = false
    broadcastScanEvent({ type: 'start', runId })

    // Fire and forget — results stream via SSE
    runScan(runId, broadcastScanEvent, () => scanPauseRequested).then(result => {
      scanPauseRequested = false
      updateScanRun(runId, {
        ended_at: new Date().toISOString(),
        found: result.found,
        added: result.added,
        skipped: result.skipped,
        status: result.paused ? 'paused' : 'done',
      })
      broadcastScanEvent({ type: result.paused ? 'scan_paused' : 'done', runId, ...result })
      if (!result.paused) {
        for (const handler of [...scanCompletionHandlers]) handler()
      }
    }).catch(err => {
      scanPauseRequested = false
      updateScanRun(runId, { ended_at: new Date().toISOString(), status: 'failed' })
      broadcastScanEvent({ type: 'error', runId, message: String(err) })
    })

    return { runId }
  })

  /**
   * Standalone link recheck — sweeps every prescreened/evaluated job (no
   * recency cutoff). Streams progress via the existing /scan/events SSE so
   * the topbar progress UI works out of the box.
   */
  app.post('/scan/link-check', async () => {
    const runId = startScanRun()
    broadcastScanEvent({ type: 'start', runId })

    runStandaloneLinkCheck(runId, broadcastScanEvent).then(result => {
      updateScanRun(runId, {
        ended_at: new Date().toISOString(),
        found: 0,
        added: 0,
        skipped: result.closed,
        status: 'done',
      })
      broadcastScanEvent({
        type: 'done',
        runId,
        found: 0, added: 0, skipped: result.closed, existing: 0,
        linkClosed: result.closed,
        message: `Re-check done — ${result.checked} verified, ${result.closed} expired`,
      })
    }).catch(err => {
      updateScanRun(runId, { ended_at: new Date().toISOString(), status: 'failed' })
      broadcastScanEvent({ type: 'error', runId, message: String(err) })
    })

    return { runId }
  })
}
