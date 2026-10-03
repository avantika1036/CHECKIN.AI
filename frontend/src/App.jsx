import React, { useEffect, useState } from 'react'
import { setToken } from './lib/api.js'
import { Button } from './lib/ui.jsx'
import Admin from './components/Admin.jsx'
import Gate from './components/Gate.jsx'
import Login from './components/Login.jsx'
import Visits from './components/Visits.jsx'

const load = () => { try { return JSON.parse(sessionStorage.getItem('session')) } catch { return null } }

export default function App() {
  const [session, setSession] = useState(load)
  const [tab, setTab] = useState('gate')

  useEffect(() => {
    const out = () => { sessionStorage.removeItem('session'); setSession(null) }
    window.addEventListener('auth-expired', out)
    return () => window.removeEventListener('auth-expired', out)
  }, [])

  function login(s) {
    setToken(s.token)
    const { token, ...rest } = s
    sessionStorage.setItem('session', JSON.stringify(rest)); setSession(rest); setTab('gate')
  }
  function logout() { setToken(null); sessionStorage.removeItem('session'); setSession(null) }

  if (!session) return <Login onLogin={login} />
  const tabs = [['gate', 'Gate'], ['visits', 'Visits'], ...(session.role === 'admin' ? [['admin', 'Admin']] : [])]
  return (
    <div className="mx-auto max-w-4xl px-4 pb-16">
      <header className="flex flex-wrap items-center gap-3 py-4">
        <div>
          <h1 className="text-xl font-bold">{session.display_name}</h1>
          <p className="text-xs text-muted">{session.username} - {session.role}</p>
        </div>
        <nav className="ml-auto flex gap-1" aria-label="Sections">
          {tabs.map(([k, l]) => <Button key={k} kind={tab === k ? 'primary' : 'plain'} aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{l}</Button>)}
          <Button onClick={logout}>Sign out</Button>
        </nav>
      </header>
      <main>
        {tab === 'gate' && <Gate session={session} />}
        {tab === 'visits' && <Visits session={session} />}
        {tab === 'admin' && session.role === 'admin' && <Admin />}
      </main>
    </div>
  )
}
