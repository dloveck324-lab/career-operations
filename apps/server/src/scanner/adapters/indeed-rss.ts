import type { RawJob } from '../runner.js'
import { createHash } from 'crypto'

export async function scanIndeedRss(query: string): Promise<RawJob[]> {
  const encoded = encodeURIComponent(query)
  const url = `https://www.indeed.com/rss?q=${encoded}&sort=date&limit=25`

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; job-pipeline/1.0)' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Indeed RSS: HTTP ${res.status}`)
  const xml = await res.text()

  return parseRssItems(xml)
}

function parseRssItems(xml: string): RawJob[] {
  const items: RawJob[] = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match: RegExpExecArray | null

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1]
    const title = extractTag(item, 'title')
    const link = extractTag(item, 'link') ?? extractTag(item, 'guid')
    const desc = extractTag(item, 'description')
    const company = extractTag(item, 'source') ?? extractCompanyFromDesc(desc ?? '')
    const location = extractLocationFromDesc(desc ?? '')

    if (!title || !link) continue

    items.push({
      source: 'indeed_rss',
      external_id: createHash('sha256').update(link).digest('hex').slice(0, 16),
      url: link,
      company: company ?? 'Unknown',
      title: decodeEntities(title),
      location,
      description: desc ? stripHtml(desc) : undefined,
    })
  }

  return items
}

function extractTag(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))
  return match ? (match[1] ?? match[2])?.trim() : undefined
}

function extractCompanyFromDesc(desc: string): string | undefined {
  const match = desc.match(/<b>([^<]+)<\/b>/)
  return match?.[1]?.trim()
}

function extractLocationFromDesc(desc: string): string | undefined {
  const match = desc.match(/([A-Za-z\s]+,\s*[A-Z]{2}(?:\s+\d{5})?)|Remote/i)
  return match?.[0]?.trim()
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}
