import { Stack, Button, Typography } from '@mui/material'
import { CheckCircleOutline } from '@mui/icons-material'

interface Props { onSave: () => void; saving?: boolean; saved?: boolean; error?: string | null }

export function SaveBar({ onSave, saving, saved, error }: Props) {
  return (
    <Stack direction="row" spacing={2} alignItems="center" sx={{ pt: 1 }}>
      <Button variant="contained" onClick={onSave} disabled={saving} size="small">
        {saving ? 'Saving…' : 'Save changes'}
      </Button>
      {saved && (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <CheckCircleOutline sx={{ fontSize: 16, color: 'success.main' }} />
          <Typography variant="caption" color="success.main">Saved</Typography>
        </Stack>
      )}
      {error && <Typography variant="caption" color="error.main">{error}</Typography>}
    </Stack>
  )
}
