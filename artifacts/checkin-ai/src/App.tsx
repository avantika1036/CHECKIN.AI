import { Fragment, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Route, Switch, Link, Redirect, useLocation, Router as WouterRouter } from 'wouter';
import {
  Activity, ArrowDownLeft, ArrowRight, AudioLines, Bell, Building2, Check,
  CheckCircle2, ChevronDown, ClipboardCheck, Clock3, DoorOpen, FileClock,
  Fingerprint, LayoutDashboard, Mic, Search, Settings2, Shield,
  ShieldCheck, Sparkles, UserRound, Users, X, XCircle, LogOut, CircleAlert,
  LoaderCircle, Send, Landmark, Home as HomeIcon, MessageSquareText,
} from 'lucide-react';
import {
  useHealthCheck, useListVisitorProfiles, useGetVisitorDashboard,
  useListVisitorVisits, useCreateVisitorVisit, useDecideVisitorVisit,
  useCheckInVisitor, useCheckOutVisitor, useListVisitorNotifications,
  useListVisitorAuditEvents, useCreateRegistrationDraft, useAskVisitorAnalytics,
  useTranscribeVisitorAudio,
  getGetVisitorDashboardQueryKey, getListVisitorVisitsQueryKey,
  getListVisitorNotificationsQueryKey, getListVisitorAuditEventsQueryKey,
  type OrganizationProfile, type VisitorVisit, type RegistrationDraft,
} from '@workspace/api-client-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false } },
});

function getApiErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('data' in error)) return;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || !('error' in data)) return;
  const message = (data as { error?: unknown }).error;
  return typeof message === 'string' && message.trim() ? message : undefined;
}

const guardNav = [
  { href: '/', title: 'Overview', icon: LayoutDashboard },
  { href: '/register', title: 'Register a visit', icon: DoorOpen },
  { href: '/visits', title: 'Visit log', icon: Users },
  { href: '/ask', title: 'Ask visit log', icon: MessageSquareText },
  { href: '/audit', title: 'Audit trail', icon: FileClock },
  { href: '/settings', title: 'Configuration', icon: Settings2 },
];
const hostNav = [
  { href: '/approvals', title: 'Host approvals', icon: ClipboardCheck },
  { href: '/visits', title: 'My visitors', icon: Users },
  { href: '/ask', title: 'Ask visit log', icon: MessageSquareText },
  { href: '/register', title: 'Pre-register a guest', icon: DoorOpen },
  { href: '/settings', title: 'Configuration', icon: Settings2 },
];
const navFor = (role: string) => (role === 'host' ? hostNav : guardNav);

type AppContext = { profiles: OrganizationProfile[]; profile?: OrganizationProfile; profileId: string; setProfileId: (v: string) => void; role: string; setRole: (v: string) => void; isHost: boolean; hostName: string; setHostName: (v: string) => void; hostOptions: string[]; actorName: string; allVisits: VisitorVisit[]; health: { status?: string; isError: boolean; isLoading: boolean } };
const Context = ({ children }: { children: (ctx: AppContext) => React.ReactNode }) => {
  const profilesQuery = useListVisitorProfiles();
  const healthQuery = useHealthCheck();
  const [profileId, setProfileId] = useState(() => localStorage.getItem('checkin-profile') || '');
  const [role, setRoleState] = useState(() => (localStorage.getItem('checkin-role') === 'host' ? 'host' : 'guard'));
  const setRole = (v: string) => { localStorage.setItem('checkin-role', v); setRoleState(v); };
  const [savedHost, setSavedHost] = useState(() => localStorage.getItem('checkin-host') || '');
  const setHostName = (v: string) => { localStorage.setItem('checkin-host', v); setSavedHost(v); };
  const profiles = profilesQuery.data ?? [];
  const effectiveId = profiles.some((p) => p.id === profileId) ? profileId : profiles[0]?.id ?? '';
  const profile = profiles.find((p) => p.id === effectiveId);
  const visitsQuery = useListVisitorVisits({ profileId: effectiveId }, { query: { enabled: !!effectiveId, queryKey: getListVisitorVisitsQueryKey({ profileId: effectiveId }), staleTime: 15_000, refetchInterval: 30_000 } });
  const allVisits = visitsQuery.data ?? [];
  const hostOptions = Array.from(new Set(allVisits.map((v) => v.hostName))).sort();
  const hostName = hostOptions.includes(savedHost) ? savedHost : hostOptions[0] ?? '';
  const isHost = role === 'host';
  const actorName = isHost ? hostName || profile?.notificationTarget || 'Host' : 'Front desk · Guard';
  return <>{children({ profiles, profile, profileId: effectiveId, setProfileId, role, setRole, isHost, hostName, setHostName, hostOptions, actorName, allVisits, health: { status: healthQuery.data?.status, isError: healthQuery.isError, isLoading: healthQuery.isLoading } })}</>;
};

