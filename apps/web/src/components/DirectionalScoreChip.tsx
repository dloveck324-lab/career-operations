import { Chip, Tooltip } from '@mui/material'

interface DirectionalScoreChipProps {
  /** Tier 1 directional score (0-10, regex-derived, zero-token cost). */
  score?: number | null
}

/**
 * Tier 1 directional score chip — sort hint shown until a Claude eval runs.
 * Visually muted (outlined, neutral palette) so it's clear this is regex-
 * derived guesswork, not a real eval. See Step 7b of DUAL_PROFILE_MIGRATION.
 */
export function DirectionalScoreChip({ score }: DirectionalScoreChipProps) {
  if (score == null) return null
  return (
    <Tooltip title="Directional score (regex match against profile keywords). Run Evaluate for a real Claude score.">
      <Chip
        label={score.toFixed(0)}
        size="small"
        variant="outlined"
        sx={{ fontWeight: 500, minWidth: 40, color: 'text.secondary', borderColor: 'divider' }}
      />
    </Tooltip>
  )
}
