import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { Badge, Button, fmtTime } from '../lib/ui.jsx'

const FILTERS = [['', 'All'], ['checked_in', 'Inside now'], ['pending_approval', 'Waiting approval'], ['checked_out', 'Left']]
const TONE = { checked_in: 'ok', pending_approval: 'unverified', rejected: 'ungrounded', checked_out: 'missing', auto_closed: 'missing' }

export default function Visits({ session }) {
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(() => api.visits(filter).then(setRows).catch((e) => setError(e.message)), [filter])
  useEffect(() => { load() }, [load])

  async function decide(id, approve) {
    try { await api.decide(id, approve); load() } catch (e) { setError(e.message) }
  }
  return (
    <section>
      <div className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map(([v, l]) => <Button key={v} kind={filter === v ? 'primary' : 'plain'} onClick={() => setFilter(v)}>{l}</Button>)}
        <Button className="ml-auto" onClick={load}>Refresh</Button>
      </div>
      {error && <p role="alert" className="mb-2 text-sm font-bold text-stop">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-paper text-xs uppercase text-muted"><tr>
            {['Visitor', 'Phone', 'Meeting', 'Purpose', 'Arrived', 'Status', ''].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted">No visits yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-3 py-2 font-bold">{r.visitor}</td>
                <td className="digits px-3 py-2">{r.phone || '-'}</td>
                <td className="px-3 py-2">{r.host}</td>
                <td className="px-3 py-2">{r.purpose}{r.warnings?.length > 0 && <div className="text-xs text-warn">{r.warnings.join('; ')}</div>}</td>
                <td className="digits px-3 py-2">{fmtTime(r.arrived_at)}</td>
                <td className="px-3 py-2"><Badge status={TONE[r.status]}>{r.status.replace('_', ' ')}</Badge></td>
                <td className="px-3 py-2">
                  {r.status === 'pending_approval' && session.role === 'admin' && (
                    <span className="flex gap-1"><Button kind="go" onClick={() => decide(r.id, true)}>Approve</Button><Button kind="danger" onClick={() => decide(r.id, false)}>Reject</Button></span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