function Shell({ ctx, children, title, eyebrow, subtitle }: { ctx: AppContext; children: React.ReactNode; title: string; eyebrow: string; subtitle: string }) {
  const [path] = useLocation();
  const { profile, profiles, profileId, setProfileId, role, setRole, isHost, hostName, setHostName, hostOptions, allVisits } = ctx;
  const [bellOpen, setBellOpen] = useState(false);
  const pendingList = isHost ? allVisits.filter((v) => v.status === 'awaiting_approval' && v.hostName === hostName) : allVisits.filter((v) => v.status === 'approved');
  const bellHref = isHost ? '/approvals' : '/visits';
  const activeProfileLabel = profile?.name ?? (profiles.length ? 'Choose organization' : 'Profiles unavailable');
  const actor = ctx.actorName;
  const HealthMark = ctx.health.isLoading ? LoaderCircle : ctx.health.isError ? CircleAlert : ShieldCheck;
  const healthText = ctx.health.isLoading ? 'Connecting to service' : ctx.health.isError ? 'Service unavailable' : `API ${ctx.health.status ?? 'online'}`;
  const healthTone = ctx.health.isError ? 'text-rose-700 bg-rose-50' : ctx.health.isLoading ? 'text-amber-800 bg-amber-50' : 'text-emerald-800 bg-emerald-50';
  return (
    <div className="app-grain min-h-[100dvh] bg-background text-foreground md:flex">
      <aside className="no-print flex w-full flex-col bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-[100dvh] md:w-[248px] md:shrink-0">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="grid h-10 w-10 place-items-center rounded-[13px] bg-[#E89A23] text-[#1B1513]"><Fingerprint size={22}/></div>
          <div><p className="font-display text-[19px] font-extrabold tracking-[-.06em]">checkIn<span className="text-[#E89A23]">.ai</span></p><p className="mono text-[9px] uppercase tracking-[.18em] text-sidebar-foreground/55">front desk control</p></div>
        </div>
        <div className="mx-4 mb-5 rounded-2xl border border-white/10 bg-white/[.045] p-3">
          <p className="mono mb-2 text-[9px] uppercase tracking-[.16em] text-sidebar-foreground/55">Active location</p>
          <div className="flex min-w-0 items-center gap-2"><Building2 size={15} className="shrink-0 text-[#E89A23]"/><select aria-label="Organization profile" data-testid="select-organization" value={profileId} onChange={(e) => { localStorage.setItem('checkin-profile', e.target.value); setProfileId(e.target.value); }} className="min-w-0 flex-1 appearance-none bg-transparent text-sm font-semibold text-sidebar-foreground outline-none">
            {profiles.length ? profiles.map((p) => <option key={p.id} value={p.id} className="text-slate-900">{p.name}</option>) : <option value="" className="text-slate-900">Loading profiles…</option>}
          </select><ChevronDown size={13} className="pointer-events-none -ml-5 text-sidebar-foreground/50"/></div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-col md:overflow-visible">
          {navFor(role).map(({ href, title: label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-nav-${href === '/' ? 'overview' : href.slice(1)}`} className={`nav-link flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium ${path === href ? 'bg-[#E89A23] text-[#1B1513]' : 'text-sidebar-foreground/70 hover:bg-white/[.07] hover:text-sidebar-foreground'}`}><Icon size={17}/><span>{label}</span>{href === '/approvals' && pendingList.length > 0 && <span className="ml-auto hidden rounded-full bg-[#E89A23] px-2 py-0.5 text-[10px] font-bold text-[#1B1513] md:inline">{pendingList.length}</span>}</Link>)}
        </nav>
        <div className="mt-auto hidden px-4 pb-5 md:block">
          <div className="rounded-2xl border border-white/10 bg-white/[.04] p-3">
            <div className="mb-3 flex items-center gap-2"><div className="grid h-8 w-8 place-items-center rounded-full bg-[#3a2c25] text-[#F5A020]"><UserRound size={15}/></div><div className="min-w-0"><p className="truncate text-xs font-semibold">{actor}</p><p className="text-[10px] text-sidebar-foreground/55">Demo session</p></div></div>
            <label className="mono mb-1 block text-[9px] uppercase tracking-[.14em] text-sidebar-foreground/50">Demo role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} data-testid="select-demo-role" className="w-full rounded-lg border border-white/10 bg-[#2a211d] px-2.5 py-2 text-xs text-sidebar-foreground outline-none"><option value="guard">Guard / front desk</option><option value="host">{profile?.hostLabel || 'Host'}</option></select>{isHost && <><label className="mono mb-1 mt-3 block text-[9px] uppercase tracking-[.14em] text-sidebar-foreground/50">Acting as</label><select value={hostName} onChange={(e) => setHostName(e.target.value)} data-testid="select-acting-host" className="w-full rounded-lg border border-white/10 bg-[#2a211d] px-2.5 py-2 text-xs text-sidebar-foreground outline-none">{hostOptions.length ? hostOptions.map((h) => <option key={h} value={h}>{h}</option>) : <option value="">No hosts yet</option>}</select></>}
          </div>
          <div className="mt-4 flex items-center gap-2 px-1 text-[10px] text-sidebar-foreground/55"><span className={`h-1.5 w-1.5 rounded-full ${ctx.health.isError ? 'bg-rose-400' : 'bg-[#E89A23]'}`}/>{healthText}</div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="relative z-30 border-b border-border/70 bg-[#f8f2e8]/80 px-5 py-5 backdrop-blur-sm md:px-9 md:py-6">
          <div className="mx-auto flex max-w-[1240px] items-end justify-between gap-4">
            <div className="min-w-0"><div className="mono mb-1.5 flex items-center gap-2 text-[9px] uppercase tracking-[.18em] text-muted-foreground"><span className="h-px w-5 bg-[#9E5611]"/>{eyebrow}</div><h1 className="font-display text-[29px] font-extrabold leading-tight tracking-[-.045em] md:text-[35px]">{title}</h1><p className="mt-1 max-w-xl text-[13px] text-muted-foreground">{subtitle}</p></div>
            <div className="relative hidden items-center gap-2 sm:flex">{(ctx.health.isError || ctx.health.isLoading) ? <span className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-semibold ${healthTone}`} data-testid="status-api-health"><HealthMark size={13} className={ctx.health.isLoading ? 'animate-spin' : ''}/>{healthText}</span> : <span title="Backend service is online and responding" className="flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground" data-testid="status-api-health"><span className="h-1.5 w-1.5 rounded-full bg-emerald-600"/>Live</span>}<button type="button" aria-label="Notifications" onClick={() => setBellOpen((o) => !o)} data-testid="button-notifications" className="relative grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"><Bell size={16}/>{pendingList.length > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#E89A23] px-1 text-[9px] font-bold text-[#1B1513]">{pendingList.length}</span>}</button>{bellOpen && <div className="absolute right-0 top-11 z-40 w-80 rounded-2xl border border-border bg-card p-3 shadow-xl" data-testid="panel-notifications"><p className="mono mb-2 px-1 text-[9px] uppercase tracking-[.16em] text-muted-foreground">{isHost ? `Waiting on you · ${hostName}` : 'Expected at the desk'}</p>{pendingList.length === 0 ? <p className="rounded-xl bg-secondary/70 p-3 text-xs text-muted-foreground">{isHost ? 'You\'re all caught up. Nothing is waiting for your decision.' : 'No approved visitors are waiting to be checked in.'}</p> : <div className="max-h-72 space-y-1.5 overflow-y-auto">{pendingList.slice(0, 6).map((v) => <Link key={v.id} href={bellHref} onClick={() => setBellOpen(false)} className="block rounded-xl border border-border p-2.5 hover:bg-secondary/60"><p className="text-xs font-bold">{v.visitorName} <span className="font-normal text-muted-foreground">{isHost ? 'needs your decision' : 'is cleared to enter'}</span></p><p className="mt-0.5 truncate text-[10px] text-muted-foreground">To {v.hostName} · {v.purpose} · {fmtTime(v.createdAt)}</p></Link>)}</div>}{pendingList.length > 0 && <Link href={bellHref} onClick={() => setBellOpen(false)} className="mt-2 flex items-center justify-center gap-1 rounded-lg bg-[#1B1513] px-3 py-2 text-[11px] font-bold text-white">{isHost ? 'Open host approvals' : 'Open visit log'} <ArrowRight size={12}/></Link>}</div>}</div>
          </div>
        </header>
        <div className="mx-auto max-w-[1240px] px-4 py-6 md:px-9 md:py-8">{ctx.health.isError && <div role="status" data-testid="status-api-warning" className="mb-5 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800"><CircleAlert size={15}/>The API connection is unavailable. Existing screens may be incomplete until service is restored.</div>}{children}</div>
        <div className="border-t border-border/60 px-5 py-4 text-center text-[10px] text-muted-foreground md:text-left md:px-9">checkIn.ai · visits should be clear, accountable, and quick.</div>
      </main>
    </div>
  );
}

const fmtTime = (date?: string | null) => date ? new Date(date).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const statusTitle = (status: string) => ({ awaiting_approval: 'Awaiting approval', approved: 'Approved', denied: 'Denied', checked_in: 'On site', checked_out: 'Checked out' }[status] ?? status);
const statusClasses = (status: string) => status === 'approved' || status === 'checked_in' ? 'bg-emerald-100 text-emerald-800' : status === 'denied' ? 'bg-rose-100 text-rose-800' : status === 'awaiting_approval' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700';
function Status({ status }: { status: string }) { return <span data-testid={`status-visit-${status}`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[.01em]`}><span className={`h-1.5 w-1.5 rounded-full ${status === 'checked_in' || status === 'approved' ? 'bg-emerald-600' : status === 'denied' ? 'bg-rose-500' : status === 'awaiting_approval' ? 'bg-amber-600' : 'bg-slate-500'}`}/><span className={statusClasses(status)}>{statusTitle(status)}</span></span>; }
function ErrorBox({ message, retry }: { message: string; retry?: () => void }) { return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" data-testid="state-error"><div className="flex items-center gap-2"><CircleAlert size={16}/>{message}</div>{retry && <button onClick={retry} className="mt-2 text-xs font-bold underline" data-testid="button-retry">Retry</button>}</div>; }
function Empty({ title, text }: { title: string; text: string }) { return <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/60 px-6 py-12 text-center" data-testid="state-empty"><div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-secondary text-[#9E5611]"><Shield size={19}/></div><p className="font-display text-lg font-bold">{title}</p><p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{text}</p></div>; }
function VisitRow({ visit, action }: { visit: VisitorVisit; action?: React.ReactNode }) { return <div className="grid grid-cols-1 gap-3 border-b border-border/70 py-4 last:border-0 sm:grid-cols-[minmax(190px,1.2fr)_minmax(180px,1fr)_minmax(150px,.85fr)_96px] sm:items-center" data-testid={`row-visit-${visit.id}`}><div className="flex items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#f8e6c8] text-[#9E5611]"><UserRound size={17}/></div><div className="min-w-0"><p className="truncate text-[13px] font-bold">{visit.visitorName}</p><p className="truncate text-[11px] text-muted-foreground">{visit.affiliation || 'Visitor'}{visit.groupSize && visit.groupSize > 1 ? ` · ${visit.groupSize} people` : ''}</p></div></div><div className="min-w-0"><p className="truncate text-xs font-semibold">{visit.purpose}</p><p className="truncate text-[10px] text-muted-foreground">To {visit.hostName}{visit.unitNumber ? ` · ${visit.unitNumber}` : ''}</p></div><div className="flex items-center justify-between gap-2 sm:block"><Status status={visit.status}/><p className="mt-1 text-[10px] text-muted-foreground sm:pl-1">{fmtTime(visit.createdAt)}</p></div><div className="flex min-h-9 min-w-0 items-center justify-end">{action}</div></div>; }
function PageFrame({ ctx, title, eyebrow, subtitle, children }: { ctx: AppContext; title: string; eyebrow: string; subtitle: string; children: React.ReactNode }) { return <Shell ctx={ctx} title={title} eyebrow={eyebrow} subtitle={subtitle}>{children}</Shell>; }

function Dashboard({ ctx }: { ctx: AppContext }) {
  const { profileId } = ctx;
  const dashboard = useGetVisitorDashboard({ profileId, dateRange: 'week' }, { query: { enabled: !!profileId, queryKey: getGetVisitorDashboardQueryKey({ profileId, dateRange: 'week' }) } });
  const analytics = useAskVisitorAnalytics();
  const transcribeAudio = useTranscribeVisitorAudio();
  const qc = useQueryClient();
  const [question, setQuestion] = useState('');
  const [askResult, setAskResult] = useState<{ answer: string; metric: string; value: number } | null>(null);
  const [recording, setRecording] = useState(false);
  const [requestingMic, setRequestingMic] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceError, setVoiceError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartedRef = useRef(0);
  const discardRecordingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      discardRecordingRef.current = true;
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  const stopVoice = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    recordingTimerRef.current = null;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    setRecording(false);
  };
  const startVoice = async () => {
    if (requestingMic || recording || transcribeAudio.isPending || analytics.isPending) return;
    setVoiceError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceError('Audio recording is not supported by this browser. Type your question instead.');
      return;
    }
    const mimeType = typeof MediaRecorder.isTypeSupported === 'function'
      ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type))
      : undefined;
    if (!mimeType) {
      setVoiceError('This browser does not support a compatible audio format. Type your question instead.');
      return;
    }
    setRequestingMic(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      discardRecordingRef.current = false;
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      recorder.onerror = () => {
        discardRecordingRef.current = true;
        setVoiceError('Audio capture stopped unexpectedly. You can type your question instead.');
        stopVoice();
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        if (!mountedRef.current || discardRecordingRef.current) return;
        const audio = new Blob(chunks, { type: recorder.mimeType || mimeType });
        if (!audio.size) {
          setVoiceError('No audio was captured. Check your microphone and try again.');
          return;
        }
        transcribeAudio.mutate({ data: { file: audio } }, {
          onSuccess: (result) => {
            if (!mountedRef.current) return;
            const transcript = result.transcript.trim();
            if (!transcript) {
              setVoiceError('No speech was detected. Try again or type your question.');
              return;
            }
            setQuestion((previous) => `${previous.trim()}${previous.trim() ? ' ' : ''}${transcript}`);
            setVoiceError('');
          },
          onError: (error) => {
            if (mountedRef.current) setVoiceError(getApiErrorMessage(error) ?? 'Transcription could not be completed. Your typed question is still available.');
          },
        });
      };
      recorder.start();
      recordingStartedRef.current = Date.now();
      setRecordingSeconds(0);
      setRecording(true);
      recordingTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartedRef.current) / 1000);
        setRecordingSeconds(Math.min(elapsed, 29));
        if (elapsed >= 29) stopVoice();
      }, 250);
    } catch (error) {
      discardRecordingRef.current = true;
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      setRecording(false);
      setVoiceError(error instanceof Error && error.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Allow access and try again, or type your question.'
        : 'Could not start the microphone. Check your device and try again.');
    } finally {
      if (mountedRef.current) setRequestingMic(false);
    }
  };
  const voiceBusy = requestingMic || recording || transcribeAudio.isPending;
  const data = dashboard.data;
  const maxCount = Math.max(1, ...(data?.activity.map((a) => a.count) ?? [1]));
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const hours = [7, 9, 11, 13, 15, 17, 19];
  const heatMap = data?.activity ?? [];
  const ask = () => { if (voiceBusy || analytics.isPending || !question.trim() || !profileId) return; setAskResult(null); analytics.mutate({ data: { profileId, question: question.trim() } }, { onSuccess: (answer) => setAskResult(answer), onError: (err) => setAskResult({ answer: getApiErrorMessage(err) ?? 'Could not complete that query. Please try again.', metric: '', value: 0 }) }); };
  return <PageFrame ctx={ctx} title="The front desk, at a glance." eyebrow="Live overview / 01" subtitle={`${ctx.profile?.description || 'A clear view of arrivals, approvals, and who is currently inside.'} · Week view`}>
    {!profileId ? <div className="py-8"><ErrorBox message="Organization profiles could not be loaded." retry={() => qc.invalidateQueries()}/></div> : dashboard.isError ? <ErrorBox message="Arrival activity could not be loaded." retry={() => dashboard.refetch()}/> : <div className="fade-up space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[{ label: 'Visits this week', value: data?.totalVisits, icon: Activity, note: `${(data?.weeklyChangePercent ?? 0) >= 0 ? '+' : ''}${data?.weeklyChangePercent ?? 0}% vs previous`, tone: 'text-[#9E5611]' }, { label: 'Currently inside', value: data?.currentlyInside, icon: DoorOpen, note: 'Live occupancy', tone: 'text-[#9E5611]' }, { label: 'Need a decision', value: data?.pendingApprovals, icon: ClipboardCheck, note: 'Waiting on assigned host', tone: 'text-[#C27A12]' }, { label: 'Denied today', value: data?.deniedToday, icon: XCircle, note: 'Recorded decisions', tone: 'text-[#b35149]' }].map(({ label, value, icon: Icon, note, tone }) => <section key={label} className="surface min-h-[130px] p-4 md:p-5" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}><div className="flex items-start justify-between"><p className="text-[11px] font-semibold text-muted-foreground">{label}</p><Icon size={17} className={tone}/></div>{dashboard.isLoading || dashboard.isFetching ? <><Skeleton className="mt-3 h-8 w-16"/><Skeleton className="mt-2 h-3 w-28"/></> : <><p className="font-display mt-2 text-[29px] font-extrabold tracking-[-.04em]">{value ?? '—'}</p><p className="mt-1 text-[10px] text-muted-foreground">{note}</p></>}</section>)}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.55fr_.9fr]">
        <section className="surface p-5 md:p-6" data-testid="chart-arrival-activity"><div className="mb-5 flex items-start justify-between"><div><p className="mono text-[9px] uppercase tracking-[.16em] text-[#9E5611]">Arrival rhythm</p><h2 className="font-display mt-1 text-xl font-extrabold tracking-[-.03em]">Weekday × hour</h2></div><div className="rounded-lg bg-secondary px-2.5 py-1.5 text-[10px] text-muted-foreground">Peak · {data?.peakWindow || '—'}</div></div>
          {dashboard.isLoading || dashboard.isFetching ? <Skeleton className="h-[190px] w-full"/> : !heatMap.length ? <Empty title="No arrival pattern yet" text="Activity will appear here as visits are registered."/> : <div className="overflow-x-auto"><div className="min-w-[430px]"><div className="grid grid-cols-[36px_repeat(7,minmax(0,1fr))] items-center gap-1.5"><span/>{days.map((day) => <span className="text-center mono text-[9px] text-muted-foreground" key={day}>{day}</span>)}{hours.map((hour) => <Fragment key={hour}><span className="mono text-[9px] text-muted-foreground">{hour > 12 ? `${hour - 12}p` : `${hour}a`}</span>{days.map((day) => { const cell = heatMap.find((c) => c.weekday === day && c.hour >= hour && c.hour < hour + 2); const intensity = cell ? Math.max(.12, cell.count / maxCount) : .06; return <div key={`${day}-${hour}`} title={`${day} ${hour}:00 · ${cell?.count ?? 0} arrivals`} data-testid={`activity-cell-${day.toLowerCase()}-${hour}`} className="heat-cell h-6 rounded-[5px]" style={{ backgroundColor: `rgba(232,154,35,${intensity})` }}/>})}</Fragment>)}</div><div className="mt-4 flex items-center justify-end gap-1.5 text-[9px] text-muted-foreground"><span>Quiet</span>{[.08,.24,.45,.7,1].map((v) => <span key={v} className="h-2.5 w-3 rounded-sm" style={{backgroundColor:`rgba(232,154,35,${v})`}}/>)}<span>Busy</span></div></div></div>}
        </section>
        <section className="surface overflow-hidden p-5 md:p-6" data-testid="panel-recent-visits"><div className="mb-4 flex items-end justify-between"><div><p className="mono text-[9px] uppercase tracking-[.16em] text-[#9E5611]">At the desk</p><h2 className="font-display mt-1 text-xl font-extrabold tracking-[-.03em]">Recent visits</h2></div><Link href="/visits" className="flex items-center gap-1 text-[10px] font-bold text-[#9E5611]" data-testid="link-all-visits">All visits <ArrowRight size={13}/></Link></div>
          {dashboard.isLoading || dashboard.isFetching ? <div className="space-y-4">{[1,2,3].map((n)=><Skeleton key={n} className="h-12 w-full"/>)}</div> : !data?.recentVisits?.length ? <Empty title="A quiet lobby" text="New registrations will show here."/> : <div>{data.recentVisits.slice(0,5).map((v) => <div key={v.id} className="border-b border-border/70 py-3 last:border-0" data-testid={`recent-visit-${v.id}`}><div className="flex items-center justify-between gap-2"><p className="truncate text-xs font-bold">{v.visitorName}</p><Status status={v.status}/></div><p className="mt-1 truncate text-[10px] text-muted-foreground">{v.purpose} · {fmtTime(v.createdAt)}</p></div>)}</div>}
        </section>
      </div>
      <section className="relative overflow-hidden rounded-2xl bg-[#2a211c] p-5 text-[#f5ede0] md:flex md:items-center md:gap-6 md:p-6" data-testid="panel-analytics-query"><div className="absolute -right-8 -top-16 h-48 w-48 rounded-full border border-[#e6c48a]/15"/><div className="relative mb-4 md:mb-0 md:w-[260px]"><div className="mb-2 flex items-center gap-2 text-[#F5A020]"><Sparkles size={15}/><span className="mono text-[9px] uppercase tracking-[.15em]">Ask the visit log</span></div><p className="font-display text-xl font-bold leading-tight">A quick question.<br/>A grounded answer.</p><p className="mt-2 text-[10px] text-white/65">Answers use approved, read-only visit metrics.</p></div><div className="relative flex-1"><div className="flex gap-2"><input value={question} onChange={(e)=>setQuestion(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter')ask()}} placeholder="e.g. Who checked in last? Who is inside right now?" data-testid="input-analytics-question" className="h-11 min-w-0 flex-1 rounded-xl border border-white/20 bg-white/[.1] px-3 text-xs text-white outline-none placeholder:text-white/50 focus:border-[#F5A020]"/><button type="button" onClick={recording ? stopVoice : startVoice} disabled={analytics.isPending || (!recording && (requestingMic || transcribeAudio.isPending))} aria-label={recording ? 'Stop voice question recording' : 'Ask by voice'} aria-pressed={recording} title={recording ? 'Stop recording' : 'Ask by voice'} data-testid="button-voice-analytics" className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/20 transition disabled:opacity-50 ${recording ? 'bg-rose-500/20 text-rose-200' : 'bg-white/[.1] text-white hover:border-[#F5A020] hover:text-[#F5A020]'}`}><Mic size={16}/></button><button onClick={ask} disabled={analytics.isPending || voiceBusy || !question.trim()} data-testid="button-ask-analytics" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#F5A020] text-[#1B1513] disabled:opacity-50">{analytics.isPending?<LoaderCircle size={17} className="animate-spin"/>:<Send size={16}/>}</button></div><p className={`mt-2 min-h-4 text-[10px] ${voiceError ? 'text-rose-200' : 'text-white/65'}`} role={voiceError ? 'alert' : 'status'} aria-live="polite">{voiceError || (recording ? `Recording · 0:${String(recordingSeconds).padStart(2, '0')} / 0:29 · Select the mic to finish.` : requestingMic ? 'Waiting for microphone permission…' : transcribeAudio.isPending ? 'Transcribing your question…' : 'Type a question or use the mic to speak.')}</p>{askResult && <div className="mt-3 rounded-xl border border-white/15 bg-white/[.1] p-3 text-xs leading-relaxed" data-testid="result-analytics-answer"><span className="font-bold text-[#F5A020]">{askResult.metric && `${askResult.metric}: ${askResult.value} · `}</span>{askResult.answer}</div>}</div></section>
    </div>}
  </PageFrame>;
}

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function AskVisitLog({ ctx }: { ctx: AppContext }) {
  const analytics = useAskVisitorAnalytics();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ answer: string; metric: string; value: number } | null>(null);
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('checkin-analytics-history') || '[]');
      return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string').slice(0, 5) : [];
    } catch {
      return [];
    }
  });
  const examples = ['Who checked in last?', 'Who is inside right now?', 'How many visits were registered today?', 'What is the busiest arrival hour?'];
  const ask = (value = question) => {
    const trimmed = value.trim();
    if (!trimmed || analytics.isPending || !ctx.profileId) return;
    setQuestion(trimmed);
    setError('');
    analytics.mutate({ data: { profileId: ctx.profileId, question: trimmed } }, {
      onSuccess: (result) => {
        setAnswer(result);
        setHistory((current) => {
          const next = [trimmed, ...current.filter((item) => item !== trimmed)].slice(0, 5);
          localStorage.setItem('checkin-analytics-history', JSON.stringify(next));
          return next;
        });
      },
      onError: (err) => {
        setAnswer(null);
        setError(getApiErrorMessage(err) ?? 'The visit log could not answer that question. Try another query.');
      },
    });
  };
  const toggleListening = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognitionConstructor = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!recognitionConstructor) {
      setError('Voice questions are not supported by this browser. Type your question instead.');
      return;
    }
    const recognition = new recognitionConstructor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-IN';
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? '').join(' ').trim();
      if (transcript) setQuestion((current) => `${current.trim()}${current.trim() ? ' ' : ''}${transcript}`);
    };
    recognition.onerror = () => { setListening(false); setError('Voice capture could not be completed. You can type your question instead.'); };
    recognition.onend = () => { setListening(false); recognitionRef.current = null; };
    recognitionRef.current = recognition;
    setError('');
    setListening(true);
    recognition.start();
  };
  useEffect(() => () => recognitionRef.current?.stop(), []);
  return <PageFrame ctx={ctx} title="Ask the visit log." eyebrow="Operational intelligence / 06" subtitle="Ask a grounded question about arrivals, approvals, and occupancy. Answers are read-only and based on the active location.">
    <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
      <section className="surface overflow-hidden p-5 md:p-7" data-testid="panel-ask-visit-log">
        <div className="flex items-start justify-between gap-4">
          <div><div className="flex items-center gap-2 text-[#9E5611]"><Sparkles size={16}/><span className="mono text-[9px] uppercase tracking-[.16em]">Ask the visit log</span></div><h2 className="font-display mt-2 text-2xl font-extrabold tracking-[-.04em]">What do you need to know?</h2><p className="mt-2 max-w-lg text-xs leading-relaxed text-muted-foreground">Use natural language. The answer is calculated from the visit register for {ctx.profile?.name || 'this location'}.</p></div>
          <div className="hidden h-12 w-12 shrink-0 place-items-center rounded-2xl bg-secondary text-[#9E5611] sm:grid"><MessageSquareText size={21}/></div>
        </div>
        <div className="mt-6 rounded-2xl border border-[#e2d5bf] bg-[#f6efe4] p-4 md:p-5">
        <label htmlFor="ask-visit-log-question" className="mono text-[9px] uppercase tracking-[.15em] text-[#9E5611]">Your question</label>
        <textarea id="ask-visit-log-question" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ask(); } }} placeholder="e.g. Who is inside right now?" rows={4} data-testid="input-ask-visit-log" className="mt-3 w-full resize-none rounded-xl border border-[#d9cdbb] bg-[#fffdfa] p-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-[#C27A12]"/>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-[10px] text-muted-foreground">Press Enter to ask · Shift + Enter for a new line</p><div className="flex gap-2"><button type="button" onClick={toggleListening} disabled={analytics.isPending} data-testid="button-ask-voice" className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-bold transition ${listening ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-[#d9cdbb] bg-[#fffdfa] text-foreground hover:border-[#C27A12] hover:text-[#9E5611]'}`}><Mic size={14}/>{listening ? 'Listening…' : 'Speak'}</button><button type="button" onClick={() => ask()} disabled={analytics.isPending || !question.trim()} data-testid="button-submit-ask-visit-log" className="flex items-center gap-2 rounded-xl bg-[#F5A020] px-4 py-2 text-[10px] font-bold text-[#1B1513] disabled:opacity-50">{analytics.isPending ? <LoaderCircle size={14} className="animate-spin"/> : <Send size={14}/>}Ask</button></div></div>
        </div>
        {(error || listening) && <p className={`mt-3 text-xs ${error ? 'text-rose-700' : 'text-muted-foreground'}`} role={error ? 'alert' : 'status'}>{error || 'Listening for your question…'}</p>}
        {answer && <div className="mt-5 rounded-2xl border border-[#d9c28f] bg-[#f4eddc] p-4 md:p-5" data-testid="result-ask-visit-log"><div className="flex items-start justify-between gap-3"><div><p className="mono text-[9px] uppercase tracking-[.15em] text-[#9E5611]">Answer</p><p className="mt-2 text-sm font-semibold leading-relaxed">{answer.answer}</p></div><CheckCircle2 size={19} className="shrink-0 text-emerald-700"/></div>{answer.metric && <p className="mt-4 border-t border-[#d9c28f] pt-3 text-[10px] font-bold text-[#725a2e]">{answer.metric.replaceAll('_', ' ')} · {answer.value}</p>}</div>}
      </section>
      <aside className="space-y-4">
        <section className="surface p-5"><p className="mono text-[9px] uppercase tracking-[.15em] text-[#9E5611]">Try asking</p><div className="mt-3 space-y-2">{examples.map((example) => <button key={example} type="button" onClick={() => { setQuestion(example); ask(example); }} className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-3 text-left text-xs font-semibold transition hover:border-primary hover:bg-secondary"><span>{example}</span><ArrowRight size={14} className="shrink-0 text-[#9E5611]"/></button>)}</div></section>
        <section className="surface p-5"><div className="flex items-center justify-between"><p className="mono text-[9px] uppercase tracking-[.15em] text-[#9E5611]">Recent questions</p>{history.length > 0 && <button type="button" onClick={() => { setHistory([]); localStorage.removeItem('checkin-analytics-history'); }} className="text-[10px] font-bold text-muted-foreground hover:text-foreground">Clear</button>}</div>{history.length ? <div className="mt-3 space-y-2">{history.map((item) => <button key={item} type="button" onClick={() => { setQuestion(item); ask(item); }} className="w-full rounded-lg bg-secondary/70 px-3 py-2 text-left text-[11px] leading-relaxed text-muted-foreground hover:text-foreground">{item}</button>)}</div> : <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Your recent questions will appear here for quick follow-up.</p>}</section>
        <section className="rounded-2xl border border-[#d9c28f] bg-[#f4eddc] p-4"><p className="flex items-center gap-2 text-xs font-bold text-[#725a2e]"><ShieldCheck size={15}/>Read-only answers</p><p className="mt-2 text-[10px] leading-relaxed text-[#756a54]">This assistant can explain recorded activity, but it never changes visit status or edits the audit trail.</p></section>
      </aside>
    </div>
  </PageFrame>;
}

function Registration({ ctx }: { ctx: AppContext }) {
  const draftMutation = useCreateRegistrationDraft();
  const createVisit = useCreateVisitorVisit();
  const decideVisit = useDecideVisitorVisit();
  const transcribeAudio = useTranscribeVisitorAudio();
  const qc = useQueryClient();
  const [utterance, setUtterance] = useState('');
  const [draft, setDraft] = useState<RegistrationDraft | null>(null);
  const [createdVisit, setCreatedVisit] = useState<VisitorVisit | null>(null);
  const [form, setForm] = useState({ visitorName: '', affiliation: '', hostName: '', purpose: '', unitNumber: '', groupSize: '1', visitSlot: '' });
  const [recording, setRecording] = useState(false);
  const [requestingMic, setRequestingMic] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceError, setVoiceError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartedRef = useRef(0);
  const discardRecordingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      discardRecordingRef.current = true;
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  const update = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const stopVoice = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    recordingTimerRef.current = null;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    setRecording(false);
  };
  const startVoice = async () => {
    if (requestingMic || recording || transcribeAudio.isPending) return;
    setVoiceError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setVoiceError('Audio recording is not supported by this browser. Type your request instead.');
      return;
    }
    const mimeType = typeof MediaRecorder.isTypeSupported === 'function'
      ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type))
      : undefined;
    if (!mimeType) {
      setVoiceError('This browser does not support a compatible audio format. Type your request instead.');
      return;
    }
    setRequestingMic(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      discardRecordingRef.current = false;
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      recorder.onerror = () => {
        discardRecordingRef.current = true;
        setVoiceError('Audio capture stopped unexpectedly. You can continue by typing.');
        stopVoice();
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        if (!mountedRef.current || discardRecordingRef.current) return;
        const audio = new Blob(chunks, { type: recorder.mimeType || mimeType });
        if (!audio.size) {
          setVoiceError('No audio was captured. Check your microphone and try again.');
          return;
        }
        transcribeAudio.mutate({ data: { file: audio } }, {
          onSuccess: (result) => {
            const transcript = result.transcript.trim();
            if (!transcript) {
              setVoiceError('No speech was detected. Try again or type your request.');
              return;
            }
            setUtterance((previous) => `${previous.trim()}${previous.trim() ? ' ' : ''}${transcript}`);
            setVoiceError('');
          },
          onError: (error) => setVoiceError(getApiErrorMessage(error) ?? 'Transcription could not be completed. Your typed request is still available. Try recording again.')
        });
      };
      recorder.start();
      recordingStartedRef.current = Date.now();
      setRecordingSeconds(0);
      setRecording(true);
      recordingTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartedRef.current) / 1000);
        setRecordingSeconds(Math.min(elapsed, 29));
        if (elapsed >= 29) stopVoice();
      }, 250);
    } catch (error) {
      discardRecordingRef.current = true;
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      recorderRef.current = null;
      if (!mountedRef.current) return;
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');
      setVoiceError(denied
        ? 'Microphone permission was denied. Allow microphone access in browser settings or type your request.'
        : 'The microphone could not be opened. Check your device and type your request if needed.');
    } finally {
      if (mountedRef.current) setRequestingMic(false);
    }
  };
  const extract = () => { if (utterance.trim().length < 3 || !ctx.profileId) return; setCreatedVisit(null); setVoiceError(''); draftMutation.mutate({ data: { profileId: ctx.profileId, utterance: utterance.trim() } }, { onSuccess: (d) => { setVoiceError(''); setDraft(d); setForm({ visitorName: d.visitorName ?? '', affiliation: d.affiliation ?? '', hostName: ctx.isHost ? ctx.hostName : d.hostName ?? '', purpose: d.purpose ?? '', unitNumber: d.unitNumber ?? '', groupSize: String(d.groupSize ?? 1), visitSlot: d.visitSlot ?? '' }); }, onError: (err) => setVoiceError(getApiErrorMessage(err) ?? 'We could not parse that request. Refine the wording and try again.') }); };
  const requiredValue = (field: string) => {
    const key = field.toLowerCase().replace(/[^a-z]/g, '');
    const lookup: Record<string, keyof typeof form> = { visitor: 'visitorName', visitorname: 'visitorName', name: 'visitorName', affiliation: 'affiliation', host: 'hostName', hostname: 'hostName', purpose: 'purpose', unit: 'unitNumber', unitnumber: 'unitNumber', group: 'groupSize', groupsize: 'groupSize', visitslot: 'visitSlot', time: 'visitSlot' };
    return form[lookup[key]] || '';
  };
  const missingRequired = (ctx.profile?.requiredFields ?? []).filter((field) => !requiredValue(field).trim());
  const confirm = () => { if (!ctx.profileId) return; createVisit.mutate({ data: { profileId: ctx.profileId, visitorName: form.visitorName.trim(), affiliation: form.affiliation.trim() || undefined, hostName: form.hostName.trim(), purpose: form.purpose.trim(), unitNumber: form.unitNumber.trim() || undefined, groupSize: Number(form.groupSize) || 1, visitSlot: form.visitSlot.trim() || undefined, createdBy: ctx.actorName } }, { onSuccess: (visit) => { setVoiceError(''); setCreatedVisit(visit); if (ctx.isHost) decideVisit.mutate({ visitId: visit.id, data: { action: 'allow', actorName: ctx.hostName, note: 'Pre-registered by host' } }, { onSuccess: (approved) => setCreatedVisit(approved), onSettled: () => { qc.invalidateQueries({ queryKey: getListVisitorVisitsQueryKey({ profileId: ctx.profileId }) }); qc.invalidateQueries({ queryKey: getListVisitorAuditEventsQueryKey({ profileId: ctx.profileId, limit: 50 }) }); qc.invalidateQueries({ queryKey: getGetVisitorDashboardQueryKey({ profileId: ctx.profileId, dateRange: 'week' }) }); } }); qc.invalidateQueries({ queryKey: getGetVisitorDashboardQueryKey({ profileId: ctx.profileId, dateRange: 'week' }) }); qc.invalidateQueries({ queryKey: getListVisitorVisitsQueryKey({ profileId: ctx.profileId }) }); qc.invalidateQueries({ queryKey: getListVisitorAuditEventsQueryKey({ profileId: ctx.profileId, limit: 50 }) }); setDraft(null); setUtterance(''); setForm({ visitorName:'',affiliation:'',hostName:ctx.isHost ? ctx.hostName : '',purpose:'',unitNumber:'',groupSize:'1',visitSlot:'' }); }, onError: () => setVoiceError('This visit could not be saved. Check required fields and try again.') }); };
  const fieldLabel = (field: string) => field.replace(/([A-Z])/g, ' $1').replace(/^./, (x) => x.toUpperCase());
  return <PageFrame ctx={ctx} title={ctx.isHost ? 'Pre-register a guest.' : 'Register a visit.'} eyebrow={ctx.isHost ? 'Expected guest / 02' : 'Visit intake / 02'} subtitle={ctx.isHost ? `Tell us who is coming. As ${ctx.hostName}, your guests are approved automatically — the front desk only checks them in.` : 'Say it or type it. Review every extracted detail before it enters the visit log.'}>
    {!ctx.profileId ? <Empty title="Select an organization" text="Visitor registration needs an active profile."/> : <div className="grid gap-5 xl:grid-cols-[.95fr_1.05fr]">
      <section className="surface p-5 md:p-7" data-testid="panel-registration-request"><div className="flex items-center gap-2 text-[#9E5611]"><AudioLines size={17}/><span className="mono text-[9px] uppercase tracking-[.17em]">One request, structured</span></div><h2 className="font-display mt-3 text-[24px] font-extrabold leading-tight tracking-[-.04em]">What brings your visitor in?</h2><p className="mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">Include a name, who they are seeing, and why. We’ll pull out the details for your review.</p>
        <div className="mt-6 rounded-2xl border border-border bg-[#f8f1e6] p-3.5 focus-within:border-primary/50"><div className="mb-2 flex items-center justify-between"><span className="mono text-[9px] uppercase tracking-[.14em] text-muted-foreground">Voice or text</span><button type="button" onClick={recording ? stopVoice : startVoice} disabled={requestingMic || transcribeAudio.isPending} data-testid="button-start-voice" className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold disabled:opacity-60 ${recording?'bg-rose-100 text-rose-700':'bg-white text-[#9E5611] shadow-sm'}`}><Mic size={13}/>{recording ? `Stop · 0:${String(recordingSeconds).padStart(2,'0')}` : requestingMic ? 'Microphone access…' : transcribeAudio.isPending ? 'Transcribing…' : 'Record request'}</button></div><textarea value={utterance} onChange={(e)=>setUtterance(e.target.value)} rows={6} placeholder="For example: Maya Chen from Northstar Labs is visiting Professor Reed in the Engineering building at 2 pm for a project review." data-testid="input-registration-utterance" className="w-full resize-none bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/70"/><div className="mt-2 flex items-center justify-between border-t border-border/70 pt-3"><span className="text-[10px] text-muted-foreground">{voiceError || (recording ? `Recording · ${29 - recordingSeconds} seconds maximum` : requestingMic ? 'Waiting for microphone permission…' : transcribeAudio.isPending ? 'Transcribing audio. Saaras v3 detects the language automatically…' : 'Type a request, or record up to 29 seconds.')}</span><button onClick={extract} disabled={draftMutation.isPending || recording || requestingMic || transcribeAudio.isPending || utterance.trim().length < 3} data-testid="button-extract-fields" className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground disabled:opacity-50">{draftMutation.isPending?<LoaderCircle size={15} className="animate-spin"/>:<Sparkles size={15}/>}Extract details</button></div></div>
        {draft && <div className="mt-4 rounded-xl border border-border bg-card p-4" data-testid="panel-agent-trace"><div className="mb-3 flex items-center justify-between"><p className="flex items-center gap-2 text-xs font-bold"><ShieldCheck size={14} className="text-[#9E5611]"/>Validation trace</p><span className="mono text-[9px] text-muted-foreground">{Math.round(draft.confidence * 100)}% confidence</span></div><div className="space-y-2">{draft.agentTrace.map((step, i)=><div className="flex items-center gap-2 text-[10px]" key={`${step.agent}-${i}`}><span className={`grid h-5 w-5 place-items-center rounded-full ${step.status==='completed'?'bg-emerald-100 text-emerald-700':step.status==='waiting'?'bg-amber-100 text-amber-800':'bg-rose-100 text-rose-700'}`}>{step.status==='completed'?<Check size={11}/>:step.status==='waiting'?<Clock3 size={11}/>:<X size={11}/>}</span><span className="font-bold">{step.agent}</span><span className="text-muted-foreground">{step.detail}</span></div>)}</div></div>}
      </section>
      <section className="surface p-5 md:p-7" data-testid="panel-review-fields"><div className="flex items-start justify-between gap-3"><div><div className="mono text-[9px] uppercase tracking-[.17em] text-[#9E5611]">Review before saving</div><h2 className="font-display mt-2 text-xl font-extrabold tracking-[-.03em]">Confirm visit details</h2></div>{draft && <span className="rounded-full bg-[#f8e6c8] px-2.5 py-1 text-[10px] font-semibold text-[#9E5611]">{draft.missingFields.length ? `${draft.missingFields.length} fields to check` : 'Ready to confirm'}</span>}</div>
        <div className="mt-5 grid gap-x-3 gap-y-4 sm:grid-cols-2">{([['visitorName','Visitor name'],['affiliation','Affiliation'],['hostName',ctx.profile?.hostLabel || 'Host name'],['purpose','Purpose'],['unitNumber',ctx.profile?.name.toLowerCase().includes('housing')?'Unit / address':'Unit / location'],['groupSize','Group size'],['visitSlot','Visit time'] ] as [keyof typeof form,string][]).map(([key,label])=><label className="block" key={key}><span className="mb-1.5 block text-[10px] font-bold text-muted-foreground">{label}{['visitorName','hostName','purpose'].includes(key)?<span className="text-rose-600"> *</span>:null}</span><input value={form[key]} onChange={(e)=>update(key,e.target.value)} type={key==='groupSize'?'number':'text'} min={key==='groupSize'?1:undefined} readOnly={ctx.isHost && key==='hostName'} data-testid={`input-review-${key}`} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-xs outline-none focus:border-primary" placeholder={key==='visitSlot'?'e.g. Today, 2:00 pm':''}/></label>)}</div>
        {draft && <div className="mt-5 rounded-xl bg-[#f6efe4] p-3" data-testid="text-missing-fields"><p className="text-[10px] font-bold text-muted-foreground">Required by {ctx.profile?.name}</p><div className="mt-2 flex flex-wrap gap-1.5">{ctx.profile?.requiredFields.map((f)=><span key={f} className={`rounded-full px-2 py-1 text-[9px] font-semibold ${draft.missingFields.some((m)=>m.toLowerCase()===f.toLowerCase())?'bg-amber-100 text-amber-900':'bg-white text-[#9E5611]'}`}>{fieldLabel(f)}{draft.missingFields.some((m)=>m.toLowerCase()===f.toLowerCase())?' · check':''}</span>)}</div>{draft.needsClarification && <p className="mt-2 text-[10px] text-amber-800">Please verify unclear details before submitting.</p>}</div>}
        {createdVisit && <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900" role="status" data-testid="status-registration-created"><CheckCircle2 size={15} className="mt-0.5 shrink-0"/><span><strong>Visit recorded.</strong> {createdVisit.visitorName} is now {statusTitle(createdVisit.status).toLowerCase()}. The visit log and audit trail have been updated.</span></div>}
        {voiceError && <p className="mt-3 text-xs text-rose-700" data-testid="text-registration-error">{voiceError}</p>}
        <div className="mt-6 border-t border-border pt-4"><div className="mb-3 flex items-center gap-2 text-[10px] text-muted-foreground"><ShieldCheck size={13} className="text-[#9E5611]"/>{ctx.profile?.rulesSummary?.[0] || 'Rules will be validated before the visit is created.'}</div><button onClick={confirm} disabled={!draft || createVisit.isPending || missingRequired.length > 0 || !form.visitorName.trim() || !form.hostName.trim() || !form.purpose.trim()} data-testid="button-confirm-visit" className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1B1513] px-4 py-3 text-xs font-bold text-white transition hover:bg-[#824413] disabled:cursor-not-allowed disabled:opacity-40">{createVisit.isPending?<LoaderCircle size={15} className="animate-spin"/>:<CheckCircle2 size={15}/>}{ctx.isHost ? 'Confirm & approve guest' : 'Confirm & add to visit log'}<ArrowRight size={14} className="ml-auto"/></button><p className="mt-2 text-center text-[9px] text-muted-foreground">{missingRequired.length ? `Complete required details: ${missingRequired.join(', ')}.` : (ctx.isHost ? 'Your guest will be approved automatically and wait for check-in at the front desk.' : 'Submitting creates a pending visit when host approval is required.')}</p></div>
      </section>
    </div>}
  </PageFrame>;
}

function Visits({ ctx }: { ctx: AppContext }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const qc = useQueryClient();
  const params = { profileId: ctx.profileId, ...(status ? { status: status as any } : {}), ...(search.trim() ? { search: search.trim() } : {}) };
  const visits = useListVisitorVisits(params, { query: { enabled: !!ctx.profileId, queryKey: getListVisitorVisitsQueryKey(params) } });
  const checkIn = useCheckInVisitor();
  const checkOut = useCheckOutVisitor();
  const actorName = ctx.actorName;
  const shownVisits = ctx.isHost ? (visits.data ?? []).filter((v) => v.hostName === ctx.hostName) : visits.data ?? [];
  const onAction = (v: VisitorVisit) => {
    const callback = () => { qc.invalidateQueries({ queryKey: getListVisitorVisitsQueryKey({ profileId: ctx.profileId }) }); qc.invalidateQueries({ queryKey: getGetVisitorDashboardQueryKey({ profileId: ctx.profileId, dateRange: 'week' }) }); qc.invalidateQueries({ queryKey: getListVisitorAuditEventsQueryKey({ profileId: ctx.profileId, limit: 50 }) }); };
    if (v.status === 'approved') checkIn.mutate({ visitId: v.id, data: { actorName } }, { onSuccess: callback });
    if (v.status === 'checked_in') checkOut.mutate({ visitId: v.id, data: { actorName } }, { onSuccess: callback });
  };
  return <PageFrame ctx={ctx} title={ctx.isHost ? 'Your visitors.' : 'Every visit, accounted for.'} eyebrow={ctx.isHost ? 'My visitors / 03' : 'Visit log / 03'} subtitle={ctx.isHost ? `Visits assigned to ${ctx.hostName}. The front desk handles arrival and departure.` : 'Search the record. Approval and physical arrival are separate steps.'}>
    <div className="surface p-4 md:p-5"><div className="flex flex-col gap-3 sm:flex-row"><label className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search visitor, host, purpose…" data-testid="input-search-visits" className="h-11 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-xs outline-none focus:border-primary"/></label><select value={status} onChange={(e)=>setStatus(e.target.value)} data-testid="select-filter-status" className="h-11 rounded-xl border border-border bg-background px-3 text-xs text-muted-foreground outline-none"><option value="">All visit states</option><option value="awaiting_approval">Awaiting approval</option><option value="approved">Approved</option><option value="denied">Denied</option><option value="checked_in">On site</option><option value="checked_out">Checked out</option></select></div>
      <div className="mt-4 flex items-center justify-between border-b border-border pb-3"><p className="mono text-[9px] uppercase tracking-[.15em] text-muted-foreground">Visit register</p><span className="text-[10px] text-muted-foreground">{shownVisits.length} records</span></div>
      {(checkIn.isError || checkOut.isError) && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-800" role="alert" data-testid="text-visit-action-error">The arrival action could not be completed. Confirm the visit state and retry.</p>}
      {visits.isLoading || visits.isFetching ? <div className="space-y-4 py-5">{[1,2,3,4].map((i)=><Skeleton key={i} className="h-14 w-full"/>)}</div> : visits.isError ? <div className="py-5"><ErrorBox message="The visit log could not be loaded." retry={()=>visits.refetch()}/></div> : !shownVisits.length ? <div className="py-5"><Empty title="No matching visits" text="Try another search or clear the current filter."/></div> : <div>{shownVisits.map((v)=><VisitRow key={v.id} visit={v} action={ctx.isHost ? undefined : v.status==='approved' ? <button onClick={()=>onAction(v)} disabled={checkIn.isPending} data-testid={`button-check-in-${v.id}`} className="flex items-center gap-1.5 rounded-lg bg-[#f8e6c8] px-3 py-2 text-[10px] font-bold text-[#824413] disabled:opacity-50"><ArrowDownLeft size={13}/>Check in</button> : v.status==='checked_in' ? <button onClick={()=>onAction(v)} disabled={checkOut.isPending} data-testid={`button-check-out-${v.id}`} className="flex items-center gap-1.5 rounded-lg bg-[#1B1513] px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50"><LogOut size={13}/>Check out</button> : null}/>)}</div>}
    </div>
  </PageFrame>;
}

function Approvals({ ctx }: { ctx: AppContext }) {
  const allVisitsQuery = useListVisitorVisits({ profileId: ctx.profileId }, { query: { enabled: !!ctx.profileId, queryKey: getListVisitorVisitsQueryKey({ profileId: ctx.profileId }) } });
  const pendingVisitsQuery = useListVisitorVisits({ profileId: ctx.profileId, status: 'awaiting_approval' }, { query: { enabled: !!ctx.profileId, queryKey: getListVisitorVisitsQueryKey({ profileId: ctx.profileId, status: 'awaiting_approval' }) } });
  const hostOptions = Array.from(new Set([...(allVisitsQuery.data ?? []), ...(pendingVisitsQuery.data ?? [])].map((visit) => visit.hostName)));
  const recipient = ctx.hostName || hostOptions[0] || '';
  const params = { profileId: ctx.profileId, recipient };
  const notifications = useListVisitorNotifications(params, { query: { enabled: !!ctx.profileId && !!recipient, queryKey: getListVisitorNotificationsQueryKey(params) } });
  const decide = useDecideVisitorVisit();
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Record<string,string>>({});
  const act = (visitId: string, action: 'allow'|'deny') => decide.mutate({ visitId, data: { action, actorName: recipient, note: notes[visitId] || undefined } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListVisitorVisitsQueryKey({ profileId: ctx.profileId }) }); qc.invalidateQueries({ queryKey: getListVisitorVisitsQueryKey({ profileId: ctx.profileId, status: 'awaiting_approval' }) }); qc.invalidateQueries({ queryKey: getListVisitorNotificationsQueryKey(params) }); qc.invalidateQueries({ queryKey: getGetVisitorDashboardQueryKey({ profileId: ctx.profileId, dateRange: 'week' }) }); qc.invalidateQueries({ queryKey: getListVisitorAuditEventsQueryKey({ profileId: ctx.profileId, limit: 50 }) }); } });
  const pending = (pendingVisitsQuery.data ?? []).filter((visit) => visit.hostName === recipient);
  return <PageFrame ctx={ctx} title="A considered yes or no." eyebrow="Host inbox / 04" subtitle={`Review requests assigned to ${recipient}. A decision never checks someone in by itself.`}>
    <div className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]"><section className="space-y-3" data-testid="list-approval-requests"><div className="mb-1 flex flex-wrap items-center justify-between gap-3"><div><p className="mono text-[9px] uppercase tracking-[.15em] text-[#9E5611]">Decision queue</p><p className="mt-1 text-xs text-muted-foreground">{pending.length} pending requests for {recipient || 'an assigned host'}</p></div><span className="rounded-lg bg-secondary px-3 py-2 text-[10px] font-semibold text-muted-foreground">Inbox · {recipient || '—'}</span></div>
        {decide.isError && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-800" role="alert" data-testid="text-approval-error">The host decision could not be saved. Please retry.</p>}
        {pendingVisitsQuery.isLoading || pendingVisitsQuery.isFetching ? <div className="space-y-3">{[1,2].map((n)=><Skeleton key={n} className="h-48 w-full rounded-2xl"/>)}</div> : pendingVisitsQuery.isError ? <ErrorBox message="Pending requests could not be loaded." retry={()=>pendingVisitsQuery.refetch()}/> : !pending.length ? <Empty title="Nothing awaiting you" text="New requests from the front desk will appear here, ready for your decision."/> : pending.map((v)=><article key={v.id} className="surface p-4 md:p-5" data-testid={`card-approval-${v.id}`}><div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f8e6c8] text-[#9E5611]"><UserRound size={18}/></div><div><p className="text-sm font-bold">{v.visitorName}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{v.affiliation || 'Visitor'} · requested {fmtTime(v.createdAt)}</p></div></div><Status status={v.status}/></div><div className="my-4 grid grid-cols-2 gap-2 rounded-xl bg-[#f6efe4] p-3"><div><p className="mono text-[8px] uppercase tracking-[.12em] text-muted-foreground">Purpose</p><p className="mt-1 text-xs font-semibold">{v.purpose}</p></div><div><p className="mono text-[8px] uppercase tracking-[.12em] text-muted-foreground">Visit window</p><p className="mt-1 text-xs font-semibold">{v.visitSlot || 'Not specified'}</p></div><div><p className="mono text-[8px] uppercase tracking-[.12em] text-muted-foreground">Group</p><p className="mt-1 text-xs font-semibold">{v.groupSize || 1} visitor{(v.groupSize || 1)===1?'':'s'}</p></div><div><p className="mono text-[8px] uppercase tracking-[.12em] text-muted-foreground">Created by</p><p className="mt-1 text-xs font-semibold">{v.createdBy}</p></div></div><input value={notes[v.id] || ''} onChange={(e)=>setNotes((s)=>({...s,[v.id]:e.target.value}))} placeholder="Optional note for the audit trail" data-testid={`input-decision-note-${v.id}`} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-[10px] outline-none focus:border-primary"/><div className="mt-3 flex gap-2"><button onClick={()=>act(v.id,'allow')} disabled={decide.isPending} data-testid={`button-approve-${v.id}`} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#9E5611] px-3 py-2.5 text-[11px] font-bold text-white disabled:opacity-50"><Check size={14}/>Allow visit</button><button onClick={()=>act(v.id,'deny')} disabled={decide.isPending} data-testid={`button-deny-${v.id}`} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11px] font-bold text-rose-800 disabled:opacity-50"><X size={14}/>Deny</button></div></article>)}
      </section>
      <aside className="space-y-4"><section className="surface p-5" data-testid="panel-host-notifications"><div className="flex items-center gap-2"><Bell size={15} className="text-[#9E5611]"/><h2 className="font-display text-lg font-bold">In-app notifications</h2></div><p className="mb-4 mt-1 text-[10px] text-muted-foreground">Delivered to {recipient}</p>{notifications.isLoading || notifications.isFetching ? <div className="space-y-3">{[1,2,3].map((n)=><Skeleton key={n} className="h-14 w-full"/>)}</div> : notifications.isError ? <ErrorBox message="Notifications could not be loaded." retry={()=>notifications.refetch()}/> : !notifications.data?.length ? <p className="rounded-xl bg-secondary/70 p-4 text-xs text-muted-foreground">No notifications yet. Requests routed to this inbox will appear here.</p> : <div className="space-y-2">{notifications.data.map((n)=><div key={n.id} className="rounded-xl border border-border p-3" data-testid={`notification-${n.id}`}><div className="flex items-start justify-between gap-2"><p className="text-[11px] font-bold">{n.title}</p><span className={`rounded-full px-2 py-0.5 text-[8px] font-bold ${n.status==='pending'?'bg-amber-100 text-amber-900':n.status==='approved'?'bg-emerald-100 text-emerald-800':'bg-rose-100 text-rose-800'}`}>{n.status}</span></div><p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{n.message}</p><p className="mt-2 mono text-[8px] text-muted-foreground">{fmtTime(n.createdAt)}</p></div>)}</div>}</section><section className="rounded-2xl border border-[#d9c28f] bg-[#f4eddc] p-4"><p className="flex items-center gap-2 text-xs font-bold text-[#725a2e]"><ShieldCheck size={15}/>Decision integrity</p><p className="mt-2 text-[10px] leading-relaxed text-[#756a54]">Approving records a host decision. The visitor remains outside until front-desk staff completes a separate check-in.</p></section></aside></div>
  </PageFrame>;
}

function Audit({ ctx }: { ctx: AppContext }) {
  const params = { profileId: ctx.profileId, limit: 50 };
  const audit = useListVisitorAuditEvents(params, { query: { enabled: !!ctx.profileId, queryKey: getListVisitorAuditEventsQueryKey(params) } });
  return <PageFrame ctx={ctx} title="A record that holds up." eyebrow="Audit trail / 05" subtitle="Every important action, in order. Decision notes and arrival events stay visible.">
    <section className="surface p-5 md:p-7" data-testid="list-audit-events"><div className="mb-6 flex items-center justify-between"><div><p className="mono text-[9px] uppercase tracking-[.15em] text-[#9E5611]">Last 50 events</p><p className="mt-1 text-[11px] text-muted-foreground">Immutable operational history</p></div><div className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-[#9E5611]"><FileClock size={18}/></div></div>
      {audit.isLoading || audit.isFetching ? <div className="space-y-4">{[1,2,3,4].map((n)=><Skeleton key={n} className="h-16 w-full"/>)}</div> : audit.isError ? <ErrorBox message="Audit events could not be loaded." retry={()=>audit.refetch()}/> : !audit.data?.length ? <Empty title="No events recorded" text="New registrations, decisions, and arrivals will build the event trail here."/> : <div className="relative ml-2 border-l border-border pl-6">{audit.data.map((event,i)=><article key={event.id} className="relative pb-6 last:pb-0" data-testid={`audit-event-${event.id}`}><span className="absolute -left-[31px] top-1 grid h-4 w-4 place-items-center rounded-full border-[3px] border-card bg-[#9E5611]"/><div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-start"><div><p className="text-xs font-bold">{event.eventType.replaceAll('_',' ')}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{event.message}</p><p className="mt-1.5 text-[10px] font-semibold text-[#9E5611]">by {event.actorName}{event.visitId?` · Visit ${event.visitId.slice(0,8)}`:''}</p></div><time className="mono shrink-0 text-[9px] text-muted-foreground">{fmtTime(event.occurredAt)}</time></div>{i<audit.data!.length-1&&<div className="mt-5 h-px bg-border/50"/>}</article>)}</div>}
    </section>
  </PageFrame>;
}

function Settings({ ctx }: { ctx: AppContext }) {
  return <PageFrame ctx={ctx} title="The rules behind the welcome." eyebrow="Configuration / 06" subtitle="A read-only view of this demo organization profile and the active front-desk role.">
    {!ctx.profile ? <Empty title="No organization selected" text="Configure a profile in the API to see organization rules here."/> : <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
      <section className="surface p-5 md:p-7" data-testid="panel-organization-settings"><div className="mb-5 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-[#f8e6c8] text-[#9E5611]">{ctx.profile.name.toLowerCase().includes('museum')?<Landmark size={18}/>:ctx.profile.name.toLowerCase().includes('housing')?<HomeIcon size={18}/>:<Building2 size={18}/>}</div><div><p className="mono text-[9px] uppercase tracking-[.14em] text-[#9E5611]">Organization profile</p><h2 className="font-display text-xl font-extrabold">{ctx.profile.name}</h2></div></div><div className="mb-4"><p className="mb-1.5 text-[10px] font-bold text-muted-foreground">Organization name</p><p data-testid="text-organization-name" className="rounded-xl border border-border bg-background px-3 py-3 text-xs">{ctx.profile.name}</p></div><div className="mb-4"><p className="mb-1.5 text-[10px] font-bold text-muted-foreground">Profile description</p><p data-testid="text-organization-description" className="rounded-xl border border-border bg-background px-3 py-3 text-xs leading-relaxed">{ctx.profile.description}</p></div><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-[#f6efe4] p-3"><p className="mono text-[8px] uppercase tracking-[.14em] text-muted-foreground">Assigned host label</p><p className="mt-1 text-xs font-bold">{ctx.profile.hostLabel}</p></div><div className="rounded-xl bg-[#f6efe4] p-3"><p className="mono text-[8px] uppercase tracking-[.14em] text-muted-foreground">Notification route</p><p className="mt-1 text-xs font-bold">{ctx.profile.notificationTarget}</p></div></div><div className="mt-5"><p className="mb-2 text-[10px] font-bold text-muted-foreground">Required details</p><div className="flex flex-wrap gap-1.5">{ctx.profile.requiredFields.map((f)=><span key={f} className="rounded-full bg-[#f8e6c8] px-2.5 py-1 text-[10px] font-semibold text-[#824413]">{f}</span>)}</div></div><div className="mt-5"><p className="mb-2 text-[10px] font-bold text-muted-foreground">Validation rules</p><ul className="space-y-2">{ctx.profile.rulesSummary.map((r,i)=><li key={i} className="flex items-start gap-2 text-[11px] leading-relaxed"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-[#9E5611]"/>{r}</li>)}</ul></div><p className="mt-6 rounded-xl bg-secondary/70 p-3 text-[10px] leading-relaxed text-muted-foreground">Organization details are managed by the connected profile service. Changes are read-only in this demo because the available API does not expose profile editing.</p></section>
      <div className="space-y-5"><section className="surface p-5 md:p-6" data-testid="panel-demo-session"><div className="flex items-center gap-2"><UserRound size={15} className="text-[#9E5611]"/><h2 className="font-display text-lg font-bold">Demo role switcher</h2></div><p className="mt-1 text-[10px] text-muted-foreground">Switch the current perspective to explore staff and host workflows.</p><div className="mt-4 grid grid-cols-2 gap-2"><button onClick={()=>ctx.setRole('guard')} data-testid="button-role-guard" className={`rounded-xl border p-3 text-left ${ctx.role==='guard'?'border-primary bg-[#f8e6c8]':'border-border bg-card'}`}><DoorOpen size={16} className="text-[#9E5611]"/><p className="mt-2 text-xs font-bold">Guard / staff</p><p className="mt-1 text-[9px] text-muted-foreground">Register walk-ins, check in, check out</p></button><button onClick={()=>ctx.setRole('host')} data-testid="button-role-host" className={`rounded-xl border p-3 text-left ${ctx.role==='host'?'border-primary bg-[#f8e6c8]':'border-border bg-card'}`}><UserRound size={16} className="text-[#9E5611]"/><p className="mt-2 text-xs font-bold">Host / resident</p><p className="mt-1 text-[9px] text-muted-foreground">Approve own visitors, pre-register guests</p></button></div><div className="mt-4 rounded-xl bg-[#f6efe4] p-3 text-[10px] text-muted-foreground">Current recipient: <strong className="text-foreground">{ctx.profile.notificationTarget}</strong></div></section><section className="rounded-2xl bg-[#2a211c] p-5 text-[#f5ede0]" data-testid="panel-product-assurance"><div className="flex items-center gap-2 text-[#F5A020]"><ShieldCheck size={17}/><p className="font-display text-lg font-bold">Designed for the moment at the door.</p></div><p className="mt-2 text-[11px] leading-relaxed text-white/70">Natural language speeds up intake. Deterministic rules validate each visit. Hosts make the decision. Staff record actual arrival. Each step stays auditable.</p><div className="mt-4 flex items-center gap-2 text-[9px] text-white/60"><span className="rounded-full border border-white/20 px-2 py-1">Request</span><ArrowRight size={11}/><span className="rounded-full border border-white/20 px-2 py-1">Validate</span><ArrowRight size={11}/><span className="rounded-full border border-white/20 px-2 py-1">Decide</span><ArrowRight size={11}/><span className="rounded-full border border-white/20 px-2 py-1">Arrive</span></div></section></div>
    </div>}
  </PageFrame>;
}

const allowedPaths = (role: string) => navFor(role).map((n) => n.href);
function RoutedApp() {
  return <Context>{(ctx) => { const home = ctx.isHost ? '/approvals' : '/'; const guard = (path: string, el: React.ReactNode) => allowedPaths(ctx.role).includes(path) ? el : <Redirect to={home}/>; return <Switch><Route path="/">{guard('/', <Dashboard ctx={ctx}/>)}</Route><Route path="/register">{guard('/register', <Registration ctx={ctx}/>)}</Route><Route path="/visits">{guard('/visits', <Visits ctx={ctx}/>)}</Route><Route path="/ask">{guard('/ask', <AskVisitLog ctx={ctx}/>)}</Route><Route path="/approvals">{guard('/approvals', <Approvals ctx={ctx}/>)}</Route><Route path="/audit">{guard('/audit', <Audit ctx={ctx}/>)}</Route><Route path="/settings"><Settings ctx={ctx}/></Route><Route component={NotFound}/></Switch>; }}</Context>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><RoutedApp/></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>;
}

export default App;