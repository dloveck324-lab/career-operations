import { spawn } from 'child_process'

export interface SkipTag {
  category: SkipCategory
  keywords: string[]
}

export type SkipCategory =
  | 'language_requirement'
  | 'seniority_mismatch'
  | 'location_mismatch'
  | 'comp_too_low'
  | 'wrong_industry'
  | 'wrong_function'
  | 'certification_required'
  | 'visa_sponsorship'
  | 'culture_fit'
  | 'other'

const VALID_CATEGORIES: Set<string> = new Set([
  'language_requirement', 'seniority_mismatch', 'location_mismatch', 'comp_too_low',
  'wrong_industry', 'wrong_function', 'certification_required', 'visa_sponsorship',
  'culture_fit', 'other',
])

const FALLBACK: SkipTag = { category: 'other', keywords: [] }

/**
 * Call Claude Haiku to normalize a free-form skip reason into a structured tag.
 * Never throws — any error returns { category: 'other', keywords: [] } so the
 * skip action always succeeds even if tagging fails.
 */
export async function extractSkipTags(reason: string): Promise<SkipTag> {
  const prompt = buildPrompt(reason)
  try {
    const raw = await runClaudeCli(prompt, 'claude-haiku-4-5-20251001')
    return parseResponse(raw)
  } catch {
    return FALLBACK
  }
}

function buildPrompt(reason: string): string {
  return `You are a job-skip classifier. Given a short note explaining why a job was skipped, extract structured tags.

Return ONLY valid JSON with no explanation:
{
  "category": "<one of: language_requirement | seniority_mismatch | location_mismatch | comp_too_low | wrong_industry | wrong_function | certification_required | visa_sponsorship | culture_fit | other>",
  "keywords": ["<0-3 specific lowercase terms, e.g. french, bilingual, on-site, series-b>"]
}

Examples:
- "requires fluency in French" → {"category":"language_requirement","keywords":["french","bilingual"]}
- "needs 10+ years, I have 6" → {"category":"seniority_mismatch","keywords":[]}
- "must be in NYC office 5 days" → {"category":"location_mismatch","keywords":["on-site","nyc"]}
- "AWS Solutions Architect cert required" → {"category":"certification_required","keywords":["aws","solutions-architect"]}
- "too focused on healthcare, not my field" → {"category":"wrong_industry","keywords":["healthcare"]}

Skip reason: "${reason.replace(/"/g, '\\"').slice(0, 300)}"`
}

function parseResponse(raw: string): SkipTag {
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return FALLBACK

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { category?: unknown; keywords?: unknown }
    const category = typeof parsed.category === 'string' && VALID_CATEGORIES.has(parsed.category)
      ? (parsed.category as SkipCategory)
      : 'other'
    const keywords = Array.isArray(parsed.keywords)
      ? (parsed.keywords as unknown[]).filter(k => typeof k === 'string').slice(0, 3) as string[]
      : []
    return { category, keywords }
  } catch {
    return FALLBACK
  }
}

function runClaudeCli(prompt: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []

    const child = spawn('claude', [
      '-p', prompt,
      '--model', model,
      '--dangerously-skip-permissions',
      '--output-format', 'text',
    ], { env: { ...process.env } })

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk))

    child.on('close', code => {
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString()
        reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 200)}`))
        return
      }
      resolve(Buffer.concat(chunks).toString())
    })

    child.on('error', reject)
  })
}
