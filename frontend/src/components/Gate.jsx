import React, { useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { Button, inputCls } from '../lib/ui.jsx'
import ManualForm from './ManualForm.jsx'
import ReviewCard from './ReviewCard.jsx'

const LANGS = [['en-IN', 'English'], ['hi-IN', 'Hindi'], ['pa-Guru-IN', 'Punjabi']]
const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null

export default function Gate({ session }) {
  const [text, setText] = useState('')
  const [run, setRun] = useState(null)           // latest answer from the server
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [manual, setManual] = useState(null)     // null = closed, object = open with prefill
  const [lang, setLang] = useState('en-IN')
  const [listening, setListening] = useState(false)
  const rec = useRef(null)

  async function call(fn) {
    setBusy(true); setError('')
    try {
      const r = await fn()
      setRun(r)
      if (r.status === 'done') {
        const s = r.result?.status
        if (s === 'manual_needed' || s === 'too_many_edits') setManual(r.result.prefill || {})
        if (s === 'registered' || s === 'checked_out') setText('')
      }
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const send = () => { setManual(null); call(() => api.startRun({ text })) }
  const submitForm = (fields) => { setManual(null); call(() => api.startRun({ fields })) }
  const answer = (body) => call(() => api.answer(run.run_id, body))

  function toggleMic() {
    if (listening) { rec.current?.stop(); return }
    const r = new SR()
    r.lang = lang; r.interimResults = true; r.continuous = false
    r.onresult = (e) => setText(Array.from(e.results).map((x) => x[0].transcript).join(' '))
    r.onerror = (e) => { setError(`Microphone: ${e.error}`); setListening(false) }
    r.onend = () => setListening(false)
    rec.current = r; setListening(true); r.start()
  }

  const done = run?.status === 'done' ? run.result : null
  const tone = done && ['registered', 'checked_out'].includes(done.status) ? 'bg-go-soft text-go' : 'bg-warn-soft text-warn'

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-line bg-white p-5">
        <label htmlFor="sentence" className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">Type or speak</label>
        <textarea id="sentence" rows={3} className={inputCls} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Rahul Sharma, 98765 43210, here to meet Dr Aggarwal about a project  -  or  -  Rahul Sharma has left" />
        <p className="mt-1 text-xs text-muted">Speech goes into the box first, so you can fix it before sending.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button kind="primary" disabled={busy || !text.trim()} onClick={send}>{busy ? 'Working...' : 'Send'}</Button>
          {SR && (
            <>
              <select aria-label="Speech language" className="min-h-11 rounded-md border border-line bg-white px-2" value={lang} onChange={(e) => setLang(e.target.value)}>
                {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <Button kind={listening ? 'danger' : 'plain'} onClick={toggleMic} aria-pressed={listening}>{listening ? 'Stop' : 'Speak'}</Button>
            </>
          )}
          <Button className="ml-auto" onClick={() => setManual({})}>Use plain form</Button>
        </div>
        {!SR && <p className="mt-2 text-xs text-muted">Voice input needs Chrome or Edge; typing works everywhere.</p>}
      </section>

      {error && <p role="alert" className="rounded-md bg-stop-soft p-3 text-sm font-bold text-stop">{error}</p>}
      {done && <p role="status" className={`rounded-md p-3 font-bold ${tone}`}>{done.message}</p>}

      {manual && <ManualForm prefill={manual} hostLabel={session.host_label} busy={busy} onSubmit={submitForm} onClose={() => setManual(null)} />}
      {run?.status === 'awaiting' && !manual && <ReviewCard card={run.card} busy={busy} onAnswer={answer} />}

      {run?.trace?.length > 0 && (
        <details className="rounded-lg border border-line bg-white p-4 text-sm">
          <summary className="cursor-pointer font-bold">How this was processed</summary>
          <ol className="mt-2 space-y-1">
            {run.trace.map((t, i) => (
              <li key={i} className="digits flex gap-3"><span className="w-28 font-bold">{t.step}</span><span className="w-14 text-muted">{t.ms} ms</span>
                <span className="text-muted">{Object.entries(t).filter(([k]) => !['step', 'ms'].includes(k)).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(',') || '-' : v}`).join('  ')}</span></li>
            ))}
          </ol>
        </details>
      )}
    </div>
  )
}
