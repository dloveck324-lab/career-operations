# Configuration Files

All config lives in `config/`. Files with personal data are `.gitignore`d.

## config/profile.yml

Copied from `Dave's job search/config/profile.yml` on first import. Same schema.

```yaml
candidate:
  full_name: "..."
  email: "..."
  phone: "..."
  location: "..."
  linkedin: "linkedin.com/in/..."
  portfolio_url: "..."
  github: "github.com/..."

target_roles:
  primary: ["Senior AI Engineer"]
  archetypes:
    - name: "AI/ML Engineer"
      level: "Senior/Staff"
      fit: "primary"     # primary | secondary | adjacent

narrative:
  headline: "..."
  exit_story: "..."
  superpowers: ["..."]
  proof_points:
    - name: "Project X"
      url: "..."
      hero_metric: "..."

compensation:
  target_range: "$150K-200K"
  currency: "USD"
  minimum: "$120K"
  location_flexibility: "Remote preferred"

location:
  country: "..."
  city: "..."
  timezone: "..."
  visa_status: "..."

prescreen:
  seniority_min: "Senior"        # Junior | Mid | Senior | Staff | Principal | Director | Head | VP
  comp_floor: 0                  # annual, same currency. 0 = disabled
  location_policy:
    allow_onsite_cities: []      # [] = any city allowed
    require_remote_if_elsewhere: true
  blocklist_titles:
    - "intern"
    - "junior"
  archetype_keywords:
    llmops: ["evaluation", "observability", "mlops"]
    agentic: ["agentic", "multi-agent", "orchestration"]
```

**How it's used:**
- `prescreen` block → `buildPrescreen()` at scan time (0 tokens)
- `candidate` block → injected into autofill prompts
- `target_roles` + `narrative` + `compensation` → injected into eval system prompt
- `cv.md` provides the detailed work history

## config/cv.md

Plain markdown CV. Injected into evaluation prompts (first 2000 chars) and autofill prompts (first 3000 chars).

Keep it concise and factual. Bullet points > paragraphs for token efficiency.

## config/filters.yml

Controls what the scanner fetches. No LLM involved.

```yaml
portals:
  - name: Anthropic          # display name
    type: greenhouse          # greenhouse | ashby | lever | workday | custom
    company_id: anthropic     # ATS-specific slug/ID
    enabled: true

job_boards:
  - type: indeed_rss
    queries:
      - "senior AI engineer remote"
    enabled: true

required_keywords: []        # future: post-scan keyword filter
```

**Finding company IDs:**
- Greenhouse: `https://boards-api.greenhouse.io/v1/boards/{company_id}/jobs` — try the company slug from their careers page URL
- Ashby: `https://api.ashbyhq.com/posting-api/job-board/{company_id}` — same pattern
- Lever: `https://api.lever.co/v0/postings/{company_id}` — same pattern

For reference: `Dave's job search/portals.yml` has 45+ pre-mapped companies.

## Settings UI

Both `profile.yml` and `filters.yml` are editable from the Settings screen as raw JSON.
Changes are written back to disk immediately via `PUT /api/settings/profile` and `PUT /api/settings/filters`.
The YAML is converted to JSON for the editor and back to YAML when saving.
