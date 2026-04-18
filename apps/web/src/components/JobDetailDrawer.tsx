import {
  Drawer, Box, Typography, Stack, Chip, Button, IconButton,
  Divider, CircularProgress, Alert,
} from '@mui/material'
import { Close, OpenInNew, Send, SkipNext, Psychology, Refresh } from '@mui/icons-material'
import { useState, useMemo } from 'react'
import { marked } from 'marked'
import { api, type Job } from '../api.js'
import { ScoreChip } from './ScoreChip.js'

interface Props {
  job: Job | null
  onClose: () => void
  onStatusChange: () => void
}

export function JobDetailDrawer({ job, onClose, onStatusChange }: Props) {
  const [loading, setLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const descriptionHtml = useMemo(() => {
    const raw = job?.content?.cleaned_md ?? job?.content?.raw_text ?? ''
    const text = raw.slice(0, 6000)
    // If it already looks like HTML, use as-is; otherwise parse as markdown
    return text.trimStart().startsWith('<') ? text : marked.parse(text) as string
  }, [job?.content?.cleaned_md, job?.content?.raw_text])

  const handleApply = async (showBrowser = false) => {
    if (!job) return
    setLoading('apply')
    setMessage(null)
    try {
      const result = await api.apply(job.id, showBrowser)
      setMessage(result.message)
    } catch (err) {
      setMessage(`Error: ${err}`)
    } finally {
      setLoading(null)
    }
  }

  const handleMarkApplied = async () => {
    if (!job) return
    setLoading('applied')
    await api.updateStatus(job.id, 'applied')
    setLoading(null)
    onStatusChange()
    onClose()
  }

  const handleSkip = async () => {
    if (!job) return
    setLoading('skip')
    await api.updateStatus(job.id, 'skipped')
    setLoading(null)
    onStatusChange()
    onClose()
  }

  const handleRequeue = async () => {
    if (!job) return
    setLoading('requeue')
    await api.requeue([job.id])
    setLoading(null)
    onStatusChange()
    onClose()
  }

  const handleDeepEval = async () => {
    if (!job) return
    setLoading('eval')
    try {
      await api.evaluateOne(job.id, true)
      setMessage('Deep evaluation complete')
      onStatusChange()
    } catch (err) {
      setMessage(`Error: ${err}`)
    } finally {
      setLoading(null)
    }
  }

  return (
    <Drawer anchor="right" open={!!job} onClose={onClose} PaperProps={{ sx: { width: 520, bgcolor: 'background.paper' } }}>
      {job && (
        <Box sx={{ p: 3, height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box>
              <Typography variant="h6" sx={{ lineHeight: 1.3 }}>{job.title}</Typography>
              <Typography variant="subtitle2" color="text.secondary">{job.company}</Typography>
            </Box>
            <IconButton onClick={onClose} size="small"><Close /></IconButton>
          </Stack>

          <Stack direction="row" spacing={1} flexWrap="wrap">
            {job.location && <Chip label={job.location} size="small" variant="outlined" />}
            {job.remote_policy && <Chip label={job.remote_policy} size="small" color="info" variant="outlined" />}
            {job.archetype && <Chip label={job.archetype} size="small" variant="outlined" />}
            {job.comp_text && <Chip label={job.comp_text} size="small" color="success" variant="outlined" />}
            <ScoreChip score={job.score} />
          </Stack>

          {job.score_reason && (
            <Box sx={{ bgcolor: 'action.hover', borderRadius: 2, p: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                {job.score_reason}
              </Typography>
            </Box>
          )}

          {message && <Alert severity="info" sx={{ fontSize: '0.8rem' }}>{message}</Alert>}

          <Stack direction="row" spacing={1} flexWrap="wrap">
            <Button
              variant="contained"
              startIcon={loading === 'apply' ? <CircularProgress size={14} color="inherit" /> : <Send />}
              onClick={() => handleApply(false)}
              disabled={!!loading}
              size="small"
            >
              Auto-fill (background)
            </Button>
            <Button
              variant="outlined"
              onClick={() => handleApply(true)}
              disabled={!!loading}
              size="small"
            >
              Auto-fill (visible)
            </Button>
            {job.status === 'evaluated' && (
              <Button
                variant="contained"
                color="success"
                startIcon={loading === 'applied' ? <CircularProgress size={14} color="inherit" /> : <Send />}
                onClick={handleMarkApplied}
                disabled={!!loading}
                size="small"
              >
                Mark Applied
              </Button>
            )}
            <Button
              variant="outlined"
              color="secondary"
              startIcon={<Psychology />}
              onClick={handleDeepEval}
              disabled={!!loading}
              size="small"
            >
              Deep Eval
            </Button>
            {job.status === 'evaluated' && (
              <Button
                variant="outlined"
                color="warning"
                startIcon={loading === 'requeue' ? <CircularProgress size={14} color="inherit" /> : <Refresh />}
                onClick={handleRequeue}
                disabled={!!loading}
                size="small"
              >
                Re-queue
              </Button>
            )}
            <Button
              variant="text"
              color="inherit"
              startIcon={<SkipNext />}
              onClick={handleSkip}
              disabled={!!loading}
              size="small"
            >
              Skip
            </Button>
            <Button
              component="a"
              href={job.url}
              target="_blank"
              rel="noopener"
              endIcon={<OpenInNew />}
              size="small"
              variant="text"
            >
              View posting
            </Button>
          </Stack>

          <Divider />

          {(job.content?.cleaned_md || job.content?.raw_text) && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>Description</Typography>
              <Box
                sx={{
                  fontSize: '0.8rem',
                  color: 'text.secondary',
                  '& h1,& h2,& h3,& h4': { fontSize: '0.9rem', fontWeight: 600, mt: 1, mb: 0.5 },
                  '& ul,& ol': { pl: 2, my: 0.5 },
                  '& li': { mb: 0.25 },
                  '& p': { my: 0.5 },
                }}
                dangerouslySetInnerHTML={{ __html: descriptionHtml }}
              />
            </Box>
          )}
        </Box>
      )}
    </Drawer>
  )
}
