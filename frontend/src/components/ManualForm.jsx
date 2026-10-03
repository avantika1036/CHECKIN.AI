import React, { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { Button, Field, inputCls } from '../lib/ui.jsx'

// The plain form: works with no AI at all, and goes through the same rules and the same save step.
export default function ManualForm({ prefill = {}, hostLabel, busy, onSubmit, onClose }) {
  const [f, setF] = useState({ name: '', phone: '', host: '', purpose: '', ...prefill })
  const [hosts, setHosts] = useState([])
  useEffect(() => { api.hosts().then(setHosts).catch(() => {}) }, [])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <section className="rounded-lg border border-line bg-white p-5" aria-label="Plain form">
      <h2 className="text-lg font-bold">Plain form</h2>
      <p className="text-sm text-muted">Same checks as the voice flow - just without the AI.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Visitor name"><input className={inputCls} value={f.name || ''} onChange={set('name')} /></Field>
        <Field label="Phone"><input className={inputCls} inputMode="tel" value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label={hostLabel}>
          <input className={inputCls} list="hosts" value={f.host || ''} onChange={set('host')} />
          <datalist id="hosts">{hosts.map((h) => <option key={h.id} value={h.name} />)}</datalist>
        </Field>
        <Field label="Purpose"><input className={inputCls} value={f.purpose || ''} onChange={set('purpose')} /></Field>
      </div>
      <div className="mt-4 flex gap-2">
        <Button kind="primary" disabled={busy} onClick={() => onSubmit(f)}>Check details</Button>
        <Button onClick={onClose}>Back</Button>
      </div>
    </section>
  )
}
