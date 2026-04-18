import Fastify from 'fastify'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import { jobRoutes } from './routes/jobs.js'
import { scanRoutes } from './routes/scan.js'
import { evaluateRoutes } from './routes/evaluate.js'
import { settingsRoutes } from './routes/settings.js'
import { applyRoutes } from './routes/apply.js'
import { portalsRoutes } from './routes/portals.js'
import { configExists } from '@job-pipeline/core'
import { runImportWizard } from './import/wizard.js'
import { getTokenUsage } from './db/queries.js'

const app = Fastify({ logger: { level: 'warn' } })

await app.register(sensible)
await app.register(cors, {
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
})

// Routes
await app.register(jobRoutes, { prefix: '/api' })
await app.register(scanRoutes, { prefix: '/api' })
await app.register(evaluateRoutes, { prefix: '/api' })
await app.register(settingsRoutes, { prefix: '/api' })
await app.register(applyRoutes, { prefix: '/api' })
await app.register(portalsRoutes, { prefix: '/api' })

app.get('/api/health', async () => {
  const cfg = configExists()
  const tokens = getTokenUsage('day')
  return { ok: true, config: cfg, tokens }
})

app.get('/api/import/status', async () => {
  const cfg = configExists()
  return {
    needsImport: !cfg.profile || !cfg.cv,
    sourceExists: true,
    ...cfg,
  }
})

app.post('/api/import', async () => {
  return runImportWizard()
})

// Auto-import from Dave's job search on first boot
const cfg = configExists()
if (!cfg.profile || !cfg.cv || !cfg.filters) {
  console.log('First boot: importing config from Dave\'s job search…')
  const result = runImportWizard()
  const parts = [
    result.profile && 'profile',
    result.cv && 'cv',
    result.filters && 'filters',
    result.fieldMappings > 0 && `${result.fieldMappings} field mappings`,
  ].filter(Boolean)
  console.log(`Imported: ${parts.join(', ') || 'nothing new'}`)
  if (result.warnings.length) console.warn('Import warnings:', result.warnings)
}

const PORT = Number(process.env.PORT ?? 3001)
await app.listen({ port: PORT, host: '127.0.0.1' })
console.log(`Server running on http://127.0.0.1:${PORT}`)
