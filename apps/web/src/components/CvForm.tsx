import { useState, useEffect, useRef } from 'react'
import {
  Stack, TextField, Typography, IconButton, Button, Box, Paper, Divider, CircularProgress, Alert,
} from '@mui/material'
import { Add, Delete, UploadFile } from '@mui/icons-material'
import { api } from '../api.js'
import { SectionHeader } from './SectionHeader.js'
import { SaveBar } from './SaveBar.js'
import { useAutoSave } from '../hooks/useAutoSave.js'

interface CvContact {
  name: string; location: string; phone: string
  email: string; linkedin: string; website: string
}
interface CvExperience {
  role: string; company: string; startDate: string; endDate: string; description: string
}
interface SkillGroup { category: string; items: string }
interface LeadershipItem { title: string; description: string }
interface EducationItem { degree: string; institution: string }

interface CvData {
  contact: CvContact
  summary: string
  experience: CvExperience[]
  skills: SkillGroup[]
  leadership: LeadershipItem[]
  education: EducationItem[]
}

const EMPTY: CvData = {
  contact: { name: '', location: '', phone: '', email: '', linkedin: '', website: '' },
  summary: '',
  experience: [],
  skills: [],
  leadership: [],
  education: [],
}

function parseCv(markdown: string): CvData {
  if (!markdown.trim()) return EMPTY
  const lines = markdown.split('\n')
  let i = 0
  const data: CvData = {
    ...EMPTY,
    contact: { ...EMPTY.contact },
    experience: [],
    skills: [],
    leadership: [],
    education: [],
  }

  while (i < lines.length && !lines[i].startsWith('# ')) i++
  if (i < lines.length) { data.contact.name = lines[i].slice(2).trim(); i++ }

  while (i < lines.length && !(lines[i].includes('|') && !lines[i].trim().startsWith('---'))) i++
  if (i < lines.length && lines[i].includes('|')) {
    const parts = lines[i].split('|').map(p => p.trim())
    data.contact.location = parts[0] ?? ''
    data.contact.phone = parts[1] ?? ''
    data.contact.email = parts[2] ?? ''
    data.contact.linkedin = parts[3] ?? ''
    data.contact.website = parts[4] ?? ''
    i++
  }

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('## Professional Summary')) {
      i++
      const acc: string[] = []
      while (i < lines.length && !lines[i].startsWith('## ') && lines[i] !== '---') {
        if (lines[i].trim()) acc.push(lines[i])
        i++
      }
      data.summary = acc.join('\n').trim()

    } else if (line.startsWith('## Professional Experience')) {
      i++
      while (i < lines.length && !lines[i].startsWith('## ')) {
        if (lines[i].startsWith('### ')) {
          const header = lines[i].slice(4).trim()
          const parts = header.split('|').map(p => p.trim())
          const role = parts[0] ?? ''
          const company = parts[1] ?? ''
          const period = parts[2] ?? ''
          const dash = period.includes(' – ') ? ' – ' : period.includes(' - ') ? ' - ' : null
          const startDate = dash ? period.split(dash)[0].trim() : period
          const endDate = dash ? period.split(dash)[1]?.trim() ?? '' : ''
          i++
          const desc: string[] = []
          while (i < lines.length && !lines[i].startsWith('### ') && !lines[i].startsWith('## ') && lines[i] !== '---') {
            desc.push(lines[i])
            i++
          }
          while (desc.length && !desc[0].trim()) desc.shift()
          while (desc.length && !desc[desc.length - 1].trim()) desc.pop()
          data.experience.push({ role, company, startDate, endDate, description: desc.join('\n') })
        } else {
          i++
        }
      }

    } else if (line.startsWith('## Skills')) {
      i++
      const acc: string[] = []
      while (i < lines.length && !lines[i].startsWith('## ') && lines[i] !== '---') {
        if (lines[i].startsWith('- ')) acc.push(lines[i])
        i++
      }
      data.skills = acc.map(l => {
        const m = l.match(/^- \*\*(.+?):\*\*\s+(.+)$/)
        return m ? { category: m[1], items: m[2] } : { category: '', items: l.slice(2) }
      })

    } else if (line.startsWith('## Leadership')) {
      i++
      const acc: string[] = []
      while (i < lines.length && !lines[i].startsWith('## ') && lines[i] !== '---') {
        if (lines[i].startsWith('- ')) acc.push(lines[i])
        i++
      }
      data.leadership = acc.map(l => {
        const m = l.match(/^- \*\*(.+?):\*\*\s+(.+)$/)
        return m ? { title: m[1], description: m[2] } : { title: '', description: l.slice(2) }
      })

    } else if (line.startsWith('## Education')) {
      i++
      const acc: string[] = []
      while (i < lines.length && !lines[i].startsWith('## ') && lines[i] !== '---') {
        if (lines[i].startsWith('- ')) acc.push(lines[i])
        i++
      }
      data.education = acc.map(l => {
        const m = l.match(/^- \*\*(.+?)\*\*\s*\|\s*(.+)$/)
        return m ? { degree: m[1], institution: m[2] } : { degree: '', institution: l.slice(2).trim() }
      })

    } else {
      i++
    }
  }

  return data
}

