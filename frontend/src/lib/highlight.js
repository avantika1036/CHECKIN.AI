// Split the guard's sentence into pieces so the screen can underline the words each field came from.
// `checks` is { field: { evidence, status } } as sent by the backend.
export function segments(text, checks) {
  const ranges = []
  for (const [field, c] of Object.entries(checks || {})) {
    const ev = c?.evidence
    if (!ev || c.status === 'missing') continue
    const i = text.toLowerCase().indexOf(ev.toLowerCase())
    if (i >= 0) ranges.push({ start: i, end: i + ev.length, field, status: c.status })
  }
  ranges.sort((a, b) => a.start - b.start)
  const out = []
  let pos = 0
  for (const r of ranges) {
    if (r.start < pos) continue // overlapping evidence: keep the first
    if (r.start > pos) out.push({ text: text.slice(pos, r.start) })
    out.push({ text: text.slice(r.start, r.end), field: r.field, status: r.status })
    pos = r.end
  }
  if (pos < text.length) out.push({ text: text.slice(pos) })
  return out
}
