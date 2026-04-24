import { Box, Button, Paper, Typography } from '@mui/material'
import { useSearchParams } from 'react-router-dom'

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'That Google account is not authorized.',
  cancelled: 'Sign-in was cancelled.',
  failed: 'Sign-in failed. Please try again.',
}

export function LoginPage() {
  const [params] = useSearchParams()
  const errorMsg = ERROR_MESSAGES[params.get('error') ?? ''] ?? null

  return (
    <Box sx={{ display: 'flex', height: '100dvh', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default' }}>
      <Paper elevation={3} sx={{ p: 4, maxWidth: 360, width: '100%', textAlign: 'center', borderRadius: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>Career Ops</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Sign in to access your pipeline
        </Typography>
        {errorMsg && (
          <Typography variant="body2" color="error" sx={{ mb: 2 }}>{errorMsg}</Typography>
        )}
        <Button
          variant="contained"
          size="large"
          fullWidth
          href="/api/auth/google"
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          Sign in with Google
        </Button>
      </Paper>
    </Box>
  )
}
