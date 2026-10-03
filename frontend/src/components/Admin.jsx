import React, { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { Button, fmtTime } from '../lib/ui.jsx'

export default function Admin() {
  const [events, setEvents] = useState([])
  const [notes, setNotes] = useState([])
  const [verdict, setVerdict] = useState(null)
  const [msg, setMsg] = useState('')
  const load = () => { api.audit().then(setEvents).catch((e) => setMsg(e.message)); api.notifications().then(setNotes).catch(() => {}) }
  useEffect(load, [])

  async function verify() { setVerdict(await api.verifyAudit()) }
  async function autoclose() { const r = await api.autoclose(); setMsg(`${r.closed} open visit(s) closed.`); load() }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-line bg-white p-5">
        <h2 className="text-lg font-bold">Audit log</h2>
        <p className="text-sm text-muted">Every entry carries a fingerprint of the one before it, so any edit or deletion is detectable.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button kind="primary" onClick={verify}>Verify integrity</Button>
          <Button onClick={autoclose}>Close all open visits</Button>
          {verdict && <span role="status" className={`font-bold ${verdict.ok ? 'text-go' : 'text-stop'}`}>{verdict.ok ? `Intact - ${verdict.checked} entries checked` : `BROKEN at entry ${verdict.broken_at ?? 'end'}: ${verdict.reason}`}</span>}
          {msg && <span className="text-sm text-muted">{msg}</span>}
        </div>
        <div className="mt-3 max-h-96 overflow-auto">
          <table className="w-full text-left text-sm"><thead className="text-xs uppercase text-muted"><tr><th className="py-1">#</th><th>When</th><th>Who</th><th>Event</th><th>Fingerprint</th></tr></thead>
            <tbody>{events.map((e) => (
              <tr key={e.seq} className="border-t border-line align-top"><td className="digits py-1">{e.seq}</td><td className="digits">{fmtTime(e.ts)}</td><td>{e.actor}</td><td className="font-bold">{e.event_type}</td><td className="digits text-xs text-muted">{e.hash.slice(0, 12)}</td></tr>))}</tbody></table>
        </div>
      </section>
      <section className="rounded-lg border border-line bg-white p-5">
        <h2 className="text-lg font-bold">Host notifications (queued)</h2>
        <p className="text-sm text-muted">Written together with the visit. Real email/SMS delivery is the next milestone.</p>
        <ul className="mt-2 space-y-1 text-sm">{notes.length === 0 && <li className="text-muted">None yet.</li>}
          {notes.map((n, i) => <li key={i}><b>{n.recipient}</b>: {n.body} <span className="text-muted">({fmtTime(n.created_at)})</span></li>)}</ul>
      </section>
    </div>
  )
}
