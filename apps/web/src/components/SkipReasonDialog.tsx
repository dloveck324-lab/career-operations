import { useState, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Typography, CircularProgress,
} from '@mui/material'

interface SkipReasonDialogProps {
  open: boolean
  /** Number of jobs being skipped. 1 = single, N = bulk. */
  count: number
  loading?: boolean
  onConfirm: (reason: string | undefined) => void
  onCancel: () => void
}

export function SkipReasonDialog({ open, count, loading = false, onConfirm, onCancel }: SkipReasonDialogProps) {
  const [reason, setReason] = useState('')

  // Reset field each time the dialog opens
  useEffect(() => {
    if (open) setReason('')
  }, [open])

  const handleConfirm = () => {
    onConfirm(reason.trim() || undefined)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleConfirm()
    }
  }

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>
        {count === 1 ? 'Skip job' : `Skip ${count} jobs`}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Optional — your reason helps improve the scoring engine.
        </Typography>
        <TextField
          autoFocus
          fullWidth
          size="small"
          placeholder="e.g. requires French fluency, on-site NYC"
          value={reason}
          onChange={e => setReason(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          inputProps={{ maxLength: 300 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={loading}>Cancel</Button>
        <Button
          variant="contained"
          color="error"
          onClick={handleConfirm}
          disabled={loading}
          startIcon={loading ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          Skip
        </Button>
      </DialogActions>
    </Dialog>
  )
}