function serializeCv(data: CvData): string {
  const push = (...args: string[]) => lines.push(...args)
  const lines: string[] = []

  push(`# ${data.contact.name}`, '')
  const contactParts = [
    data.contact.location, data.contact.phone,
    data.contact.email, data.contact.linkedin, data.contact.website,
  ].filter(Boolean)
  if (contactParts.length) push(contactParts.join(' | '))
  push('', '---', '', '## Professional Summary', '', data.summary, '', '---', '', '## Professional Experience', '')

  for (const exp of data.experience) {
    const period = exp.endDate ? `${exp.startDate} – ${exp.endDate}` : exp.startDate
    push(`### ${exp.role} | ${exp.company} | ${period}`, '', exp.description, '')
  }

  push('---', '', '## Skills & Certifications', '')
  for (const s of data.skills) {
    push(s.category ? `- **${s.category}:** ${s.items}` : `- ${s.items}`)
  }

  push('', '---', '', '## Leadership & Mentorship', '')
  for (const l of data.leadership) {
    push(l.title ? `- **${l.title}:** ${l.description}` : `- ${l.description}`)
  }

  push('', '---', '', '## Education', '')
  for (const e of data.education) {
    if (e.degree && e.institution) push(`- **${e.degree}** | ${e.institution}`)
    else if (e.degree) push(`- **${e.degree}**`)
    else if (e.institution) push(`- ${e.institution}`)
  }
  push('')

  return lines.join('\n')
}

