import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import {
  Activity as ActivityIcon, ArrowDownLeft, ArrowUpRight, BadgeCheck, Building2, CalendarDays,
  Check, CheckCircle2, ChevronRight, CircleHelp, Clock3, FileClock, Filter, Fingerprint,
  Gauge, LoaderCircle, LogOut, Menu, Plus, Search, Settings2, Shield, ShieldCheck, Sparkles,
  Users, X,
} from 'lucide-react';
import {
  getGetConfigurationQueryKey, getGetDashboardSummaryQueryKey, getGetVisitorQueryKey,
  getHealthCheckQueryKey, getListActivityQueryKey, getListVisitorsQueryKey,
  useCheckoutVisitor, useCreateVisitor, useGetConfiguration, useGetDashboardSummary,
  useGetVisitor, useHealthCheck, useListActivity, useListVisitors, useParseVisitorRequest,
  useQueryVisitors, useUpdateConfiguration,
} from '@workspace/api-client-react';
import type { ConfigurationInput, VisitorInput, Visitor } from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';
import './index.css';

const queryClient = new QueryClient();
const routes = [
  { href: '/', label: 'Overview', icon: Gauge },
  { href: '/visitors', label: 'Visitors', icon: Users },
  { href: '/activity', label: 'Activity log', icon: FileClock },
  { href: '/settings', label: 'Settings', icon: Settings2 },
];

