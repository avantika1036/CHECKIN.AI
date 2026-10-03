import React from 'react'

export const STATUS_STYLE = {
  ok: 'bg-go-soft text-go',
  unverified: 'bg-warn-soft text-warn',
  ungrounded: 'bg-stop-soft text-stop',
  missing: 'bg-paper text-muted',
}
export const STATUS_LABEL = {
  ok: 'matches your words', unverified: 'please check', ungrounded: 'not in your sentence - removed', missing: 'not said',
}

export function Badge({ status, children }) {
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[status] || STATUS_STYLE.missing}`}>{children ?? STATUS_LABEL[status]}</span>
}

export function Button({ kind = 'plain', className = '', ...p }) {
  const base = 'rounded-md px-4 py-2.5 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed min-h-11'
  const kinds = {
    primary: 'bg-ink text-white hover:bg-black',
    go: 'bg-go text-white hover:brightness-110',
    plain: 'border border-line bg-white hover:bg-paper',
    danger: 'border border-stop text-stop bg-white hover:bg-stop-soft',
  }
  return <button type="button" className={`${base} ${kinds[kind]} ${className}`} {...p} />
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export const inputCls = 'w-full rounded-md border border-line bg-white px-3 py-2.5 min-h-11'

export function fmtTime(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
