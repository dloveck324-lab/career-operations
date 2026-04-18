import { useState } from 'react'
import { Stack, Chip, TextField, InputAdornment, IconButton } from '@mui/material'
import { Add } from '@mui/icons-material'

interface Props {
  label: string
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  color?: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'
}

export function ChipArrayInput({ label, values, onChange, placeholder, color = 'default' }: Props) {
  const [input, setInput] = useState('')

  const add = () => {
    const v = input.trim()
    if (v && !values.includes(v)) {
      onChange([...values, v])
      setInput('')
    }
  }

  const remove = (v: string) => onChange(values.filter(x => x !== v))

  return (
    <Stack spacing={1}>
      <TextField
        label={label}
        size="small"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        placeholder={placeholder ?? 'Add and press Enter'}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton size="small" onClick={add} disabled={!input.trim()}>
                <Add fontSize="small" />
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
      {values.length > 0 && (
        <Stack direction="row" flexWrap="wrap" gap={0.75}>
          {values.map(v => (
            <Chip key={v} label={v} size="small" color={color} onDelete={() => remove(v)} />
          ))}
        </Stack>
      )}
    </Stack>
  )
}
