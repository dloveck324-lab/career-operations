import { Chip } from '@mui/material'
import { toDisplayScale } from '../utils/score'

interface ScoreChipProps {
  /** Claude eval score on the backend's 1-5 scale. Doubled here for 0-10 display. */
  score?: number | null
}

// Display thresholds on 0-10 scale: 9.0+ strong · 8.0+ good · 7.0+ marginal · <7.0 avoid.
// (Equivalent to 4.5 / 4.0 / 3.5 on the 1-5 source scale.)
export function ScoreChip({ score }: ScoreChipProps) {
  const display = toDisplayScale(score)
  if (display == null) return null
  const color =
    display >= 9.0 ? 'success' :
    display >= 8.0 ? 'primary' :
    display >= 7.0 ? 'warning' :
                     'error'
  return (
    <Chip
      label={display.toFixed(1)}
      size="small"
      color={color}
      variant="filled"
      sx={{ fontWeight: 700, minWidth: 44 }}
    />
  )
}
