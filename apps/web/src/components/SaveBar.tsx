import { Fab, Tooltip, Typography, Stack } from '@mui/material'
import { Save, CheckCircle, ErrorOutline } from '@mui/icons-material'
import { CircularProgress } from '@mui/material'

interface Props { onSave: () => void; saving?: boolean; saved?: boolean; error?: string | null }

export function SaveBar({ onSave, saving, saved, error }: Props) {
  const icon = saving
    ? <CircularProgress size={22} color="inherit" />
    : saved
      ? <CheckCircle />
      : error
        ? <ErrorOutline />
        : <Save />

  const label = saving ? 'Saving…' : saved ? 'Saved' : error ? 'Error' : 'Save changes'
  const color = error ? 'error' : saved ? 'success' : 'primary'

  return (
    <>
      <Tooltip title={error ? <Typography variant="caption">{error}</Typography> : label} placement="left">
        <span>
          <Fab
            color={color as any}
            onClick={onSave}
            disabled={saving}
            variant="extended"
            size="medium"
            sx={{ position: 'fixed', bottom: 32, right: 32, zIndex: 1300, gap: 1 }}
          >
            {icon}
            {label}
          </Fab>
        </span>
      </Tooltip>
      {/* spacer so content doesn't hide behind FAB */}
      <Stack sx={{ pb: 10 }} />
    </>
  )
}
