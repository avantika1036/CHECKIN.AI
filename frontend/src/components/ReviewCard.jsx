import React, { useEffect, useState } from 'react'
import { segments } from '../lib/highlight.js'
import { Badge, Button, Field, inputCls } from '../lib/ui.jsx'

const FIELD_ORDER = ['name', 'phone', 'host', 'purpose']
const LABELS = { name: 'Visitor name', phone: 'Phone', purpose: 'Purpose' }
const UNDERLINE = { ok: 'decoration-go', unverified: 'decoration-warn', ungrounded: 'decoration-stop' }
const OUTCOME = {
  pass: ['go', 'Ready to save'], warn: ['unverified', 'Ready - with a warning'], needs_approval: ['unverified', 'Will wait for admin approval'],
  incomplete: ['ungrounded', 'Some details are missing'], block: ['ungrounded', 'Cannot be saved yet'],
}

export default function ReviewCard({ card, busy, onAnswer }) {
  const [vals, setVals] = useState({})
  const [hostId, setHostId] = useState(null)
  const [extra, setExtra] = useState('')

  useEffect(() => {                      // a new card arrived: show the server's values
    setVals({ ...card.fields }); setHostId(card.host?.id ?? null); setExtra('')
  }, [card])

  if (card.kind === 'checkout') return <CheckoutCard card={card} busy={busy} onAnswer={onAnswer} />

  const changed = FIELD_ORDER.filter((f) => (vals[f] || '') !== (card.fields[f] || '')) // fields the guard edited
  const hostChanged = hostId !== (card.host?.id ?? null)
  const dirty = changed.length > 0 || hostChanged
  const [tone, label] = OUTCOME[card.outcome] || OUTCOME.block
  const parts = card.text ? segments(card.text, card.checks) : []

  function applyEdits() {
    const fields = {}
    changed.forEach((f) => { fields[f] = vals[f] || null })
    onAnswer({ action: 'edit', fields, ...(hostChanged && hostId ? { host_id: hostId } : {}) })
  }

  return (
    <section className="rounded-lg border border-line bg-white p-5" aria-label="Review before saving">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{card.summary}</h2>
        <Badge status={tone === 'go' ? 'ok' : tone}>{label}</Badge>
      </div>

      {parts.length > 0 && (
        <p className="mt-3 rounded-md bg-mark p-3 leading-relaxed" aria-label="What you said, with matched words underlined">
          {parts.map((p, i) => p.field
            ? <u key={i} title={`${p.field}: ${p.status}`} className={`decoration-2 underline-offset-4 ${UNDERLINE[p.status] || ''}`}>{p.text}</u>
            : <span key={i}>{p.text}</span>)}
        </p>
      )}

      {card.messages.length > 0 && (
        <ul className="mt-3 space-y-1" role="alert">
          {card.messages.map((m) => (
            <li key={m.rule_id} className={`rounded px-3 py-2 text-sm font-bold ${m.severity === 'block' ? 'bg-stop-soft text-stop' : 'bg-warn-soft text-warn'}`}>{m.message}</li>
          ))}
        </ul>
      )}
      {card.missing.length > 0 && <p className="mt-2 text-sm font-bold text-warn">Missing: {card.missing.join(', ')}</p>}
      {card.returning_visitor && <p className="mt-2 text-sm text-go">Returning visitor ({card.returning_visitor.visit_count} earlier visit{card.returning_visitor.visit_count == 1 ? '' : 's'}) - will be linked to the existing record.</p>}
      {card.similar_visitors.length > 0 && (
        <p className="mt-2 text-sm text-warn">Similar name already on record: {card.similar_visitors.map((s) => `${s.name} ${s.phone || ''}`).join('; ')}. Saved as a NEW person unless you change that.</p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {['name', 'phone', 'purpose'].map((f) => (
          <Field key={f} label={LABELS[f]} hint={card.checks[f]?.note}>
            <input className={inputCls} value={vals[f] || ''} onChange={(e) => setVals({ ...vals, [f]: e.target.value })} inputMode={f === 'phone' ? 'tel' : undefined} />
            {card.checks[f] && <span className="mt-1 inline-block"><Badge status={card.checks[f].status} /></span>}
          </Field>
        ))}
        <Field label={card.host_label} hint={card.host_status === 'resolved' ? card.host?.department : card.host_status === 'ambiguous' ? 'Several people match - pick one' : card.host_status === 'not_found' ? 'Nobody found with that name' : ''}>
          <select className={inputCls} value={hostId || ''} onChange={(e) => setHostId(e.target.value || null)}>
            <option value="">{card.fields.host ? `"${card.fields.host}" - choose...` : 'choose...'}</option>
            {(card.host_candidates.length ? card.host_candidates : card.host ? [card.host] : []).map((h) => <option key={h.id} value={h.id}>{h.name}{h.department ? ` (${h.department})` : ''}</option>)}
          </select>
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <Field label="Add or correct by words">
            <input className={inputCls} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. his number is 98765 43210" />
          </Field>
        </div>
        <Button disabled={busy || !extra.trim()} onClick={() => onAnswer({ action: 'add_text', text: extra })}>Add</Button>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {dirty
          ? <Button kind="primary" disabled={busy} onClick={applyEdits}>Check my changes</Button>
          : <Button kind="go" disabled={busy || !card.can_confirm} onClick={() => onAnswer({ action: 'confirm' })}>Confirm and save</Button>}
        <Button kind="danger" disabled={busy} onClick={() => onAnswer({ action: 'cancel' })}>Cancel</Button>
      </div>
      <p className="mt-2 text-xs text-muted">Nothing is saved until you press Confirm.</p>
    </section>
  )
}

function CheckoutCard({ card, busy, onAnswer }) {
  const [pick, setPick] = useState(card.options.length === 1 ? card.options[0].id : null)
  return (
    <section className="rounded-lg border border-line bg-white p-5" aria-label="Check-out">
      <h2 className="text-lg font-bold">{card.summary}</h2>
      <ul className="mt-3 space-y-2">
        {card.options.map((o) => (
          <li key={o.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-line p-3">
              <input type="radio" name="visit" checked={pick === o.id} onChange={() => setPick(o.id)} />
              <span><b>{o.name}</b> <span className="digits text-muted">{o.phone}</span><br /><span className="text-sm text-muted">to meet {o.host}</span></span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2">
        <Button kind="go" disabled={busy || !pick} onClick={() => onAnswer({ action: 'confirm', visit_id: pick })}>Check out</Button>
        <Button kind="danger" disabled={busy} onClick={() => onAnswer({ action: 'cancel' })}>Cancel</Button>
      </div>
    </section>
  )
}
