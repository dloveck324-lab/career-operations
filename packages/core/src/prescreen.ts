export interface PrescreenConfig {
  seniority_min?: string
  comp_floor?: number
  location_policy?: {
    allow_onsite_cities?: string[]
    require_remote_if_elsewhere?: boolean
    require_us_or_remote?: boolean
  }
  blocklist_titles?: string[]
  archetype_keywords?: Record<string, string[]>
  title_filter?: {
    positive?: string[]
    negative?: string[]
  }
}

export interface Offer {
  title: string
  location?: string
  description?: string
  comp_text?: string
}

export interface PrescreenResult {
  pass: boolean
  reason: string | null
  archetype: string | null
}

const SENIORITY_LADDER = [
  'intern', 'internship', 'entry', 'junior', 'associate',
  'mid', 'middle',
  'senior', 'sr',
  'staff',
  'principal', 'lead',
  'director',
  'head',
  'vp', 'vice president',
]

const SENIORITY_LEVELS: Record<string, string[]> = {
  junior:    ['intern', 'internship', 'entry', 'junior', 'associate'],
  mid:       ['mid', 'middle'],
  senior:    ['senior', 'sr'],
  staff:     ['staff'],
  principal: ['principal', 'lead'],
  director:  ['director'],
  head:      ['head'],
  vp:        ['vp', 'vice president'],
}

function seniorityRank(level: string): number {
  const normalized = level.toLowerCase().trim()
  const entries = Object.entries(SENIORITY_LEVELS)
  for (let i = 0; i < entries.length; i++) {
    if (entries[i][1].includes(normalized)) return i
  }
  return -1
}

function detectSeniority(title: string): string | null {
  const lower = title.toLowerCase()
  for (let i = SENIORITY_LADDER.length - 1; i >= 0; i--) {
    if (lower.includes(SENIORITY_LADDER[i])) return SENIORITY_LADDER[i]
  }
  return null
}

function extractComp(text: string): number | null {
  if (!text) return null
  const match = text.match(/\$?\s*([\d,]+)\s*[kK]|\$?\s*([\d,]+)\s*(?:USD|per year|\/yr|annual)/i)
  if (!match) return null
  const raw = match[1] ?? match[2]
  if (!raw) return null
  const num = parseInt(raw.replace(/,/g, ''), 10)
  if (match[0].toLowerCase().includes('k')) return num * 1000
  return num
}

const REMOTE_SIGNALS = ['remote', 'distributed', 'work from home', 'wfh', 'anywhere', 'worldwide', 'global']

function isRemoteFriendly(location: string, description: string): boolean {
  const text = `${location} ${description}`.toLowerCase()
  return REMOTE_SIGNALS.some(s => text.includes(s))
}

function isRemoteLocation(location: string): boolean {
  const loc = location.toLowerCase()
  return REMOTE_SIGNALS.some(s => loc.includes(s))
}

const NON_US_TERMS = [
  // Countries
  'uk', 'united kingdom', 'england', 'britain',
  'germany', 'france', 'spain', 'italy', 'netherlands', 'belgium',
  'sweden', 'denmark', 'norway', 'finland', 'switzerland', 'austria',
  'ireland', 'poland', 'portugal', 'czechia', 'czech republic', 'hungary',
  'romania', 'greece', 'croatia', 'slovakia', 'luxembourg', 'luxembourg city',
  'canada', 'australia', 'new zealand', 'india', 'brazil', 'mexico',
  'singapore', 'japan', 'china', 'south korea', 'korea', 'taiwan',
  'israel', 'turkey', 'ukraine', 'russia',
  'south africa', 'nigeria', 'kenya', 'egypt', 'morocco', 'ghana', 'ethiopia',
  'argentina', 'colombia', 'chile', 'peru', 'venezuela',
  'uae', 'united arab emirates', 'saudi arabia', 'qatar', 'kuwait', 'bahrain', 'oman', 'jordan',
  'pakistan', 'bangladesh', 'sri lanka', 'nepal', 'vietnam', 'indonesia', 'thailand', 'malaysia', 'philippines',
  'emea', 'apac', 'latam', 'europe', 'european union',
  // European cities
  'london', 'berlin', 'paris', 'amsterdam', 'toronto', 'vancouver', 'montreal',
  'sydney', 'melbourne', 'dublin', 'zurich', 'stockholm', 'copenhagen',
  'oslo', 'helsinki', 'vienna', 'warsaw', 'lisbon', 'madrid', 'barcelona',
  'rome', 'milan', 'munich', 'frankfurt', 'hamburg', 'cologne', 'düsseldorf', 'dusseldorf', 'stuttgart',
  'brussels', 'antwerp', 'geneva', 'bern', 'lyon', 'marseille', 'bordeaux', 'toulouse',
  'prague', 'budapest', 'bucharest', 'sofia', 'zagreb', 'bratislava',
  'riga', 'vilnius', 'tallinn', 'reykjavik', 'valletta',
  // Turkish cities (country "turkey" covered above, but cities may appear alone)
  'istanbul', 'ankara', 'izmir',
  // Middle East & Africa cities
  'dubai', 'abu dhabi', 'doha', 'riyadh', 'jeddah', 'kuwait city', 'muscat', 'manama', 'amman', 'beirut',
  'cairo', 'casablanca', 'nairobi', 'lagos', 'johannesburg', 'cape town', 'accra', 'addis ababa',
  // Asia cities
  'bangalore', 'hyderabad', 'mumbai', 'delhi', 'pune', 'chennai', 'kolkata',
  'tel aviv', 'tokyo', 'seoul', 'beijing', 'shanghai', 'shenzhen', 'hong kong', 'taipei',
  'jakarta', 'bangkok', 'manila', 'kuala lumpur', 'ho chi minh',
]