function AppFrame({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 60000 } });
  const label = routes.find((item) => item.href === path)?.label ?? 'Overview';
  return <div className="app-shell min-h-[100dvh] md:flex">
    <aside className={`sidebar fixed inset-y-0 left-0 z-40 flex w-[250px] flex-col px-4 py-5 transition-transform md:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex items-center gap-3 px-2 pb-9">
        <div className="brand-mark"><Fingerprint size={20} strokeWidth={2.5} /></div>
        <div><div className="font-serif text-[17px] font-extrabold tracking-tight">CheckIn<span className="text-[#6bc6a1]">.AI</span></div><div className="mt-0.5 text-[10px] tracking-[.16em] text-[#9eacba] uppercase">Campus operations</div></div>
      </div>
      <div className="px-3 pb-3 text-[10px] font-semibold tracking-[.16em] text-[#8190a0] uppercase">Front desk</div>
      <nav className="space-y-1">
        {routes.map(({ href, label: itemLabel, icon: Icon }) => <Link key={href} href={href} data-testid={`link-nav-${itemLabel.toLowerCase().replace(' ', '-')}`} className={`nav-link ${path === href ? 'active' : ''}`} onClick={() => setMenuOpen(false)}>
          <Icon size={17} strokeWidth={1.8} /><span className="text-[13px] font-medium">{itemLabel}</span>
          {href === '/visitors' && path === href ? <ChevronRight className="ml-auto" size={15} /> : null}
        </Link>)}
      </nav>
      <div className="mt-auto rounded-xl border border-white/10 bg-white/[.045] p-3.5">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-[#e7ece9]"><span className={`status-dot ${health.isError ? '!bg-[#d77265]' : ''}`} />{health.isLoading ? 'Connecting to service' : health.isError ? 'Service needs attention' : 'Operations online'}</div>
        <p className="mt-2 text-[11px] leading-relaxed text-[#9aa8b5]">Demo environment. Sign-in and role-based access are not enabled; use sample data only.</p>
        {health.isError && <button onClick={() => health.refetch()} className="mt-2 text-[11px] font-semibold text-[#79d0ae] underline underline-offset-2">Retry connection</button>}
      </div>
      <div className="mt-4 flex items-center gap-3 border-t border-white/10 px-2 pt-4">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-[#40566d] text-xs font-bold text-white">FD</div>
        <div className="min-w-0"><div className="truncate text-xs font-semibold">Front desk</div><div className="mt-0.5 text-[10px] text-[#9eacba]">Demo environment</div></div>
        <ShieldCheck className="ml-auto text-[#78c9a8]" size={17} />
      </div>
    </aside>
    {menuOpen && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-[#102033]/45 md:hidden" onClick={() => setMenuOpen(false)} />}
    <main className="min-w-0 flex-1 md:ml-[250px]">
      <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-[#e5e5dd] bg-[#f8f7f1]/95 px-4 backdrop-blur md:px-9">
        <div className="flex items-center gap-3"><button aria-label="Open navigation" className="btn-quiet !p-2 md:hidden" onClick={() => setMenuOpen(true)}><Menu size={18} /></button><span className="eyebrow">Check-in desk</span><span className="text-[#c6cbc6]">/</span><span className="text-sm font-semibold text-[#33465a]">{label}</span></div>
        <div className="flex items-center gap-2 text-xs text-[#77858a]"><span className="hidden sm:inline">Local time</span><Clock3 size={14} /><span className="data-mono">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
      </header>
      <div className="mx-auto max-w-[1440px] px-4 pb-12 pt-7 md:px-9 md:pt-9 page-enter">{children}</div>
    </main>
  </div>;
}

function PageHeading({ kicker, title, description, action }: { kicker: string; title: string; description: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
    <div><div className="eyebrow mb-2">{kicker}</div><h1 className="font-serif text-[30px] font-extrabold tracking-[-.045em] text-[#1e2c40] md:text-[34px]">{title}</h1><p className="mt-1.5 max-w-2xl text-sm text-[#728087]">{description}</p></div>{action}
  </div>;
}

function QueryProblem({ retry }: { retry: () => void }) {
  return <div className="panel flex flex-col items-start gap-3 p-6"><div className="grid h-10 w-10 place-items-center rounded-full bg-[#fbebe7] text-[#a84c3f]"><CircleHelp size={19} /></div><div><h3 className="font-bold">We couldn’t load this view</h3><p className="mt-1 text-sm text-[#748187]">Your records are unchanged. Check the connection and try again.</p></div><button onClick={retry} className="btn-quiet">Try again</button></div>;
}

function Metric({ label, value, icon: Icon, accent, hint }: { label: string; value?: number; icon: typeof Users; accent: string; hint: string }) {
  return <div className="panel relative overflow-hidden p-5">
    <div className="absolute right-0 top-0 h-20 w-20 rounded-bl-full opacity-[.06]" style={{ background: accent }} />
    <div className="flex items-start justify-between"><span className="eyebrow">{label}</span><span className="grid h-9 w-9 place-items-center rounded-lg" style={{ color: accent, background: `${accent}16` }}><Icon size={17} /></span></div>
    {value === undefined ? <div className="skeleton mt-5 h-8 w-20 rounded" /> : <div className="mt-3 font-serif text-[32px] font-extrabold tracking-[-.04em] text-[#203047]">{value}</div>}
    <div className="mt-1 text-xs text-[#7a878a]">{hint}</div>
  </div>;
}

const emptyVisitor: VisitorInput = { name: '', phone: '', email: '', organization: '', purpose: '', host: '' };
function Dashboard() {
  const qc = useQueryClient();
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const organization = useGetConfiguration({ query: { queryKey: getGetConfigurationQueryKey() } });
  const recent = useListVisitors({ limit: 6 }, { query: { queryKey: getListVisitorsQueryKey({ limit: 6 }) } });
  const parse = useParseVisitorRequest();
  const create = useCreateVisitor();
  const ask = useQueryVisitors();
  const [mode, setMode] = useState<'register' | 'ask'>('register');
  const [requestText, setRequestText] = useState('');
  const [draft, setDraft] = useState<VisitorInput>(emptyVisitor);
  const [ready, setReady] = useState(false);
  const [answer, setAnswer] = useState<{ answer: string; count: number; visitors: Visitor[] } | null>(null);
  const [notice, setNotice] = useState('');
  const changeDraft = (field: keyof VisitorInput, value: string) => setDraft((prev) => ({ ...prev, [field]: value }));
  const handleRequest = (event: FormEvent) => {
    event.preventDefault(); setNotice(''); setAnswer(null);
    if (requestText.trim().length < 3) { setNotice('Please enter at least 3 characters.'); return; }
    if (mode === 'register') {
      parse.mutate({ data: { text: requestText.trim() } }, { onSuccess: (result) => { setDraft(result.visitor); setReady(true); setNotice(`Draft extracted using local rules · ${Math.round(result.confidence * 100)}% heuristic match estimate. Review every field before saving.`); }, onError: () => setNotice('The request could not be parsed. Please retry or enter details manually.') });
    } else {
      ask.mutate({ data: { question: requestText.trim() } }, { onSuccess: (result) => setAnswer(result), onError: () => setNotice('The visitor query could not be completed. Try a simpler question.') });
    }
  };
  const register = (event: FormEvent) => {
    event.preventDefault(); setNotice('');
    const required = organization.data?.requiredFields ?? ['name', 'purpose', 'host'];
    const missing = required.filter((field) => !String(draft[field as keyof VisitorInput] ?? '').trim());
    if (missing.length) { setNotice(`Complete required fields: ${missing.join(', ')}.`); return; }
    if (!draft.name.trim() || !draft.purpose.trim() || !draft.host.trim()) { setNotice('Name, purpose, and host are required by the visitor register.'); return; }
    create.mutate({ data: { ...draft, name: draft.name.trim(), purpose: draft.purpose.trim(), host: draft.host.trim() } }, {
      onSuccess: () => { setDraft(emptyVisitor); setReady(false); setRequestText(''); setNotice('Visitor checked in. The arrival is now on the visitor register.'); setAnswer(null);
        void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); void qc.invalidateQueries({ queryKey: getListVisitorsQueryKey() }); void qc.invalidateQueries({ queryKey: getListActivityQueryKey() });
      }, onError: () => setNotice('Check-in was not saved. Review the details and try again.'),
    });
  };
  const counts = summary.data?.dailyCounts ?? [];
  const maxCount = Math.max(1, ...counts.map((item) => item.count));
  return <>
    <PageHeading kicker="Live visitor desk" title="Good morning, front desk." description="A clear view of today’s arrivals, active visits, and the people on campus right now." action={<div className="flex items-center gap-2 rounded-full border border-[#cfe3d8] bg-[#edf6f0] px-3 py-2 text-xs font-semibold text-[#276b4f]"><span className="status-dot" /> Desk is open</div>} />
    {summary.isError ? <QueryProblem retry={() => summary.refetch()} /> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Arrivals today" value={summary.data?.visitorsToday} icon={ArrowDownLeft} accent="#328b69" hint="All registered check-ins" />
        <Metric label="On campus now" value={summary.data?.insideNow} icon={Users} accent="#284d75" hint="Active visitor visits" />
        <Metric label="Departed today" value={summary.data?.checkedOutToday} icon={ArrowUpRight} accent="#cc8a42" hint="Checked out this shift" />
        <Metric label="This week" value={summary.data?.visitsThisWeek} icon={CalendarDays} accent="#537e9a" hint="Visits since Monday" />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(370px,.82fr)]">
        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#eef0eb] px-5 py-4 md:px-6"><div><div className="eyebrow">Arrival activity</div><h2 className="mt-1 font-serif text-lg font-bold">Visitor flow</h2></div><span className="rounded-full bg-[#f2f4ef] px-2.5 py-1 text-[11px] text-[#768386]">Past 7 days</span></div>
          <div className="px-5 py-5 md:px-6">
            {summary.isLoading ? <div className="skeleton h-[190px] rounded-lg" /> : counts.length ? <div className="flex h-[190px] items-end gap-2 border-b border-[#e8ece6] pb-0 sm:gap-4">
              {counts.slice(-7).map((item) => <div key={item.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                <span className="data-mono text-[10px] text-[#78868a]">{item.count}</span><div className="w-full max-w-[37px] rounded-t-[5px] bg-[#56aa83] transition-[height] duration-500 hover:bg-[#287858]" style={{ height: `${Math.max(5, item.count / maxCount * 125)}px` }} /><span className="mb-2 text-[10px] text-[#899295]">{new Date(String(item.date)).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })}</span>
              </div>)}
            </div> : <div className="grid h-[190px] place-items-center text-sm text-[#78868a]">No arrival history to chart yet.</div>}
            <div className="mt-4 flex items-center gap-2 text-xs text-[#78868a]"><span className="h-2 w-2 rounded-sm bg-[#56aa83]" />Daily visitor check-ins</div>
          </div>
          <div className="border-t border-[#eef0eb] px-5 py-4 md:px-6"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-bold">Recent arrivals</h3><Link href="/visitors" className="text-xs font-semibold text-[#287858] hover:underline">All visitors <span aria-hidden>→</span></Link></div>
            {recent.isError ? <button onClick={() => recent.refetch()} className="text-xs text-[#a84c3f] underline">Couldn’t load recent arrivals · retry</button> : recent.isLoading ? <div className="space-y-3">{[0,1,2].map((n) => <div key={n} className="skeleton h-10 rounded" />)}</div> : recent.data?.length ? <div className="divide-y divide-[#f0f1ed]">{recent.data.slice(0,4).map((visitor) => <VisitorLine key={visitor.id} visitor={visitor} />)}</div> : <div className="rounded-lg bg-[#f7f8f4] p-4 text-sm text-[#78868a]">No visits yet today. Register the first arrival on the right.</div>}
          </div>
        </section>
        <section className="panel self-start">
          <div className="border-b border-[#eef0eb] px-5 py-4 md:px-6"><div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#e8f3ec] text-[#287858]"><Sparkles size={16} /></span><div><div className="eyebrow">Quick desk action</div><h2 className="mt-0.5 font-serif text-lg font-bold">Check someone in</h2></div></div>
            <div className="mt-4 flex rounded-lg bg-[#f2f4ef] p-1"><button className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition ${mode === 'register' ? 'bg-white text-[#253c4e] shadow-sm' : 'text-[#78868a]'}`} onClick={() => {setMode('register');setNotice('');setAnswer(null);}}>Register visitor</button><button className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition ${mode === 'ask' ? 'bg-white text-[#253c4e] shadow-sm' : 'text-[#78868a]'}`} onClick={() => {setMode('ask');setNotice('');setReady(false);}}>Ask about visitors</button></div>
          </div>
          <div className="p-5 md:p-6">
            <form onSubmit={handleRequest}>
              <label htmlFor="quick-request" className="mb-2 block text-xs font-semibold text-[#41515e]">{mode === 'register' ? 'Describe the visit in plain language' : 'Ask a visitor question'}</label>
              <textarea id="quick-request" data-testid="input-natural-language" className="field min-h-[88px] resize-y text-sm" value={requestText} onChange={(e) => setRequestText(e.target.value)} placeholder={mode === 'register' ? 'Example: Maya Chen from Northstar Labs is here to meet Dr. Imani about research.' : 'Example: Who is still on campus?'} maxLength={mode === 'register' ? 1200 : 500} />
              <div className="mt-2 flex items-center justify-between text-[10px] text-[#879295]"><span>{mode === 'register' ? 'Typed text only · review before saving' : 'Uses approved visitor lookup queries'}</span><span className="data-mono">{requestText.length}/{mode === 'register' ? 1200 : 500}</span></div>
              <button className="btn-primary mt-3 w-full" type="submit" disabled={parse.isPending || ask.isPending}>{parse.isPending || ask.isPending ? <LoaderCircle className="animate-spin" size={15} /> : mode === 'register' ? <Plus size={15} /> : <Search size={15} />}{mode === 'register' ? 'Extract visitor details' : 'Search visitor records'}</button>
            </form>
            <div className="mt-4 flex gap-2 rounded-lg border border-[#e7e9e4] bg-[#fafaf7] p-3 text-[11px] leading-relaxed text-[#78868a]"><Shield size={14} className="mt-0.5 shrink-0 text-[#477860]" /><span><strong className="text-[#45565d]">Local rules parser, not an LLM.</strong> Extraction is conservative, only typed text is supported, and nothing is saved until you confirm.</span></div>
            {notice && <div role="status" className={`mt-3 rounded-lg px-3 py-2.5 text-xs leading-relaxed ${notice.startsWith('Visitor checked') ? 'bg-[#e9f5ed] text-[#276b4f]' : notice.startsWith('Please') || notice.startsWith('Name,') || notice.startsWith('The') || notice.startsWith('Check-in') ? 'bg-[#fff1ed] text-[#9e4d40]' : 'bg-[#edf4ef] text-[#49635a]'}`}>{notice}</div>}
            {ready && <form onSubmit={register} className="mt-4 border-t border-[#edf0eb] pt-4">
              <div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold text-[#304659]">Review visitor details</span><button type="button" aria-label="Discard draft" onClick={() => {setReady(false);setDraft(emptyVisitor);}} className="rounded p-1 text-[#819091] hover:bg-[#f0f2ed]"><X size={15} /></button></div>
              <div className="grid gap-2.5 sm:grid-cols-2">{([
                ['name','Visitor name'],['phone','Phone'],['email','Email'],['organization','Organization'],['purpose','Visit purpose'],['host','Host / person to see'],
              ] as const).map(([key,label]) => <label key={key} className="text-[11px] font-semibold text-[#607078]">{label}{['name','purpose','host'].includes(key) && <span className="text-[#bd5b4c]"> *</span>}<input data-testid={`input-visitor-${key}`} className="field mt-1 !py-2 text-xs" value={draft[key] ?? ''} onChange={(e) => changeDraft(key, e.target.value)} required={['name','purpose','host'].includes(key)} /></label>)}</div>
              <button className="btn-primary mt-4 w-full" type="submit" disabled={create.isPending}>{create.isPending ? <LoaderCircle className="animate-spin" size={15} /> : <Check size={15} />}Confirm check-in</button>
              {create.isError && <p className="mt-2 text-xs text-[#a84c3f]">The save failed; your draft is still here to retry.</p>}
            </form>}
            {answer && <div className="mt-4 rounded-lg border border-[#dce9df] bg-[#f4f8f3] p-3"><div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 shrink-0 text-[#39835f]" size={15} /><div><p className="text-sm font-semibold text-[#2d4b3e]">{answer.answer}</p><p className="mt-1 text-xs text-[#71817b]">{answer.count} matching visitor{answer.count === 1 ? '' : 's'}</p></div></div>{answer.visitors?.length > 0 && <div className="mt-3 divide-y divide-[#e4ebe3]">{answer.visitors.slice(0,4).map((v) => <VisitorLine key={v.id} visitor={v} compact />)}</div>}</div>}
          </div>
        </section>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#dfe6dd] bg-[#edf2e9] px-5 py-4"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-lg bg-white text-[#4f755d]"><BadgeCheck size={18} /></div><div><div className="text-sm font-bold text-[#334b42]">A clean, accountable arrival record</div><div className="mt-0.5 text-xs text-[#77867c]">Check-in times and staff actions are kept in the activity log.</div></div></div><Link href="/activity" className="btn-quiet !border-[#cdd9ce] !bg-transparent text-xs">Review activity <ChevronRight size={14} /></Link></div>
    </>}
  </>;
}

function VisitorLine({ visitor, compact = false }: { visitor: Visitor; compact?: boolean }) {
  const [selected, setSelected] = useState(false);
  const query = useGetVisitor(visitor.id, { query: { enabled: selected, queryKey: getGetVisitorQueryKey(visitor.id) } });
  return <div className={`py-2.5 ${compact ? '' : ''}`}>
    <button onClick={() => setSelected((current) => !current)} data-testid={`button-visitor-detail-${visitor.id}`} className="flex w-full items-center gap-3 text-left">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#eaf0eb] text-xs font-bold text-[#48705b]">{visitor.name.split(' ').map((part) => part[0]).slice(0,2).join('').toUpperCase()}</span>
      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-[#344657]">{visitor.name}</span><span className="mt-0.5 block truncate text-[10px] text-[#819091]">{visitor.purpose} · {visitor.host}</span></span>
      <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold ${visitor.status === 'inside' ? 'bg-[#e8f5ed] text-[#287858]' : 'bg-[#f0f1ed] text-[#818b8a]'}`}>{visitor.status === 'inside' ? 'On campus' : 'Departed'}</span>
    </button>
    {selected && <div className="ml-11 mt-2 rounded-lg bg-[#f6f7f3] p-3 text-[11px] text-[#68777d]">{query.isLoading ? 'Loading visitor details…' : query.isError ? <button onClick={() => query.refetch()} className="text-[#a84c3f] underline">Couldn’t load details · retry</button> : query.data ? <div className="grid gap-1 sm:grid-cols-2"><span>Phone: {query.data.phone || 'Not provided'}</span><span>Email: {query.data.email || 'Not provided'}</span><span>Organization: {query.data.organization || 'Not provided'}</span><span>Checked in: {formatDate(query.data.checkInAt)}</span></div> : 'No details available.'}</div>}
  </div>;
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Visitors() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'inside' | 'checked_out'>('');
  const [feedback, setFeedback] = useState('');
  const params = useMemo(() => ({ ...(search.trim() ? { search: search.trim() } : {}), ...(status ? { status } : {}), limit: 100 }), [search, status]);
  const list = useListVisitors(params, { query: { queryKey: getListVisitorsQueryKey(params) } });
  const checkout = useCheckoutVisitor();
  const doCheckout = (visitor: Visitor) => {
    if (!window.confirm(`Check ${visitor.name} out now?`)) return;
    setFeedback('');
    checkout.mutate({ id: visitor.id }, { onSuccess: () => { setFeedback(`${visitor.name} checked out.`); void qc.invalidateQueries({ queryKey: getListVisitorsQueryKey() }); void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); void qc.invalidateQueries({ queryKey: getListActivityQueryKey() }); }, onError: () => setFeedback(`Could not check out ${visitor.name}. Please retry.`) });
  };
  return <>
    <PageHeading kicker="Visitor register" title="People on campus" description="Search arrivals, review current status, and record departures." action={<div className="flex items-center gap-2 text-xs text-[#748187]"><ShieldCheck size={15} className="text-[#39835f]" /> Demo data only · sign-in is not enabled</div>} />
    <section className="panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[#eef0eb] p-4 md:flex-row md:items-center md:justify-between md:px-5">
        <div className="relative w-full md:max-w-[360px]"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a9697]" /><input data-testid="input-visitor-search" className="field !pl-9" placeholder="Search name, host, organization…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="flex items-center gap-2"><Filter size={15} className="text-[#859093]" /><select data-testid="select-visitor-status" className="field !w-auto min-w-[150px] !py-2 text-xs" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="">All statuses</option><option value="inside">On campus</option><option value="checked_out">Departed</option></select><span className="rounded-md bg-[#f2f4ef] px-2.5 py-2 text-[10px] text-[#6d7b7e]">Max 100</span></div>
      </div>
      {feedback && <div role="status" className={`border-b px-5 py-2 text-xs ${feedback.startsWith('Could') ? 'border-[#f0d8d2] bg-[#fff2ed] text-[#9e4d40]' : 'border-[#d9e9dc] bg-[#eff7f0] text-[#34724f]'}`}>{feedback}</div>}
      {list.isError ? <div className="p-5"><QueryProblem retry={() => list.refetch()} /></div> : list.isLoading ? <div className="space-y-3 p-5">{[0,1,2,3,4].map((n) => <div key={n} className="skeleton h-12 rounded" />)}</div> : !list.data?.length ? <div className="px-5 py-16 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#edf2e9] text-[#57836a]"><Users size={21} /></div><h3 className="mt-4 font-serif text-lg font-bold">{search || status ? 'No visitors match those filters' : 'No visitor records yet'}</h3><p className="mt-1 text-sm text-[#7b888a]">{search || status ? 'Try a different name or status.' : 'New arrivals registered from Overview will appear here.'}</p>{(search || status) && <button className="btn-quiet mt-4" onClick={() => {setSearch('');setStatus('');}}>Clear filters</button>}</div> : <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left"><thead><tr className="bg-[#f8f9f5] text-[10px] font-semibold tracking-[.1em] text-[#879194] uppercase"><th className="px-5 py-3">Visitor</th><th className="px-4 py-3">Visit purpose</th><th className="px-4 py-3">Host</th><th className="px-4 py-3">Check-in</th><th className="px-4 py-3">Status</th><th className="px-5 py-3 text-right">Action</th></tr></thead>
          <tbody className="divide-y divide-[#eff0ec]">{list.data.map((visitor) => <tr key={visitor.id} className="table-row" data-testid={`row-visitor-${visitor.id}`}><td className="px-5 py-3.5"><div className="flex items-center gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#eaf0eb] text-[10px] font-bold text-[#48705b]">{visitor.name.split(' ').map((part) => part[0]).slice(0,2).join('').toUpperCase()}</span><div><div className="text-xs font-semibold text-[#344657]">{visitor.name}</div><div className="mt-0.5 max-w-[180px] truncate text-[10px] text-[#899496]">{visitor.organization || 'Independent visitor'}</div></div></div></td><td className="px-4 py-3 text-xs text-[#596970]">{visitor.purpose}</td><td className="px-4 py-3 text-xs text-[#596970]">{visitor.host}</td><td className="data-mono px-4 py-3 text-[10px] text-[#728086]">{formatDate(visitor.checkInAt)}</td><td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold ${visitor.status === 'inside' ? 'bg-[#e8f5ed] text-[#287858]' : 'bg-[#f1f2ee] text-[#778181]'}`}><span className={`h-1.5 w-1.5 rounded-full ${visitor.status === 'inside' ? 'bg-[#4ca477]' : 'bg-[#9aa2a0]'}`} />{visitor.status === 'inside' ? 'On campus' : 'Departed'}</span></td><td className="px-5 py-3 text-right">{visitor.status === 'inside' ? <button disabled={checkout.isPending} onClick={() => doCheckout(visitor)} data-testid={`button-checkout-${visitor.id}`} className="btn-quiet !px-2.5 !py-1.5 text-[10px]"><LogOut size={13} />Check out</button> : <span className="text-[10px] text-[#a1aaa7]">{formatDate(visitor.checkOutAt)}</span>}</td></tr>)}</tbody></table>
        <div className="border-t border-[#eef0eb] px-5 py-3 text-[10px] text-[#879194]">Showing {list.data.length} record{list.data.length === 1 ? '' : 's'} {list.data.length === 100 ? '· refine your search to narrow results' : ''}</div>
      </div>}
    </section>
  </>;
}

function ActivityPage() {
  const activity = useListActivity({ limit: 100 }, { query: { queryKey: getListActivityQueryKey({ limit: 100 }) } });
  return <>
    <PageHeading kicker="Audit trail" title="Activity log" description="A read-only record of visitor arrivals, departures, and operational changes." action={<div className="flex items-center gap-2 rounded-lg border border-[#e0e6df] bg-white px-3 py-2 text-xs text-[#69797b]"><ShieldCheck size={15} className="text-[#39835f]" /> Read only</div>} />
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#eef0eb] px-5 py-4"><div><div className="eyebrow">Recorded events</div><h2 className="mt-1 font-serif text-lg font-bold">Latest staff activity</h2></div><span className="rounded-full bg-[#f2f4ef] px-2.5 py-1 text-[10px] text-[#778487]">Most recent first</span></div>
      {activity.isError ? <div className="p-5"><QueryProblem retry={() => activity.refetch()} /></div> : activity.isLoading ? <div className="space-y-4 p-5">{[0,1,2,3,4].map((n) => <div key={n} className="skeleton h-[55px] rounded" />)}</div> : !activity.data?.length ? <div className="px-5 py-16 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#edf2e9] text-[#57836a]"><ActivityIcon size={20} /></div><h3 className="mt-4 font-serif text-lg font-bold">No activity recorded</h3><p className="mt-1 text-sm text-[#7b888a]">Check-ins and check-outs will be listed here.</p></div> : <div className="divide-y divide-[#eef0eb]">{activity.data.map((event) => <article key={event.id} data-testid={`activity-event-${event.id}`} className="flex gap-4 px-5 py-4 transition-colors hover:bg-[#fafbf8]"><div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#eff4ef] text-[#39835f]"><ActivityIcon size={16} /></div><div className="min-w-0 flex-1"><div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center"><h3 className="text-sm font-semibold text-[#344657]">{event.action}</h3><time className="data-mono text-[10px] text-[#879194]">{formatDate(event.createdAt)}</time></div><p className="mt-1 text-xs text-[#6f7e82]"><span className="font-semibold text-[#435861]">{event.subject}</span><span className="mx-1.5 text-[#c0c7c1]">·</span>by {event.actor}</p>{event.details && Object.keys(event.details).length > 0 && <p className="mt-1.5 break-words text-[11px] text-[#879194]">{Object.entries(event.details).map(([key,value]) => `${key}: ${String(value)}`).join(' · ')}</p>}</div></article>)}</div>}
      {activity.data?.length === 100 && <div className="border-t border-[#eef0eb] px-5 py-3 text-[10px] text-[#879194]">Showing the latest 100 events.</div>}
    </div>
  </>;
}

const fieldChoices = [
  ['name','Visitor name'],['phone','Phone'],['email','Email'],['organization','Organization'],['purpose','Visit purpose'],['host','Host'],
] as const;
function SettingsPage() {
  const qc = useQueryClient();
  const config = useGetConfiguration({ query: { queryKey: getGetConfigurationQueryKey() } });
  const update = useUpdateConfiguration();
  const [organizationName, setOrganizationName] = useState('');
  const [requiredFields, setRequiredFields] = useState<string[]>([]);
  const [allowedPurposes, setAllowedPurposes] = useState<string[]>([]);
  const [purposeDraft, setPurposeDraft] = useState('');
  const [blockActiveDuplicates, setBlockActiveDuplicates] = useState(true);
  const [notice, setNotice] = useState('');
  const [initialized, setInitialized] = useState(false);
  if (config.data && !initialized) {
    setOrganizationName(config.data.organizationName); setRequiredFields(config.data.requiredFields); setAllowedPurposes(config.data.allowedPurposes); setBlockActiveDuplicates(config.data.blockActiveDuplicates); setInitialized(true);
  }
  const toggleRequired = (field: string) => setRequiredFields((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field]);
  const addPurpose = () => { const value = purposeDraft.trim(); if (!value) return; if (allowedPurposes.some((item) => item.toLowerCase() === value.toLowerCase())) { setNotice('That visit purpose is already listed.'); return; } setAllowedPurposes((current) => [...current, value]); setPurposeDraft(''); setNotice(''); };
  const save = (event: FormEvent) => {
    event.preventDefault(); setNotice('');
    if (!organizationName.trim()) { setNotice('Organization name is required.'); return; }
    if (!requiredFields.length) { setNotice('Choose at least one required visitor field.'); return; }
    if (!allowedPurposes.length) { setNotice('Add at least one allowed visit purpose.'); return; }
    const payload: ConfigurationInput = { organizationName: organizationName.trim(), requiredFields: requiredFields as ConfigurationInput['requiredFields'], allowedPurposes, blockActiveDuplicates };
    update.mutate({ data: payload }, { onSuccess: () => {setNotice('Settings saved successfully.'); void qc.invalidateQueries({ queryKey: getGetConfigurationQueryKey() });}, onError: () => setNotice('Settings could not be saved. Your changes are still here; try again.') });
  };
  if (config.isError) return <><PageHeading kicker="Workspace rules" title="Settings" description="Configure how visitors are registered." /><QueryProblem retry={() => config.refetch()} /></>;
  if (config.isLoading) return <><PageHeading kicker="Workspace rules" title="Settings" description="Configure how visitors are registered." /><div className="panel space-y-5 p-6"><div className="skeleton h-8 w-48 rounded" /><div className="skeleton h-24 rounded" /><div className="skeleton h-40 rounded" /></div></>;
  return <>
    <PageHeading kicker="Workspace rules" title="Settings" description="Configure how visitors are registered at this front desk." />
    <form onSubmit={save} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
      <div className="space-y-5">
        <section className="panel p-5 md:p-6"><div className="flex items-start gap-3"><div className="grid h-9 w-9 place-items-center rounded-lg bg-[#edf3ed] text-[#3e7558]"><Building2 size={17} /></div><div><div className="eyebrow">Workspace identity</div><h2 className="mt-1 font-serif text-lg font-bold">Organization name</h2><p className="mt-1 text-xs text-[#7b888a]">Used to identify this visitor desk across the workspace.</p></div></div><label className="mt-5 block max-w-lg text-xs font-semibold text-[#55666d]">Name<input data-testid="input-organization-name" className="field mt-1.5" maxLength={160} value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} /></label></section>
        <section className="panel p-5 md:p-6"><div className="eyebrow">Registration rules</div><h2 className="mt-1 font-serif text-lg font-bold">Required visitor details</h2><p className="mt-1 text-xs text-[#7b888a]">Fields staff must complete before a visitor can be checked in.</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{fieldChoices.map(([key,label]) => <label key={key} className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#e7eae4] px-3 py-3 transition hover:bg-[#f8faf6]"><input type="checkbox" checked={requiredFields.includes(key)} onChange={() => toggleRequired(key)} className="h-4 w-4 accent-[#287858]" /><span className="text-xs font-medium text-[#4d5f65]">{label}</span></label>)}</div></section>
        <section className="panel p-5 md:p-6"><div className="eyebrow">Visit taxonomy</div><h2 className="mt-1 font-serif text-lg font-bold">Allowed visit purposes</h2><p className="mt-1 text-xs text-[#7b888a]">Keep reasons for visiting consistent across the register.</p><div className="mt-4 flex flex-wrap gap-2">{allowedPurposes.map((purpose) => <span key={purpose} className="inline-flex items-center gap-2 rounded-full border border-[#dce5dc] bg-[#f4f7f2] py-1 pl-3 pr-1.5 text-xs text-[#4d6658]">{purpose}<button type="button" aria-label={`Remove ${purpose}`} onClick={() => setAllowedPurposes((items) => items.filter((item) => item !== purpose))} className="grid h-5 w-5 place-items-center rounded-full text-[#75877c] hover:bg-[#e5ece4]"><X size={12} /></button></span>)}{!allowedPurposes.length && <p className="text-xs text-[#9a6660]">At least one purpose is required.</p>}</div><div className="mt-4 flex max-w-lg gap-2"><input data-testid="input-new-purpose" className="field" placeholder="Add a purpose…" value={purposeDraft} maxLength={100} onChange={(e) => setPurposeDraft(e.target.value)} onKeyDown={(e) => {if (e.key === 'Enter') {e.preventDefault();addPurpose();}}} /><button type="button" className="btn-quiet shrink-0" onClick={addPurpose}><Plus size={15} />Add</button></div></section>
      </div>
      <aside className="space-y-4">
        <section className="panel p-5"><div className="flex items-start gap-3"><div className="grid h-9 w-9 place-items-center rounded-lg bg-[#f3eee2] text-[#98784a]"><ShieldCheck size={17} /></div><div><div className="eyebrow">Duplicate protection</div><h2 className="mt-1 font-serif text-base font-bold">Active visitor rule</h2></div></div><p className="mt-3 text-xs leading-relaxed text-[#748186]">Prevent a second active visit for someone who is already checked in.</p><label className="mt-4 flex cursor-pointer items-center justify-between rounded-lg bg-[#f7f8f4] p-3"><span className="text-xs font-semibold text-[#44575e]">Block active duplicates</span><input data-testid="toggle-active-duplicates" type="checkbox" checked={blockActiveDuplicates} onChange={(e) => setBlockActiveDuplicates(e.target.checked)} className="h-4 w-4 accent-[#287858]" /></label></section>
        <div className="rounded-xl border border-[#dfe6dd] bg-[#edf2e9] p-4"><div className="flex gap-2.5"><Shield size={15} className="mt-0.5 shrink-0 text-[#4b765e]" /><p className="text-[11px] leading-relaxed text-[#67796e]">Configuration changes apply to future check-ins. Existing visitor records remain unchanged.</p></div>{config.data?.updatedAt && <p className="mt-3 border-t border-[#dce5dc] pt-3 text-[10px] text-[#829087]">Last updated {formatDate(config.data.updatedAt)}</p>}</div>
        {notice && <div role="status" className={`rounded-lg p-3 text-xs leading-relaxed ${notice.includes('successfully') ? 'bg-[#e9f5ed] text-[#276b4f]' : 'bg-[#fff1ed] text-[#9e4d40]'}`}>{notice}</div>}
        <button type="submit" className="btn-primary w-full" disabled={update.isPending}>{update.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}Save settings</button>
      </aside>
    </form>
  </>;
}

function Routed() {
  return <AppFrame><Switch>
    <Route path="/" component={Dashboard} />
    <Route path="/visitors" component={Visitors} />
    <Route path="/activity" component={ActivityPage} />
    <Route path="/settings" component={SettingsPage} />
    <Route component={NotFound} />
  </Switch></AppFrame>;
}

function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Routed /></WouterRouter></QueryClientProvider>;
}

export default App;