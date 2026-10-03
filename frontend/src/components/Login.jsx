import React, { useState } from 'react'
import { api } from '../lib/api.js'
import { Button, Field, inputCls } from '../lib/ui.jsx'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try { onLogin(await api.login(username.trim(), password)) }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <main className="mx-auto mt-16 max-w-sm px-4">
      <h1 className="text-3xl font-bold">checkIn.ai</h1>
      <p className="mt-1 text-muted">Say it. We check it. Then it is saved.</p>
      <form onSubmit={submit} className="mt-8 space-y-4 rounded-lg border border-line bg-white p-5">
        <Field label="Username"><input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus /></Field>
        <Field label="Password"><input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        {error && <p role="alert" className="text-sm font-bold text-stop">{error}</p>}
        <Button kind="primary" className="w-full" disabled={busy || !username || !password} onClick={submit}>{busy ? 'Signing in...' : 'Sign in'}</Button>
      </form>
    </main>
  )
}
