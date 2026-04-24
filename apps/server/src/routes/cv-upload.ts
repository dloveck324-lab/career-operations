import type { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'
import { spawn } from 'child_process'

let pdfParse: ((buf: Buffer) => Promise<{ text: string }>) | null = null
async function getPdfParse() {
  if (pdfParse) return pdfParse
  const mod = await import('pdf-parse')
  pdfParse = (mod.default ?? mod) as (buf: Buffer) => Promise<{ text: string }>
  return pdfParse
}

const CLAUDE_MODEL = 'claude-sonnet-4-6'

const PARSE_PROMPT = `You are a resume parser. Extract the following structured data from the resume text below and return ONLY a valid JSON object — no prose, no markdown fences, just the JSON.

JSON schema:
{
  "contact": {
    "name": "Full Name",
    "location": "City, State",
    "phone": "phone number or empty string",
    "email": "email or empty string",
    "linkedin": "full linkedin URL or empty string",
    "website": "personal website URL or empty string"
  },
  "summary": "professional summary paragraph or empty string",
  "experience": [
    {
      "role": "Job Title",
      "company": "Company Name",
      "startDate": "Month Year or Year",
      "endDate": "Month Year or Year or Present",
      "description": "bullet points or paragraph describing responsibilities and achievements"
    }
  ],
  "skills": [
    { "category": "Category Name", "items": "comma-separated skills in this category" }
  ],
  "leadership": [
    { "title": "Leadership role or initiative title", "description": "brief description" }
  ],
  "education": [
    { "degree": "Degree and field of study", "institution": "School Name, Year" }
  ]
}

Rules:
- Return ONLY the JSON object, nothing else
- All string fields must be strings (never null)
- All array fields must be arrays (never null)
- For experience.description: preserve key achievements and metrics from the original
- For skills: group into logical categories (e.g. "Product", "Technical", "Leadership")
- If leadership sections are not clearly distinct, leave the array empty
- Dates should be in "Mon YYYY" or "YYYY" format

RESUME TEXT:
`

function runClaudeParse(resumeText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const prompt = PARSE_PROMPT + resumeText.slice(0, 12000)
    const child = spawn('claude', [
      '-p', prompt,
      '--model', CLAUDE_MODEL,
      '--dangerously-skip-permissions',
      '--output-format', 'text',
    ], { env: { ...process.env } })

    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []
    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.stderr.on('data', (c: Buffer) => errChunks.push(c))
    child.on('close', code => {
      if (code !== 0) {
        const err = Buffer.concat(errChunks).toString().slice(0, 300)
        reject(new Error(`Claude exited ${code}: ${err}`))
        return
      }
      resolve(Buffer.concat(chunks).toString())
    })
    child.on('error', reject)
  })
}

function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON object found in Claude response')
  return JSON.parse(match[0])
}

export async function cvUploadRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  })

  app.post('/settings/cv/upload', async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const mimeType = data.mimetype
    const filename = data.filename ?? ''
    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk)
    const buf = Buffer.concat(chunks)

    let text = ''
    try {
      if (mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
        const parse = await getPdfParse()
        const result = await parse(buf)
        text = result.text
      } else if (
        mimeType === 'text/plain' ||
        filename.toLowerCase().endsWith('.txt') ||
        filename.toLowerCase().endsWith('.md')
      ) {
        text = buf.toString('utf-8')
      } else {
        return reply.code(400).send({ error: 'Unsupported file type. Please upload a PDF or plain text file.' })
      }
    } catch (err) {
      return reply.code(422).send({ error: `Could not read file: ${err instanceof Error ? err.message : String(err)}` })
    }

    if (!text.trim()) {
      return reply.code(422).send({ error: 'The file appears to be empty or could not be parsed.' })
    }

    let parsed: unknown
    try {
      const raw = await runClaudeParse(text)
      parsed = extractJson(raw)
    } catch (err) {
      return reply.code(502).send({ error: `Resume parsing failed: ${err instanceof Error ? err.message : String(err)}` })
    }

    return { ok: true, cv: parsed }
  })
}
