/**
 * Score scale normalization (Step 7a of docs/DUAL_PROFILE_MIGRATION.md).
 *
 * Backend stores Claude evaluation scores on a 1-5 scale (the skill prompt
 * asks for that). The Tier 1 directional score is on a 0-10 scale.
 * For UI consistency we display everything on 0-10 — Claude scores get
 * doubled here at the display layer. Keeping the source-of-truth as 1-5
 * preserves historical scores and avoids touching the skill prompt.
 *
 * Always go through this helper for any score render so the conversion
 * stays in one place.
 */
export function toDisplayScale(score: number | null | undefined): number | null {
  if (score == null || Number.isNaN(score)) return null
  // Backend Claude score (1-5) → 0-10. Already-0-10 values pass through
  // unchanged via the same multiplier on directional scores (which are
  // integers in 0-10) — directional callers should not call this; this
  // helper is for Claude eval scores only.
  return score * 2
}
