import type { FastifyInstance } from 'fastify'
import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, '../../../../data/jobs.db')

export async function adminRoutes(app: FastifyInstance) {
  const uploadKey = process.env.DB_UPLOAD_KEY
  if (!uploadKey) return // only active when key is set

  // One-shot endpoint to seed the DB from a local migration.
  // Protected by DB_UPLOAD_KEY. Remove the env var after migration.
  app.post('/admin/upload-db', async (req, reply) => {
    if (req.headers['x-upload-key'] !== uploadKey) {
      return reply.status(401).send({ error: 'Invalid key' })
    }
    const { db } = req.body as { db: string }
    if (!db) return reply.status(400).send({ error: 'Missing db field (base64)' })
    const bytes = Buffer.from(db, 'base64')
    writeFileSync(DB_PATH, bytes)
    return { ok: true, bytes: bytes.length }
  })
}
