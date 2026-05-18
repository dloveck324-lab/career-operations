import {
  Drawer, Box, Typography, Stack, Chip, Button, IconButton,
  Divider, CircularProgress, Alert, ButtonGroup, Menu, MenuItem,
  Dialog, DialogTitle, DialogContent, DialogActions, RadioGroup, FormControlLabel, Radio,
  Popover, TextField,
  useTheme, useMediaQuery,
} from '@mui/material'
import {
  Close, OpenInNew, Send, SkipNext, Assessment, CheckCircle, ArrowDropDown,
  ThumbDownAltOutlined, ThumbDownAlt,
} from '@mui/icons-material'
import { useState, useMemo, useEffect } from 'react'
import { marked } from 'marked'
import { api, type Job, type AutofillModel, type ProfileVariant, type EvalFeedback, type EvalFeedbackFlagType } from '../api.js'
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
  const [feedbackRows, setFeedbackRows] = useState<EvalFeedback[]>([])

  // Reset chat panel + message when switching jobs; look up any active run for this job
  useEffect(() => {
    if (!job) { setRunId(null); setRunStatus(null); setRunModel(null); setMessage(null); setFeedbackRows([]); return }
    setMessage(null)
    let cancelled = false
    api.applyRun(job.id).then(res => {
      if (!cancelled) {
        setRunId(res.run?.id ?? null)
        setRunStatus((res.run?.status as typeof runStatus) ?? null)
        setRunModel(res.run?.model ?? null)
      }
    }).catch(() => { if (!cancelled) { setRunId(null); setRunStatus(null); setRunModel(null) } })
    api.jobFeedback(job.id).then(rows => { if (!cancelled) setFeedbackRows(rows) })
      .catch(() => { if (!cancelled) setFeedbackRows([]) })
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
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="subtitle2" color="text.secondary">{job.company}</Typography>
                <Chip
                  label={`#${job.id}`}
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    navigator.clipboard.writeText(String(job.id)).then(() => {
                      setMessage(`Copied #${job.id}`)
                      setTimeout(() => setMessage(prev => prev === `Copied #${job.id}` ? null : prev), 1500)
                    })
                  }}
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.65rem',
                    height: 18,
                    cursor: 'pointer',
                    color: 'text.secondary',
                    '& .MuiChip-label': { px: 0.75 },
                  }}
                />
              </Stack>
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
            <EvalBlock
              scoreReason={job.score_reason}
              greenFlags={job.green_flags ?? []}
              redFlags={job.red_flags ?? []}
              feedbackRows={feedbackRows}
              onSubmit={async (flag_type, flag_text, correction) => {
                if (!job) return
                try {
                  const res = await api.submitFeedback(job.id, { flag_type, flag_text, correction })
                  setFeedbackRows(prev => [
                    {
                      id: res.id,
                      evaluation_id: res.evaluation_id,
                      job_id: job.id,
                      flag_type,
                      flag_text,
                      correction: correction ?? null,
                      created_at: new Date().toISOString(),
                    },
                    ...prev,
                  ])
                  setMessage('Feedback saved — will be applied on the next eval.')
                  setTimeout(() => setMessage(prev => prev?.startsWith('Feedback saved') ? null : prev), 2500)
                } catch (err) {
                  setMessage(`Couldn't save feedback: ${err instanceof Error ? err.message : String(err)}`)
                }
              }}
            />
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

/**
 * Strip the Pros/Cons bullets out of the legacy `score_reason` blob so we
 * can render them as discrete elements with per-line thumbs. Anything before
 * the first "Pros\n" or "Cons\n" marker is the header (dim line + verdict).
 */
function splitEvalHeader(scoreReason: string): string {
  const prosIdx = scoreReason.indexOf('\nPros\n')
  const consIdx = scoreReason.indexOf('\nCons\n')
  const candidates = [prosIdx, consIdx].filter(i => i >= 0)
  if (candidates.length === 0) return scoreReason
  return scoreReason.slice(0, Math.min(...candidates)).trim()
}

interface EvalBlockProps {
  scoreReason: string
  greenFlags: string[]
  redFlags: string[]
  feedbackRows: EvalFeedback[]
  onSubmit: (flag_type: EvalFeedbackFlagType, flag_text: string, correction?: string) => Promise<void>
}

