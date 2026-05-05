import {
  Drawer, Box, Typography, Stack, Chip, Button, IconButton,
  Divider, CircularProgress, Alert, ButtonGroup, Menu, MenuItem,
  Dialog, DialogTitle, DialogContent, DialogActions, RadioGroup, FormControlLabel, Radio,
  useTheme, useMediaQuery,
} from '@mui/material'
import { Close, OpenInNew, Send, SkipNext, Assessment, CheckCircle, ArrowDropDown } from '@mui/icons-material'
import { useState, useMemo, useEffect } from 'react'
import { marked } from 'marked'
import { api, type Job, type AutofillModel, type ProfileVariant } from '../api.js'
import { ScoreChip } from './ScoreChip.js'
import { IndustryBadge } from './IndustryBadge.js'
import { AutofillChatPanel } from './AutofillChatPanel.js'
import { SkipReasonDialog } from './SkipReasonDialog.js'

interface Props {
  job: Job | null
  onClose: () => void
  onStatusChange: () => void
}

export function JobDetailDrawer({ job, onClose, onStatusChange }: Props) {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const [loading, setLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [autofillAnchor, setAutofillAnchor] = useState<null | HTMLElement>(null)
  const [evalAnchor, setEvalAnchor] = useState<null | HTMLElement>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState<'queued' | 'running' | 'done' | 'failed' | 'cancelled' | null>(null)
  const [runModel, setRunModel] = useState<string | null>(null)
  const [variantPickerOpen, setVariantPickerOpen] = useState(false)
  const [pendingModel, setPendingModel] = useState<AutofillModel | null>(null)
  const [pickedVariant, setPickedVariant] = useState<ProfileVariant>('generic')
  const [skipDialogOpen, setSkipDialogOpen] = useState(false)
  const [skipLoading, setSkipLoading] = useState(false)

  // Reset chat panel + message when switching jobs; look up any active run for this job
  useEffect(() => {
    if (!job) { setRunId(null); setRunStatus(null); setRunModel(null); setMessage(null); return }
    setMessage(null)
    let cancelled = false
    api.applyRun(job.id).then(res => {
      if (!cancelled) {
        setRunId(res.run?.id ?? null)
        setRunStatus((res.run?.status as typeof runStatus) ?? null)
        setRunModel(res.run?.model ?? null)
      }
    }).catch(() => { if (!cancelled) { setRunId(null); setRunStatus(null); setRunModel(null) } })
    return () => { cancelled = true }
  }, [job?.id])

  const isRunActive = runStatus === 'running' || runStatus === 'queued'

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
    // Ambiguous jobs need an explicit profile pick before we can fire
    // autofill — Step 6 backend accepts the variant override.
    if (job.industry_vertical === 'ambiguous') {
      setPendingModel(model)
      setPickedVariant('generic')
      setVariantPickerOpen(true)
      return
    }
    await runApply(model)
  }

  const runApply = async (model: AutofillModel, variant?: ProfileVariant) => {
    if (!job) return
    setLoading('apply')
    setMessage(null)
    try {
      const { runId: newRunId } = await api.apply(job.id, model, variant)
      setRunId(newRunId)
      setRunStatus('queued')
      setRunModel(model)
    } catch (err) {
      setMessage(`Error: ${err}`)
    } finally {
      setLoading(null)
    }
  }

  const handleVariantPickerConfirm = async () => {
    setVariantPickerOpen(false)
    if (pendingModel) await runApply(pendingModel, pickedVariant)
    setPendingModel(null)
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

  const handleSkipConfirm = async (reason: string | undefined) => {
    if (!job) return
    setSkipLoading(true)
    await api.updateStatus(job.id, 'skipped', reason)
    setSkipLoading(false)
    setSkipDialogOpen(false)
    onStatusChange()
    onClose()
  }

  return (
    <Drawer anchor="right" open={!!job} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 520 }, bgcolor: 'background.paper' } }}>
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

          <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
            <IndustryBadge vertical={job.industry_vertical} />
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

          {runId && job && (
            <AutofillChatPanel
              key={runId}
              runId={runId}
              jobId={job.id}
              model={runModel ?? undefined}
              onStatusChange={setRunStatus}
            />
          )}

          {isInbox ? (
            <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
              <ButtonGroup size="small" variant="contained" disabled={!!loading || isRunActive}>
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
                onClick={() => setSkipDialogOpen(true)}
                disabled={!!loading || skipLoading}
                size="small"
              >
                Skip
              </Button>
            </Stack>
          ) : (
            <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
              <ButtonGroup size="small" variant="contained" disabled={!!loading || isRunActive}>
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
                onClick={() => setSkipDialogOpen(true)}
                disabled={!!loading || skipLoading}
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
      <Dialog
        open={variantPickerOpen}
        onClose={() => setVariantPickerOpen(false)}
        fullScreen={isMobile}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Which profile should fill this application?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            This job didn&apos;t classify cleanly as healthcare or generic. Pick the profile
            you want autofill to use for this run.
          </Typography>
          <RadioGroup value={pickedVariant} onChange={(e) => setPickedVariant(e.target.value as ProfileVariant)}>
            <FormControlLabel
              value="generic"
              control={<Radio />}
              label="Generic — broad B2B SaaS positioning"
            />
            <FormControlLabel
              value="healthcare"
              control={<Radio />}
              label="Healthcare — clinical / EHR / payer positioning"
            />
          </RadioGroup>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVariantPickerOpen(false)}>Cancel</Button>
          <Button onClick={handleVariantPickerConfirm} variant="contained">
            Start autofill
          </Button>
        </DialogActions>
      </Dialog>
      <SkipReasonDialog
        open={skipDialogOpen}
        count={1}
        loading={skipLoading}
        onConfirm={handleSkipConfirm}
        onCancel={() => setSkipDialogOpen(false)}
      />
    </Drawer>
  )
}