export function CvForm() {
  const [cv, setCv] = useState<CvData>(EMPTY)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const save = async () => { await api.settings.saveCv(serializeCv(cv)) }
  const { saving, saved, error, setBaseline } = useAutoSave(cv, save)

  useEffect(() => {
    api.settings.cv().then(r => {
      const loaded = parseCv(r.content ?? '')
      setCv(loaded)
      setBaseline(loaded)
    }).catch(() => null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileUpload = async (file: File) => {
    setUploading(true)
    setUploadError(null)
    setUploadSuccess(false)
    try {
      const result = await api.settings.uploadResume(file)
      const parsed = result.cv as CvData
      setCv(parsed)
      setUploadSuccess(true)
      setTimeout(() => setUploadSuccess(false), 4000)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const setContact = (field: keyof CvContact, value: string) =>
    setCv(c => ({ ...c, contact: { ...c.contact, [field]: value } }))

  const setExp = (i: number, field: keyof CvExperience, value: string) =>
    setCv(c => ({ ...c, experience: c.experience.map((e, j) => j === i ? { ...e, [field]: value } : e) }))

  const addExp = () =>
    setCv(c => ({ ...c, experience: [...c.experience, { role: '', company: '', startDate: '', endDate: '', description: '' }] }))

  const removeExp = (i: number) =>
    setCv(c => ({ ...c, experience: c.experience.filter((_, j) => j !== i) }))

  const setSkill = (i: number, field: keyof SkillGroup, value: string) =>
    setCv(c => ({ ...c, skills: c.skills.map((s, j) => j === i ? { ...s, [field]: value } : s) }))

  const addSkill = () =>
    setCv(c => ({ ...c, skills: [...c.skills, { category: '', items: '' }] }))

  const removeSkill = (i: number) =>
    setCv(c => ({ ...c, skills: c.skills.filter((_, j) => j !== i) }))

  const setLeader = (i: number, field: keyof LeadershipItem, value: string) =>
    setCv(c => ({ ...c, leadership: c.leadership.map((l, j) => j === i ? { ...l, [field]: value } : l) }))

  const addLeader = () =>
    setCv(c => ({ ...c, leadership: [...c.leadership, { title: '', description: '' }] }))

  const removeLeader = (i: number) =>
    setCv(c => ({ ...c, leadership: c.leadership.filter((_, j) => j !== i) }))

  const setEdu = (i: number, field: keyof EducationItem, value: string) =>
    setCv(c => ({ ...c, education: c.education.map((e, j) => j === i ? { ...e, [field]: value } : e) }))

  const addEdu = () =>
    setCv(c => ({ ...c, education: [...c.education, { degree: '', institution: '' }] }))

  const removeEdu = (i: number) =>
    setCv(c => ({ ...c, education: c.education.filter((_, j) => j !== i) }))

  return (
    <Stack spacing={4} sx={{ maxWidth: 820 }}>

      {/* ── Resume Upload ── */}
      <Paper
        variant="outlined"
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault()
          const file = e.dataTransfer.files[0]
          if (file) void handleFileUpload(file)
        }}
        sx={{
          p: 2.5,
          borderStyle: 'dashed',
          borderColor: 'divider',
          borderRadius: 2,
          textAlign: 'center',
          transition: 'border-color 0.15s',
          '&:hover': { borderColor: 'primary.main' },
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) void handleFileUpload(file)
          }}
        />
        <Stack spacing={1} alignItems="center">
          {uploading ? (
            <>
              <CircularProgress size={28} />
              <Typography variant="body2" color="text.secondary">
                Parsing resume with Claude…
              </Typography>
            </>
          ) : (
            <>
              <UploadFile sx={{ fontSize: 32, color: 'text.secondary' }} />
              <Typography variant="body2" fontWeight={600}>
                Import from resume
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Drop a PDF or text file here, or click to browse. Claude will extract and fill the form below.
              </Typography>
              <Button
                size="small"
                variant="outlined"
                onClick={() => fileInputRef.current?.click()}
                sx={{ mt: 0.5 }}
              >
                Choose file
              </Button>
            </>
          )}
        </Stack>
        {uploadSuccess && (
          <Alert severity="success" sx={{ mt: 1.5, textAlign: 'left' }}>
            Resume parsed successfully — review the fields below and save when ready.
          </Alert>
        )}
        {uploadError && (
          <Alert severity="error" sx={{ mt: 1.5, textAlign: 'left' }}>
            {uploadError}
          </Alert>
        )}
      </Paper>

      {/* ── Contact ── */}
      <Stack spacing={2}>
        <SectionHeader title="Contact" description="Same fields as the Profile tab — saving either one syncs the other." />
        <TextField label="Full name" value={cv.contact.name} size="small" fullWidth
          onChange={e => setContact('name', e.target.value)} />
        <Stack direction="row" spacing={2}>
          <TextField label="Location" value={cv.contact.location} size="small" fullWidth
            placeholder="Scottsdale, AZ 85251"
            onChange={e => setContact('location', e.target.value)} />
          <TextField label="Phone" value={cv.contact.phone} size="small" fullWidth
            onChange={e => setContact('phone', e.target.value)} />
        </Stack>
        <Stack direction="row" spacing={2}>
          <TextField label="Email" value={cv.contact.email} size="small" fullWidth
            onChange={e => setContact('email', e.target.value)} />
          <TextField label="LinkedIn" value={cv.contact.linkedin} size="small" fullWidth
            placeholder="linkedin.com/in/..."
            onChange={e => setContact('linkedin', e.target.value)} />
        </Stack>
        <TextField label="Website" value={cv.contact.website} size="small"
          placeholder="yoursite.com"
          onChange={e => setContact('website', e.target.value)} />
      </Stack>

      {/* ── Summary ── */}
      <Stack spacing={2}>
        <SectionHeader title="Professional Summary" />
        <TextField
          multiline minRows={4}
          value={cv.summary}
          fullWidth size="small"
          onChange={e => setCv(c => ({ ...c, summary: e.target.value }))}
        />
      </Stack>

      {/* ── Experience ── */}
      <Stack spacing={2}>
        <SectionHeader title="Professional Experience" />
        <Stack spacing={2}>
          {cv.experience.map((exp, i) => (
            <Paper key={i} variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1.5} alignItems="flex-start">
                  <TextField label="Role / Title" value={exp.role} size="small" sx={{ flex: 2 }}
                    onChange={e => setExp(i, 'role', e.target.value)} />
                  <TextField label="Company" value={exp.company} size="small" sx={{ flex: 2 }}
                    onChange={e => setExp(i, 'company', e.target.value)} />
                  <TextField label="Start" value={exp.startDate} size="small" sx={{ flex: 1 }}
                    placeholder="Aug 2020"
                    onChange={e => setExp(i, 'startDate', e.target.value)} />
                  <TextField label="End" value={exp.endDate} size="small" sx={{ flex: 1 }}
                    placeholder="Present"
                    onChange={e => setExp(i, 'endDate', e.target.value)} />
                  <IconButton size="small" onClick={() => removeExp(i)} sx={{ mt: 0.5 }}>
                    <Delete fontSize="small" />
                  </IconButton>
                </Stack>
                <TextField
                  label="Description"
                  multiline minRows={3}
                  value={exp.description}
                  size="small" fullWidth
                  placeholder={'- **Impact:** What you achieved\n- **How:** How you did it'}
                  onChange={e => setExp(i, 'description', e.target.value)}
                  sx={{ '& textarea': { fontSize: '0.82rem', fontFamily: '"JetBrains Mono", "Fira Code", monospace', lineHeight: 1.6 } }}
                />
              </Stack>
            </Paper>
          ))}
          <Box>
            <Button size="small" startIcon={<Add />} onClick={addExp}>Add experience</Button>
          </Box>
        </Stack>
      </Stack>

      {/* ── Skills ── */}
      <Stack spacing={2}>
        <SectionHeader title="Skills & Certifications" description="Each row: Category → comma-separated skills" />
        <Stack spacing={1}>
          {cv.skills.map((s, i) => (
            <Stack key={i} direction="row" spacing={1.5} alignItems="center">
              <TextField label="Category" value={s.category} size="small" sx={{ flex: 1 }}
                placeholder="AI & Automation"
                onChange={e => setSkill(i, 'category', e.target.value)} />
              <TextField label="Skills" value={s.items} size="small" sx={{ flex: 3 }}
                placeholder="Claude, Gemini, Zapier..."
                onChange={e => setSkill(i, 'items', e.target.value)} />
              <IconButton size="small" onClick={() => removeSkill(i)}>
                <Delete fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Box>
            <Button size="small" startIcon={<Add />} onClick={addSkill}>Add skill group</Button>
          </Box>
        </Stack>
      </Stack>

      {/* ── Leadership ── */}
      <Stack spacing={2}>
        <SectionHeader title="Leadership & Mentorship" description="Each row: Title → description" />
        <Stack spacing={1}>
          {cv.leadership.map((l, i) => (
            <Stack key={i} direction="row" spacing={1.5} alignItems="center">
              <TextField label="Title / Role" value={l.title} size="small" sx={{ flex: 1 }}
                placeholder="SaaS Product Mentor, Co.Lab (2023–2026)"
                onChange={e => setLeader(i, 'title', e.target.value)} />
              <TextField label="Description" value={l.description} size="small" sx={{ flex: 2 }}
                onChange={e => setLeader(i, 'description', e.target.value)} />
              <IconButton size="small" onClick={() => removeLeader(i)}>
                <Delete fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Box>
            <Button size="small" startIcon={<Add />} onClick={addLeader}>Add item</Button>
          </Box>
        </Stack>
      </Stack>

      {/* ── Education ── */}
      <Stack spacing={2}>
        <SectionHeader title="Education" />
        <Stack spacing={1}>
          {cv.education.map((e, i) => (
            <Stack key={i} direction="row" spacing={1.5} alignItems="center">
              <TextField label="Degree" value={e.degree} size="small" sx={{ flex: 2 }}
                placeholder="Master of Business Administration (MBA)"
                onChange={ev => setEdu(i, 'degree', ev.target.value)} />
              <TextField label="Institution" value={e.institution} size="small" sx={{ flex: 2 }}
                placeholder="Arizona State University"
                onChange={ev => setEdu(i, 'institution', ev.target.value)} />
              <IconButton size="small" onClick={() => removeEdu(i)}>
                <Delete fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Box>
            <Button size="small" startIcon={<Add />} onClick={addEdu}>Add degree</Button>
          </Box>
        </Stack>
      </Stack>

      <Divider />
      <SaveBar saving={saving} saved={saved} error={error} />
    </Stack>
  )
}
