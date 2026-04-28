import { Chip, Tooltip } from '@mui/material'
import type { IndustryVertical } from '../api'

interface IndustryBadgeProps {
  vertical?: IndustryVertical
}

const LABELS: Record<IndustryVertical, string> = {
  healthcare: 'Healthcare',
  generic: 'Generic',
  ambiguous: '?',
  unclassified: '—',
}

const TOOLTIPS: Record<IndustryVertical, string> = {
  healthcare: 'Classified as healthcare — uses healthcare profile/CV by default.',
  generic: 'Classified as generic — uses generic profile/CV by default.',
  ambiguous: 'Ambiguous — you\'ll be asked to pick a profile when applying.',
  unclassified: 'Not yet classified (legacy job from before tiered scoring).',
}

const COLORS: Record<IndustryVertical, 'primary' | 'default' | 'warning'> = {
  healthcare: 'primary',
  generic: 'default',
  ambiguous: 'warning',
  unclassified: 'default',
}

export function IndustryBadge({ vertical }: IndustryBadgeProps) {
  const v = vertical ?? 'unclassified'
  return (
    <Tooltip title={TOOLTIPS[v]}>
      <Chip
        label={LABELS[v]}
        size="small"
        color={COLORS[v]}
        variant="outlined"
        sx={{ fontWeight: 500, minWidth: 70, height: 22 }}
      />
    </Tooltip>
  )
}
