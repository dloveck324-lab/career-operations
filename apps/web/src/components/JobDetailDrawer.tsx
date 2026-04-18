import {
  Drawer, Box, Typography, Stack, Chip, Button, IconButton,
  Divider, CircularProgress, Alert, ButtonGroup, Menu, MenuItem,
} from '@mui/material'
import { Close, OpenInNew, Send, SkipNext, Assessment, CheckCircle, ArrowDropDown } from '@mui/icons-material'
import { useState, useMemo } from 'react'
import { marked } from 'marked'
import { api, type Job, type AutofillModel } from '../api.js'
import { ScoreChip } from './ScoreChip.js'

interface Props {
  job: Job | null
  onClose: () => void
  onStatusChange: () => void
}

export function JobDetailDrawer({ job, onClose, onStatusChange }: Props) {
  const [loading, setLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [autofillAnchor, setAutofillAnchor] = useState<null | HTMLElement>(null)
  const [evalAnchor, setEvalAnchor] = useState<null | HTMLElement>(null)

  const descriptionHtml = useMemo(() => {
    const raw = job?.content?.cleaned_md ?? job?.content?.raw_text ?? ''
    const text = raw.slice(0, 6000)
    if (text.trimStart().startsWith('<')) return text
    const normalized = text
      .replace(/\n[ \t]*\n/g, '\n\n')                // "\n \n" → proper blank lines
      .replace(/^[ \t]*\*(?=[^\s*])/gm, '- ')        // "*Bullet" → "- Bullet" (markdown list)
      .replace(/^[ \t]*\*(?= )/gm, '-')              // "* Bullet" → "- Bullet" (standardize)
    return marked.parse(normalized, { breaks: true }) as string
  }, [job?.content?.cleaned_md, job?.content?.raw_text])

  const isInbox = job?.status === 'scanned' || job?.status === 'prescreened'

  const handleApply = async (model: AutofillModel = 'haiku') => {
    if (!job) return
    setAutofillAnchor(null)
    setLoading('apply')
    setMessage(null)
    try {
      const result = await api.apply(job.id, model)
      setMessage(result.message)
      if (result.status === 'ready_to_submit') onStatusChange()
    } catch (err) {
      setMessage(`Error: ${err}`)
    } finally {
      setLoading(null)
    }
  }

  const handleEvaluate = async (deep = false) => {
    if (!job) return
    setEvalAnchor(null)
    setLoading('eval')
    setMessage(null)
    try {
      await api.evaluateOne(job.id, deep)
      setMessage(deep ? 'Deep evaluation complete' : 'Evaluation complete')
      onStatusChange()
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

  return (
    <Drawer anchor="right" open={!!job} onClose={onClose} PaperProps={{ sx: { width: 520, bgcolor: 'background.paper' } }}>
      {job && (
        <Box sx={{ p: 3, height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box sx={{ flex: 1, mr: 1 }}>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Typography variant="h6" sx={{ lineHeight: 1.3 }}>{job.title}</Typography>
                <IconButton
                  component="a"
                  href={job.url}
                  target="_blank"
                  rel="noopener"
                  size="small"
                  sx={{ color: 'text.secondary', flexShrink: 0 }}
                >
                  <OpenInNew sx={{ fontSize: 16 }} />
                </IconButton>
              </Stack>
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

          {isInbox ? (
            <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
              <ButtonGroup size="small" variant="contained" disabled={!!loading}>
                <Button
                  startIcon={loading === 'apply' ? <CircularProgress size={14} color="inherit" /> : <Send />}
                  onClick={() => handleApply('haiku')}
                >
                  Auto Fill
                </Button>
                <Button sx={{ px: 0.5 }} onClick={e => setAutofillAnchor(e.currentTarget)}>
                  <ArrowDropDown fontSize="small" />
                </Button>
              </ButtonGroup>
              <Menu anchorEl={autofillAnchor} open={Boolean(autofillAnchor)} onClose={() => setAutofillAnchor(null)}>
                <MenuItem onClick={() => handleApply('haiku')}>Haiku (fast)</MenuItem>
                <MenuItem onClick={() => handleApply('sonnet')}>Sonnet (balanced)</MenuItem>
                <MenuItem onClick={() => handleApply('opus')}>Opus (best)</MenuItem>
              </Menu>

              <ButtonGroup size="small" variant="outlined" disabled={!!loading}>
                <Button
                  startIcon={loading === 'eval' ? <CircularProgress size={14} color="inherit" /> : <Assessment />}
                  onClick={() => handleEvaluate(false)}
                >
                  Evaluate
                </Button>
                <Button sx={{ px: 0.5 }} onClick={e => setEvalAnchor(e.currentTarget)}>
                  <ArrowDropDown fontSize="small" />
                </Button>
              </ButtonGroup>
              <Menu anchorEl={evalAnchor} open={Boolean(evalAnchor)} onClose={() => setEvalAnchor(null)}>
                <MenuItem onClick={() => handleEvaluate(false)}>Quick (Haiku)</MenuItem>
                <MenuItem onClick={() => handleEvaluate(true)}>Deep (Sonnet)</MenuItem>
              </Menu>

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
            </Stack>
          ) : (
            <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
              <ButtonGroup size="small" variant="contained" disabled={!!loading}>
                <Button
                  startIcon={loading === 'apply' ? <CircularProgress size={14} color="inherit" /> : <Send />}
                  onClick={() => handleApply('haiku')}
                >
                  Auto Fill
                </Button>
                <Button sx={{ px: 0.5 }} onClick={e => setAutofillAnchor(e.currentTarget)}>
                  <ArrowDropDown fontSize="small" />
                </Button>
              </ButtonGroup>
              <Menu anchorEl={autofillAnchor} open={Boolean(autofillAnchor)} onClose={() => setAutofillAnchor(null)}>
                <MenuItem onClick={() => handleApply('haiku')}>Haiku (fast)</MenuItem>
                <MenuItem onClick={() => handleApply('sonnet')}>Sonnet (balanced)</MenuItem>
                <MenuItem onClick={() => handleApply('opus')}>Opus (best)</MenuItem>
              </Menu>

              {(job.status === 'evaluated' || job.status === 'ready_to_submit') && (
                <Button
                  variant="contained"
                  color="success"
                  startIcon={loading === 'applied' ? <CircularProgress size={14} color="inherit" /> : <CheckCircle />}
                  onClick={handleMarkApplied}
                  disabled={!!loading}
                  size="small"
                >
                  Applied
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
            </Stack>
          )}

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