function EvalBlock({ scoreReason, greenFlags, redFlags, feedbackRows, onSubmit }: EvalBlockProps) {
  const header = splitEvalHeader(scoreReason)
  const hasStructured = greenFlags.length > 0 || redFlags.length > 0

  // Index already-flagged items so we can render filled thumbs on revisit.
  const flaggedSet = useMemo(() => {
    const s = new Set<string>()
    for (const r of feedbackRows) s.add(`${r.flag_type}:${r.flag_text}`)
    return s
  }, [feedbackRows])

  return (
    <Box sx={{ bgcolor: 'action.hover', borderRadius: 2, p: 2 }}>
      {header && (
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', display: 'block' }}>
          {header}
        </Typography>
      )}
      {hasStructured ? (
        <Stack spacing={1.5} sx={{ mt: header ? 1.5 : 0 }}>
          {greenFlags.length > 0 && (
            <FlagList
              title="Pros"
              flags={greenFlags}
              flagType="green"
              flaggedSet={flaggedSet}
              onSubmit={onSubmit}
            />
          )}
          {redFlags.length > 0 && (
            <FlagList
              title="Cons"
              flags={redFlags}
              flagType="red"
              flaggedSet={flaggedSet}
              onSubmit={onSubmit}
            />
          )}
        </Stack>
      ) : (
        // Legacy fallback: render the full blob, no per-line thumbs available.
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', display: 'block' }}>
          {scoreReason}
        </Typography>
      )}
    </Box>
  )
}

interface FlagListProps {
  title: string
  flags: string[]
  flagType: EvalFeedbackFlagType
  flaggedSet: Set<string>
  onSubmit: (flag_type: EvalFeedbackFlagType, flag_text: string, correction?: string) => Promise<void>
}

function FlagList({ title, flags, flagType, flaggedSet, onSubmit }: FlagListProps) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>
        {title}
      </Typography>
      <Stack spacing={0.25}>
        {flags.map((flag, i) => (
          <FlagRow
            key={`${flagType}-${i}-${flag}`}
            text={flag}
            flagType={flagType}
            isFlagged={flaggedSet.has(`${flagType}:${flag}`)}
            onSubmit={onSubmit}
          />
        ))}
      </Stack>
    </Box>
  )
}

interface FlagRowProps {
  text: string
  flagType: EvalFeedbackFlagType
  isFlagged: boolean
  onSubmit: (flag_type: EvalFeedbackFlagType, flag_text: string, correction?: string) => Promise<void>
}

function FlagRow({ text, flagType, isFlagged, onSubmit }: FlagRowProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [correction, setCorrection] = useState('')
  const [saving, setSaving] = useState(false)

  const close = () => { setAnchor(null); setCorrection('') }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSubmit(flagType, text, correction.trim() || undefined)
      close()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack direction="row" alignItems="flex-start" spacing={0.5}>
      <Typography variant="caption" color="text.secondary" sx={{ flex: 1, lineHeight: 1.5 }}>
        • {text}
      </Typography>
      <IconButton
        size="small"
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ p: 0.25, color: isFlagged ? 'warning.main' : 'text.disabled', '&:hover': { color: 'warning.main' } }}
        title={isFlagged ? 'You flagged this — click to add another correction' : 'Flag as wrong / missing'}
      >
        {isFlagged ? <ThumbDownAlt sx={{ fontSize: 14 }} /> : <ThumbDownAltOutlined sx={{ fontSize: 14 }} />}
      </IconButton>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { p: 1.5, width: 320 } } }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          Flag: <strong>{text}</strong>
        </Typography>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={2}
          maxRows={4}
          size="small"
          placeholder="What did the model miss? (e.g. comp range is in JD: $195K-$225K)"
          value={correction}
          onChange={(e) => setCorrection(e.target.value)}
          disabled={saving}
          sx={{ '& .MuiInputBase-input': { fontSize: '0.8rem' } }}
        />
        <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 1 }}>
          <Button size="small" onClick={close} disabled={saving}>Cancel</Button>
          <Button size="small" variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Stack>
      </Popover>
    </Stack>
  )
}
