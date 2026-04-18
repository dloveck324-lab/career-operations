import { Chip } from '@mui/material'

interface ScoreChipProps { score?: number | null }

// career-ops thresholds: 4.5+ strong · 4.0+ good · 3.5+ marginal · <3.5 avoid
export function ScoreChip({ score }: ScoreChipProps) {
  if (score == null) return null
  const color =
    score >= 4.5 ? 'success' :
    score >= 4.0 ? 'primary' :
    score >= 3.5 ? 'warning' :
                   'error'
  return (
    <Chip
      label={score.toFixed(1)}
      size="small"
      color={color}
      variant="filled"
      sx={{ fontWeight: 700, minWidth: 44 }}
    />
  )
}
