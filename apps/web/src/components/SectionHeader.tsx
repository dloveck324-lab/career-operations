import { Typography, Divider, Box } from '@mui/material'

interface Props { title: string; description?: string }

export function SectionHeader({ title, description }: Props) {
  return (
    <Box>
      <Typography variant="subtitle2" sx={{ color: 'primary.main', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.7rem', mb: 0.5 }}>
        {title}
      </Typography>
      {description && <Typography variant="caption" color="text.secondary">{description}</Typography>}
      <Divider sx={{ mt: 1 }} />
    </Box>
  )
}