function isNonUSLocation(location: string): boolean {
  if (!location) return false
  const lower = location.toLowerCase()
  return NON_US_TERMS.some(term => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:^|[\\s,/(])${escaped}(?:$|[\\s,/)])`).test(lower)
  })
}

// Match keyword as a whole word (e.g. "AI" shouldn't match "paid" or "campaigns")
function matchesTitleKeyword(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\W)${escaped}(?:\\W|$)`, 'i').test(text)
}

function isAllowedLocation(location: string, allowedCities: string[]): boolean {
  if (!location || allowedCities.length === 0) return true
  const lower = location.toLowerCase()
  return allowedCities.some(city => lower.includes(city.toLowerCase()))
}

function detectArchetype(
  title: string,
  description: string,
  archetypeKeywords: Record<string, string[]>
): string | null {
  if (!archetypeKeywords || Object.keys(archetypeKeywords).length === 0) return null
  const text = `${title} ${description}`.toLowerCase()
  let bestArchetype: string | null = null
  let bestScore = 0
  for (const [archetype, keywords] of Object.entries(archetypeKeywords)) {
    const score = keywords.filter(kw => text.includes(kw.toLowerCase())).length
    if (score > bestScore) {
      bestScore = score
      bestArchetype = archetype
    }
  }
  return bestScore > 0 ? bestArchetype : null
}

export function buildPrescreen(config: PrescreenConfig = {}) {
  const {
    seniority_min = '',
    comp_floor = 0,
    location_policy = {},
    blocklist_titles = [],
    archetype_keywords = {},
    title_filter = {},
  } = config

  const minRank = seniority_min ? seniorityRank(seniority_min.toLowerCase()) : -1
  const allowedCities = location_policy.allow_onsite_cities ?? []
  const requireRemote = location_policy.require_remote_if_elsewhere !== false
  const requireUSOrRemote = location_policy.require_us_or_remote ?? true
  const negativeTitles = title_filter.negative ?? []
  const positiveTitles = title_filter.positive ?? []

  return function prescreen(offer: Offer): PrescreenResult {
    const title = offer.title ?? ''
    const location = offer.location ?? ''
    const description = offer.description ?? ''

    for (const blocked of blocklist_titles) {
      if (matchesTitleKeyword(title, blocked)) {
        return { pass: false, reason: `Skipped: title — blocklist match "${blocked}"`, archetype: null }
      }
    }

    for (const neg of negativeTitles) {
      if (matchesTitleKeyword(title, neg)) {
        return { pass: false, reason: `Skipped: title — negative keyword "${neg}"`, archetype: null }
      }
    }

    if (positiveTitles.length > 0 && !positiveTitles.some(pos => matchesTitleKeyword(title, pos))) {
      return { pass: false, reason: `Skipped: title — no positive title keywords matched`, archetype: null }
    }

    if (minRank >= 0) {
      const detected = detectSeniority(title)
      if (detected) {
        const detectedRank = seniorityRank(detected)
        if (detectedRank >= 0 && detectedRank < minRank) {
          return { pass: false, reason: `Skipped: seniority — "${detected}" below minimum "${seniority_min}"`, archetype: null }
        }
      }
    }

    if (comp_floor > 0) {
      const comp = extractComp(description) ?? extractComp(offer.comp_text ?? '')
      if (comp !== null && comp < comp_floor) {
        return { pass: false, reason: `Skipped: compensation — $${comp.toLocaleString()} below floor $${comp_floor.toLocaleString()}`, archetype: null }
      }
    }

    const remoteLocation = isRemoteLocation(location)
    const remote = remoteLocation || isRemoteFriendly(location, description)

    // Block non-US regardless of "remote" in location string — "Remote - Turkey" means
    // remote within Turkey, not worldwide remote.
    if (requireUSOrRemote && isNonUSLocation(location)) {
      return { pass: false, reason: `Skipped: location — non-US "${location}" (requires US or remote)`, archetype: null }
    }

    if (allowedCities.length > 0 || requireRemote) {
      const locationIsAllowed = isAllowedLocation(location, allowedCities)
      if (!locationIsAllowed && !remote) {
        return { pass: false, reason: `Skipped: location — on-site "${location}" not remote-friendly`, archetype: null }
      }
    }

    const archetype = detectArchetype(title, description, archetype_keywords)
    return { pass: true, reason: null, archetype }
  }
}
