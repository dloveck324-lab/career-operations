#!/usr/bin/env node
// Uploads your local jobs.db to the Render deployment.
//
// Usage:
//   node scripts/migrate-to-render.mjs <render-api-url> <DB_UPLOAD_KEY>
//
// Example:
//   node scripts/migrate-to-render.mjs https://career-ops-dave-api.onrender.com my-secret-key
//
// After migration, remove DB_UPLOAD_KEY from your Render env vars.

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const [, , renderUrl, uploadKey] = process.argv

if (!renderUrl || !uploadKey) {
  console.error('Usage: node scripts/migrate-to-render.mjs <render-api-url> <DB_UPLOAD_KEY>')
  process.exit(1)
}

const dbPath = join(__dirname, '../data/jobs.db')
console.log(`Reading ${dbPath}...`)
const db = readFileSync(dbPath).toString('base64')

console.log(`Uploading to ${renderUrl}...`)
const res = await fetch(`${renderUrl}/api/admin/upload-db`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-upload-key': uploadKey },
  body: JSON.stringify({ db }),
})

const result = await res.json()
if (res.ok) {
  console.log(`✅ Done — ${result.bytes.toLocaleString()} bytes written`)
  console.log('Remember to remove DB_UPLOAD_KEY from your Render env vars.')
} else {
  console.error('❌ Failed:', result)
  process.exit(1)
}
