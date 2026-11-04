import { useEffect, useMemo, useState } from 'react'
import { BrowserRouter, NavLink, Route, Routes } from './routing.jsx'
import { useLocation } from './location.js'
import { Activity, AlertTriangle, ArrowUpRight, CalendarDays, Check, ChevronDown, CircleHelp, Command, Download, LayoutDashboard, Menu, Plus, Search, Settings2, ShieldCheck, Users, X } from './icons.jsx'
import './App.css'

const API = import.meta.env.VITE_API_URL || '/api'
const TOKEN_KEY = 'rosteros-demo-token'
const getMonth = () => new Date().toISOString().slice(0, 7)
function getCoverageMetric(roster) {
  const coverage = roster?.coverage
  if (!coverage || !Number.isSafeInteger(coverage.fulfilledSlots) || coverage.fulfilledSlots < 0 || !Number.isSafeInteger(coverage.requiredSlots) || coverage.requiredSlots < 0 || coverage.fulfilledSlots > coverage.requiredSlots || !Number.isFinite(coverage.percentage) || coverage.percentage < 0 || coverage.percentage > 100) return null
  return { fulfilled: coverage.fulfilledSlots, required: coverage.requiredSlots, percentage: coverage.percentage }
}
function CoverageMetric({ metric, compact = false }) {
  return <span className={compact ? 'coverage-slot-summary' : 'coverage-slot-detail'}>{metric ? <>{metric.fulfilled.toLocaleString()} / {metric.required.toLocaleString()} staffing slots · {metric.percentage}%</> : 'Staffing slot coverage unavailable'}</span>
}
async function request(path, options) {
  const token = sessionStorage.getItem(TOKEN_KEY)
  const headers = { 'Content-Type': 'application/json', ...options?.headers }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${API}${path}`, { ...options, headers })
  const data = await response.json()
  if (response.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY)
    window.dispatchEvent(new Event('rosteros:auth-required'))
  }
  if (!response.ok) throw new Error(data.error || 'Request failed')
  return data
}
const nav = [
  { label: 'Overview', to: '/', icon: LayoutDashboard },
  { label: 'Roster', to: '/roster', icon: CalendarDays },
  { label: 'People', to: '/people', icon: Users },
  { label: 'Operations', to: '/operations', icon: Settings2 },
  { label: 'Availability', to: '/availability', icon: Activity },
]

function AppFrame() {
  const [authenticated, setAuthenticated] = useState(() => Boolean(sessionStorage.getItem(TOKEN_KEY)))
  const [data, setData] = useState(null)
  const [health, setHealth] = useState(null)
  const [roster, setRoster] = useState(null)
  const [month, setMonth] = useState(getMonth())
  const [loading, setLoading] = useState(() => Boolean(sessionStorage.getItem(TOKEN_KEY)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [mobileNav, setMobileNav] = useState(false)
  const location = useLocation()
  const title = nav.find(item => item.to === location.pathname)?.label || 'Roster'

  useEffect(() => {
    const expireSession = () => { setAuthenticated(false); setData(null); setRoster(null); setLoading(false) }
    window.addEventListener('rosteros:auth-required', expireSession)
    return () => window.removeEventListener('rosteros:auth-required', expireSession)
  }, [])

  async function signIn(username, password) {
    const result = await request('/auth/login', { method:'POST', body:JSON.stringify({ username, password }) })
    sessionStorage.setItem(TOKEN_KEY, result.token)
    setLoading(true)
    setError('')
    setNotice('Signed in to the RosterOS demo.')
    setAuthenticated(true)
  }

  function signOut() {
    sessionStorage.removeItem(TOKEN_KEY)
    setAuthenticated(false)
    setData(null)
    setRoster(null)
    setHealth(null)
    setNotice('')
    setError('')
  }

  async function refresh() {
    if (!authenticated) return
    setLoading(true)
    try {
      const [next,system] = await Promise.all([request('/bootstrap'),request('/health')])
      setData(next)
      setHealth(system)
      setError('')
      try { setRoster(await request(`/rosters/${month}`)) } catch { setRoster(null) }
    } catch (e) { setError(`${e.message}. Start the API with npm run dev in server/.`); }
    finally { setLoading(false) }
  }
  useEffect(() => {
    if (!authenticated) return undefined
    let cancelled=false
    Promise.all([request('/bootstrap'),request('/health')]).then(async([next,system])=>{
      if(cancelled)return
      setData(next);setHealth(system);setError('')
      try{const current=await request(`/rosters/${month}`);if(!cancelled)setRoster(current)}catch{if(!cancelled)setRoster(null)}
    }).catch(e=>{if(!cancelled)setError(`${e.message}. Start the API with npm run dev in server/.`)}).finally(()=>{if(!cancelled)setLoading(false)})
    return()=>{cancelled=true}
  },[month,authenticated])
  async function generate() {
    setBusy(true); setError(''); setNotice('')
    try { const result = await request('/rosters/generate', { method:'POST', body:JSON.stringify({ month }) }); setRoster(result); setNotice(`Roster generated for ${month}. ${result.conflicts.length} coverage issue${result.conflicts.length === 1 ? '' : 's'} need review.`) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function validate() {
    setBusy(true)
    try { const result = await request(`/rosters/${month}/validate`, { method:'POST' }); setRoster(result); setNotice(`Validation complete. ${result.conflicts.length} issue${result.conflicts.length === 1 ? '' : 's'} found.`) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function updateEntry(entryId, employeeId) {
    try { const result = await request(`/rosters/${month}/entries/${entryId}`, { method:'PATCH', body:JSON.stringify({ employeeId }) }); setRoster(result); setNotice('Assignment updated and roster revalidated.') }
    catch (e) { setError(e.message) }
  }
  async function createEmployee(form) {
    try { await request('/employees', { method:'POST', body:JSON.stringify(form) }); setNotice(`${form.name} added to the team.`); await refresh(); return true }
    catch (e) { setError(e.message); return false }
  }
  async function deactivateEmployee(employee) {
    if (!window.confirm(`Deactivate ${employee.name}? Existing roster entries will remain available for validation.`)) return
    try { await request(`/employees/${employee.id}`, { method:'PATCH', body:JSON.stringify({ active:false }) }); setNotice(`${employee.name} deactivated.`); await refresh() }
    catch (e) { setError(e.message) }
  }
  async function addAvailability(form) {
    try { await request('/availability', { method:'POST', body:JSON.stringify(form) }); setNotice('Availability record added. Approved time off will be included in roster validation.'); await refresh() }
    catch (e) { setError(e.message) }
  }
  async function addHoliday(form){try{await request('/holidays',{method:'POST',body:JSON.stringify({...form,scope:'all'})});setNotice(`${form.name} added to the operating calendar.`);await refresh()}catch(e){setError(e.message)}}
  async function updateHoliday(record,patch){try{await request(`/holidays/${record.id}`,{method:'PATCH',body:JSON.stringify(patch)});setNotice(`${patch.name} updated and existing rosters revalidated.`);await refresh()}catch(e){setError(e.message)}}
  async function updateAvailability(record,status){try{await request(`/availability/${record.id}`,{method:'PATCH',body:JSON.stringify({status})});setNotice(`Request ${status}. Existing rosters were revalidated.`);await refresh()}catch(e){setError(e.message)}}
  async function createRecord(collection,form) { try{await request(`/${collection}`,{method:'POST',body:JSON.stringify(form)});setNotice(`${form.name} created.`);await refresh();return true}catch(e){setError(e.message);return false} }
  async function updateRecord(collection,record,patch) { try{await request(`/${collection}/${record.id}`,{method:'PATCH',body:JSON.stringify(patch)});setNotice(`${record.name} updated and existing rosters revalidated.`);await refresh();return true}catch(e){setError(e.message);return false} }
  async function exportRoster() {
    try {
      const token=sessionStorage.getItem(TOKEN_KEY)
      const response=await fetch(`${API}/rosters/${month}/export.csv`,{headers:token?{Authorization:`Bearer ${token}`}:{}})
      if(response.status===401){sessionStorage.removeItem(TOKEN_KEY);window.dispatchEvent(new Event('rosteros:auth-required'))}
      if(!response.ok)throw new Error('Roster export failed.')
      const url=URL.createObjectURL(await response.blob())
      const link=document.createElement('a');link.href=url;link.download=`roster-${month}.csv`;link.click();URL.revokeObjectURL(url)
    } catch(e) { setError(e.message) }
  }
  if (!authenticated) return <LoginPage onSignIn={signIn}/>
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="brand-lockup"><span className="brand-symbol"><Command size={18}/></span><span>roster<span className="brand-os">OS</span><small>PARTH OPERATIONS</small></span></div>
      <div className="workspace-label">WORKSPACE</div>
      <div className="workspace-switch"><span className="workspace-avatar">P</span><span>Parth Operations<small>Workforce team</small></span></div>
      <div className="workspace-label nav-label">WORKSPACE</div>
      <nav>{nav.map(({label,to,icon:Icon}) => <NavLink onClick={() => setMobileNav(false)} key={to} to={to} className={({isActive}) => `nav-link ${isActive?'active':''}`}><Icon size={17}/>{label}{label==='Roster'&&roster?.conflicts?.length>0&&<span className="nav-count">{roster.conflicts.length}</span>}</NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="system-card"><span className="system-dot"/><div><b>Roster API</b><small>{health?`Connected · ${health.persistence==='supabase'?'Supabase':'Local JSON'}`:'Connecting…'}</small></div></div><NavLink to="/operations" className="nav-link plain"><Settings2 size={17}/>Configuration</NavLink><NavLink to="/availability" className="nav-link plain"><CircleHelp size={17}/>Schedules & holidays</NavLink><div className="user-profile"><div className="profile-avatar">P</div><div><b>Parth</b><small>Parth Operations</small></div></div></div>
    </aside>
    {mobileNav&&<button className="mobile-backdrop" aria-label="Close navigation" onClick={()=>setMobileNav(false)}/>}
    <main className="main-area">
      <header className="topbar"><button className="mobile-menu icon-button" onClick={()=>setMobileNav(!mobileNav)} aria-label="Toggle navigation"><Menu size={19}/></button><div className="breadcrumbs">Workspace <span>/</span> <b>{title}</b></div><div className="top-actions"><span className="today-label"><span className={`system-dot ${error?'system-dot-error':''}`}/>{error?'API connection issue':health?`API connected · ${health.persistence==='supabase'?'Supabase':'local JSON'}`:'Connecting to API'}</span><button className="button button-secondary button-small" onClick={signOut}>Sign out</button><div className="top-avatar">OM</div></div></header>
      <section className="page-content">
        {(error||notice)&&<div className={`toast ${error?'toast-error':'toast-success'}`}><span>{error||notice}</span><button aria-label="Dismiss" onClick={()=>{setError('');setNotice('')}}><X size={16}/></button></div>}
        {!data?<div className="loading-state">{loading?'Connecting to roster workspace…':<>Roster data is unavailable. Check that the API is running and retry. <button className="button button-secondary" onClick={refresh}>Retry</button></>}</div>:<Routes>
          <Route path="/" element={<Dashboard data={data} health={health} roster={roster} month={month} setMonth={setMonth} generate={generate} busy={busy} />} />
          <Route path="/roster" element={<RosterPage data={data} roster={roster} month={month} setMonth={setMonth} generate={generate} validate={validate} updateEntry={updateEntry} exportRoster={exportRoster} busy={busy} />} />
          <Route path="/people" element={<PeoplePage data={data} createEmployee={createEmployee} updateEmployee={(employee,form)=>updateRecord('employees',employee,form)} deactivateEmployee={deactivateEmployee} />} />
          <Route path="/operations" element={<OperationsPage data={data} createRecord={createRecord} updateRecord={updateRecord} />} />
          <Route path="/availability" element={<AvailabilityPage data={data} addAvailability={addAvailability} addHoliday={addHoliday} updateHoliday={updateHoliday} updateAvailability={updateAvailability} />} />
          <Route path="*" element={<Dashboard data={data} health={health} roster={roster} month={month} setMonth={setMonth} generate={generate} busy={busy} />} />
        </Routes>}
      </section>
    </main>
  </div>
}
function LoginPage({onSignIn}) {
  const [username,setUsername]=useState('')
  const [password,setPassword]=useState('')
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  async function submit(event){event.preventDefault();setBusy(true);setError('');try{await onSignIn(username,password)}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <main className="login-screen"><form className="login-card" onSubmit={submit}><div className="brand-lockup login-brand"><span className="brand-symbol"><Command size={18}/></span><span>roster<span className="brand-os">OS</span><small>WORKFORCE PLANNING DEMO</small></span></div><h1>Welcome back</h1><p>Sign in with the demo credentials provided by the administrator.</p><label>Demo username<input required autoComplete="username" value={username} onChange={event=>setUsername(event.target.value)}/></label><label>Password<input required type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)}/></label>{error&&<div className="login-error" role="alert">{error}</div>}<button className="button button-primary login-submit" disabled={busy}>{busy?'Signing in…':'Sign in to RosterOS'}</button></form></main>
}
function PageHeading({ eyebrow, title, description, right }) { return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{right&&<div className="heading-actions">{right}</div>}</div> }
function MonthPicker({month,setMonth}) { return <label className="month-picker"><CalendarDays size={16}/><input aria-label="Roster month" type="month" value={month} onChange={e=>setMonth(e.target.value)}/><ChevronDown size={14}/></label> }
function Dashboard({data,health,roster,month,setMonth,generate,busy}) {
  if (!data?.employees || !data?.brands || !data?.processes || !data?.pods || !data?.availability) {
    return <div className="loading-state">Dashboard data is unavailable. Retry the API connection.</div>
  }
  const active = data.employees.filter(e=>e.active).length
  const today = new Date().toISOString().slice(0,10)
  const onDuty = data.employees.filter(e=>e.active&&!e.weeklyOffs.includes(new Date().getDay())&&!data.availability.some(a=>a.employeeId===e.id&&a.date===today&&a.status==='approved')).length
  const pending = data.availability.filter(a=>a.status==='pending').length
  const criticalCount=roster?.conflicts.filter(c=>c.severity==='critical').length||0
  const coverageMetric = getCoverageMetric(roster)
  const processCoverage = coverageMetric?.percentage ?? 0
  const cards = [{label:'Active employees',value:active,sub:`Across ${data.pods.length} operational pods`,icon:Users},{label:'Active brands',value:data.brands.filter(b=>b.active).length,sub:'Across customer operations',icon:Command},{label:'Operating processes',value:data.processes.filter(p=>p.active).length,sub:'Configured service lines',icon:Activity},{label:'On duty today',value:onDuty,sub:`${active-onDuty} unavailable today`,icon:ShieldCheck}]
  return <>
    <PageHeading eyebrow={`${new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}).toUpperCase()} · OPERATIONS OVERVIEW`} title={`${new Date().getHours()<12?'Good morning':new Date().getHours()<17?'Good afternoon':'Good evening'}`} description="Here’s the latest across your workforce and roster operations." right={<MonthPicker month={month} setMonth={setMonth}/>}/>
    <div className="metric-grid">{cards.map(({label,value,sub,icon:Icon})=><div className="metric-card" key={label}><div className="metric-top"><span>{label}</span><Icon size={17}/></div><div className="metric-value">{value}</div><div className="metric-sub">{sub}</div></div>)}</div>
    <div className="content-grid">
      <section className="panel coverage-panel"><div className="panel-head"><div><h2>Roster coverage</h2><p>Monthly staffing health and open requirements</p></div><button className="text-button" onClick={()=>{window.location.href='/roster'}}>View roster <ArrowUpRight size={15}/></button></div>
        {roster?<><div className="coverage-summary"><span className={`status-pill ${roster.status==='needs_review'?'status-warning':'status-good'}`}><span/>{roster.status==='needs_review'?'Needs review':'Validated'}</span><span>{roster.entries.length.toLocaleString()} scheduled assignments</span></div><div className="coverage-track"><span style={{width:`${processCoverage}%`}}/></div><div className="coverage-foot"><span>{criticalCount} critical issues · {roster.conflicts.length-criticalCount} preference notices</span><span>{coverageMetric ? `${coverageMetric.percentage}% staffing coverage · ${month}` : `Coverage unavailable · ${month}`}</span></div><div className="coverage-slot-line"><CoverageMetric metric={coverageMetric}/></div></>:<div className="empty-inline"><div className="empty-icon"><CalendarDays size={18}/></div><b>No roster generated for {month}</b><span>Generate a roster to see coverage and staffing gaps.</span><button className="button button-primary button-small" onClick={generate} disabled={busy}><CalendarDays size={15}/>{busy?'Generating…':'Generate roster'}</button></div>}
      </section>
      <section className="panel pod-panel"><div className="panel-head"><div><h2>Pod overview</h2><p>Team distribution and today’s availability</p></div></div><div className="pod-list">{data.pods.map((pod,i)=>{const people=data.employees.filter(e=>e.podId===pod.id&&e.active);const lead=data.employees.find(e=>e.id===pod.lead);const free=people.filter(e=>!e.weeklyOffs.includes(new Date().getDay())&&!data.availability.some(a=>a.employeeId===e.id&&a.date===today&&a.status==='approved')).length;return <div className="pod-row" key={pod.id}><div className={`pod-avatar pod-${i}`}>{pod.name.slice(0,1)}</div><div className="pod-info"><b>{pod.name}</b><small>Lead: {lead?.name||'Unassigned'}</small></div><span className="pod-count">{people.length} people</span><span className="pod-health"><span className={`system-dot ${free<people.length?'system-dot-warning':''}`}/>{free} / {people.length} available</span></div>})}</div></section>
    </div>
    <div className="content-grid lower-grid"><section className="panel"><div className="panel-head"><div><h2>Needs attention</h2><p>Items that may need your review</p></div><span className="count-badge">{(roster?.conflicts?.length||0)+pending}</span></div>{roster?.conflicts?.length? <div className="attention-list">{roster.conflicts.slice(0,3).map(c=><div className="attention-row" key={c.id}><span className="warning-icon"><AlertTriangle size={16}/></span><div><b>{c.message.split('. ')[0]}</b><small>{c.date} · {c.severity==='warning'?'Preference notice':'Coverage requirement'}</small></div><ArrowUpRight size={15}/></div>)}</div>:pending?<div className="calm-state"><Activity size={16}/>{pending} leave request{pending===1?'':'s'} awaiting approval.</div>:<div className="calm-state"><Check size={16}/>{roster?'No roster conflicts detected.':'Generate this month’s roster to check staffing coverage.'}</div>}</section>
      <section className="panel today-panel"><div className="panel-head"><div><h2>Today’s workforce</h2><p>Availability snapshot · {new Date().toLocaleDateString('en-US',{month:'short',day:'numeric'})}</p></div><span className="status-pill status-good"><span/>Snapshot</span></div><div className="workforce-stats"><div><b>{onDuty}</b><span>Available</span></div><div><b>{active-onDuty}</b><span>Unavailable</span></div><div><b>{pending}</b><span>Leave requests</span></div></div><div className="workforce-bar"><span style={{width:`${active?Math.round(onDuty/active*100):0}%`}}/></div><div className="coverage-foot"><span>{active?Math.round(onDuty/active*100):0}% of active team available</span><span>{active} total</span></div></section></div>
    <div className="data-note"><span className="system-dot"/>Illustrative workforce data <span>·</span> Persisted in {health?.persistence==='supabase'?'Supabase PostgreSQL':'local JSON for development'}</div>
  </>
}
function RosterPage({data,roster,month,setMonth,generate,validate,updateEntry,exportRoster,busy}) {
  const [scope,setScope]=useState('company');const [filter,setFilter]=useState('all');const [query,setQuery]=useState('');const [viewMode,setViewMode]=useState('assignments');const [fromOverride,setFromOverride]=useState('');const [toOverride,setToOverride]=useState('');const from=fromOverride||`${month}-01`;const to=toOverride||`${month}-${new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()}`
  function changeMonth(value){setFromOverride('');setToOverride('');setMonth(value)}
  const brandMap=useMemo(()=>new Map(data.brands.map(b=>[b.id,b.name])),[data]); const procMap=useMemo(()=>new Map(data.processes.map(p=>[p.id,p.name])),[data]); const people=data.employees.filter(e=>e.active)
  const rows=(roster?.entries||[]).filter(e=>(filter==='all'||(scope==='brand'?e.brandId===filter:scope==='process'?e.processId===filter:scope==='pod'?data.employees.find(p=>p.id===e.employeeId)?.podId===filter:scope==='employee'?e.employeeId===filter:true))&&e.date>=from&&e.date<=to&&(!query||`${brandMap.get(e.brandId)} ${procMap.get(e.processId)} ${data.employees.find(p=>p.id===e.employeeId)?.name}`.toLowerCase().includes(query.toLowerCase())))
  const coverageMetric = getCoverageMetric(roster)
  return <><PageHeading eyebrow="WORKFORCE PLANNING" title="Roster" description="Generate, review, and update monthly assignments." right={<><MonthPicker month={month} setMonth={changeMonth}/><button className="button button-primary" onClick={generate} disabled={busy}><CalendarDays size={16}/>{busy?'Generating…':'Generate roster'}</button></>}/>
    <div className="roster-toolbar"><div className="toolbar-search"><Search size={16}/><input placeholder="Search assignments" value={query} onChange={e=>setQuery(e.target.value)}/></div><select aria-label="Roster view" value={scope} onChange={e=>{setScope(e.target.value);setFilter('all')}}><option value="company">Company-wide view</option><option value="pod">Pod-wise view</option><option value="brand">Brand-wise view</option><option value="process">Process-wise view</option><option value="employee">Employee-wise view</option></select>{scope!=='company'&&<select aria-label={`Filter by ${scope}`} value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All {scope==='brand'?'brands':scope==='process'?'processes':scope==='pod'?'pods':'employees'}</option>{(scope==='brand'?data.brands:scope==='process'?data.processes:scope==='pod'?data.pods:data.employees).map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select>}<input aria-label="From date" className="date-filter" type="date" value={from} onChange={e=>setFromOverride(e.target.value)}/><input aria-label="To date" className="date-filter" type="date" value={to} onChange={e=>setToOverride(e.target.value)}/><button className="button button-secondary" onClick={validate} disabled={!roster||busy}><ShieldCheck size={15}/>Validate</button>{roster&&<button className="button button-secondary" onClick={exportRoster}><Download size={15}/>Export CSV</button>}</div>
    {!roster?<div className="panel roster-empty"><div className="empty-icon"><CalendarDays size={22}/></div><h2>Build your monthly roster</h2><p>Assignments are generated from employee eligibility, operating calendars, weekly offs, approved leave, and minimum staffing.</p><button className="button button-primary" onClick={generate} disabled={busy}><CalendarDays size={16}/>Generate {month}</button></div>:<><div className="roster-summary"><div><span className={`status-pill ${roster.status==='needs_review'?'status-warning':'status-good'}`}><span/>{roster.status==='needs_review'?'Needs review':'Coverage validated'}</span><span>{roster.entries.length} scheduled assignments</span><span>{roster.conflicts.length} issue and preference notices</span><CoverageMetric metric={coverageMetric} compact/></div><button className="button button-secondary" onClick={validate} disabled={busy}><ShieldCheck size={15}/>Revalidate</button></div>
    {roster.conflicts.length>0&&<section className="panel conflict-panel"><div className="panel-head"><div><h2><AlertTriangle size={17}/> Issues & preferences <span className="count-badge red-count">{roster.conflicts.length}</span></h2><p>Critical coverage and scheduling issues need correction; preference notices are advisory.</p></div></div><div className="conflict-list">{roster.conflicts.slice(0,20).map(c=><div key={c.id} className="conflict-row"><span className={`conflict-marker ${c.severity==='warning'?'marker-warning':''}`}/><div><b>{brandMap.get(c.brandId)||'Employee schedule'}{procMap.get(c.processId)?` · ${procMap.get(c.processId)}`:''}</b><small>{c.date} · {c.message}</small></div><span className={`severity ${c.severity==='warning'?'severity-warning':''}`}>{c.severity==='warning'?'Preference':'Critical'}</span></div>)}</div>{roster.conflicts.length>20&&<div className="conflict-more">Showing 20 of {roster.conflicts.length} notices</div>}</section>}
    <section className="panel assignments-panel"><div className="panel-head"><div><h2>{viewMode==='calendar'?'Monthly schedule':'Assignments'}</h2><p>{viewMode==='calendar'?'Work, off days, approved leave, and comp-offs for the selected team.':'Change a scheduled employee to edit and revalidate the roster.'}</p></div><button className="button button-secondary button-small" onClick={()=>setViewMode(viewMode==='assignments'?'calendar':'assignments')}>{viewMode==='assignments'?'Monthly schedule':'Assignment list'}</button></div>{viewMode==='calendar'?<RosterGrid data={data} rows={rows} from={from} to={to} scope={scope} filter={filter} query={query}/>:<div className="table-wrap"><table><thead><tr><th>Date</th><th>Brand</th><th>Process</th><th>Assigned employee</th><th>Source</th></tr></thead><tbody>{rows.slice(0,200).map(entry=>{const eligible=people.filter(p=>p.brandIds.includes(entry.brandId)&&p.processIds.includes(entry.processId));return <tr key={entry.id}><td className="date-cell">{new Date(`${entry.date}T00:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',weekday:'short'})}</td><td>{brandMap.get(entry.brandId)}</td><td>{procMap.get(entry.processId)}</td><td><select className="assignment-select" value={entry.employeeId} onChange={e=>updateEntry(entry.id,e.target.value)}>{eligible.map(p=><option key={p.id} value={p.id}>{p.name}{p.id===entry.employeeId?' (current)':''}</option>)}</select></td><td><span className="source-label">{entry.source==='manual'?'Manual edit':'Generated'}</span></td></tr>})}</tbody></table>{rows.length>200&&<div className="table-footer">Showing 200 of {rows.length} assignments. Narrow the date or team filter to review more.</div>}{rows.length===0&&<div className="no-rows">No assignments match this filter.</div>}</div>}</section></>}
  </>
}
function RosterGrid({data,rows,from,to,scope,filter,query}) {
  const days=[];for(let cursor=new Date(`${from}T00:00:00Z`),end=new Date(`${to}T00:00:00Z`);cursor<=end&&days.length<62;cursor.setUTCDate(cursor.getUTCDate()+1))days.push(cursor.toISOString().slice(0,10))
  const employees=data.employees.filter(e=>e.active&&(scope==='pod'?e.podId===filter:scope==='employee'?e.id===filter:scope==='brand'?e.brandIds.includes(filter):scope==='process'?e.processIds.includes(filter):true)&&(!query||e.name.toLowerCase().includes(query.toLowerCase())||rows.some(row=>row.employeeId===e.id)))
  const entriesByDay=new Map();for(const entry of rows){const key=`${entry.date}:${entry.employeeId}`;entriesByDay.set(key,[...(entriesByDay.get(key)||[]),entry])}
  return <div className="roster-grid-scroll"><table className="roster-grid-table"><thead><tr><th className="grid-employee-head">Employee</th>{days.map(d=><th key={d} className="grid-day-head">{new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US',{weekday:'short',day:'numeric',timeZone:'UTC'})}</th>)}</tr></thead><tbody>{employees.map(employee=><tr key={employee.id}><td className="grid-employee">{employee.name}<small>{data.pods.find(p=>p.id===employee.podId)?.name||'Unassigned'}</small></td>{days.map(date=>{const assigned=entriesByDay.get(`${date}:${employee.id}`)||[];const away=data.availability.find(a=>a.employeeId===employee.id&&a.date===date&&a.status==='approved');const weekday=new Date(`${date}T00:00:00Z`).getUTCDay();let label='—',className='grid-cell-free';if(away){label=away.type==='comp_off'?'COMP':'LEAVE';className='grid-cell-away'}else if(employee.weeklyOffs.includes(weekday)){label='OFF';className='grid-cell-off'}else if(assigned.length){label=assigned.slice(0,2).map(e=>data.processes.find(p=>p.id===e.processId)?.name.split(' ').map(w=>w[0]).join('').slice(0,3)).join(' · ');className='grid-cell-work'}return <td className={className} key={date} title={assigned.map(e=>`${data.brands.find(b=>b.id===e.brandId)?.name} · ${data.processes.find(p=>p.id===e.processId)?.name}`).join('\n')||label}>{label}</td>})}</tr>)}</tbody></table>{!employees.length&&<div className="no-rows">No employees in this view.</div>}<div className="grid-legend"><span><i className="legend-work"/>Scheduled (process initials)</span><span><i className="legend-off"/>Weekly off</span><span><i className="legend-away"/>Approved leave / comp-off</span></div></div>
}
function PeoplePage({data,createEmployee,updateEmployee,deactivateEmployee}) {
  const [search,setSearch]=useState('');const [showForm,setShowForm]=useState(null)
  const people=data.employees.filter(e=>`${e.name} ${e.email} ${e.employeeCode}`.toLowerCase().includes(search.toLowerCase()))
  return <><PageHeading eyebrow="TEAM DIRECTORY" title="People" description={`${data.employees.filter(e=>e.active).length} active employees across ${data.pods.length} pods.`} right={<button className="button button-primary" onClick={()=>setShowForm({})}><Plus size={16}/>Add employee</button>}/><div className="roster-toolbar"><div className="toolbar-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search people"/></div><span className="result-count">{people.length} people</span></div><section className="panel assignments-panel"><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Employee ID</th><th>Pod</th><th>Role</th><th>Brands</th><th>Processes</th><th>Status</th><th></th></tr></thead><tbody>{people.map(e=><tr key={e.id}><td><div className="person-cell"><span className="person-avatar">{e.name.split(' ').map(n=>n[0]).slice(0,2).join('')}</span><span><b>{e.name}</b><small>{e.email}</small></span></div></td><td>{e.employeeCode}</td><td>{data.pods.find(p=>p.id===e.podId)?.name||'Unassigned'}</td><td>{e.role}</td><td>{e.brandIds.length}</td><td>{e.processIds.map(id=>data.processes.find(p=>p.id===id)?.name).filter(Boolean).join(', ')}</td><td><span className={`status-pill ${e.active?'status-good':'status-muted'}`}><span/>{e.active?'Active':'Inactive'}</span></td><td><button className="row-action" onClick={()=>setShowForm(e)}>Edit</button>{e.active&&<> · <button className="row-action" onClick={()=>deactivateEmployee(e)}>Deactivate</button></>}</td></tr>)}</tbody></table></div></section>{showForm&&<EmployeeModal data={data} record={showForm.id?showForm:null} onClose={()=>setShowForm(null)} onSave={async form=>{const saved=showForm.id?await updateEmployee(showForm,form):await createEmployee(form);if(saved!==false)setShowForm(null)}}/>}</>
}
function EmployeeModal({data,record,onClose,onSave}) {
  const [form,setForm]=useState(()=>({name:'',email:'',podId:data.pods[0]?.id||'',role:'Operations Associate',employeeCode:`DS-${Date.now().toString().slice(-4)}`,brandIds:[],processIds:[],weeklyOffs:[0,6],preferredOffs:[],...record})); const [saving,setSaving]=useState(false)
  const toggle=(key,id)=>setForm(f=>({...f,[key]:f[key].includes(id)?f[key].filter(x=>x!==id):[...f[key],id]}))
  async function submit(e){e.preventDefault();setSaving(true);await onSave(form);setSaving(false)}
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><form className="modal" onSubmit={submit}><div className="modal-head"><div><span className="eyebrow">TEAM DIRECTORY</span><h2>{record?'Edit employee':'Add employee'}</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18}/></button></div><div className="form-grid"><label>Full name<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Work email<input required type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label><label>Employee ID<input required value={form.employeeCode} onChange={e=>setForm({...form,employeeCode:e.target.value})}/></label><label>Pod<select value={form.podId} onChange={e=>setForm({...form,podId:e.target.value})}>{data.pods.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Role<select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}><option>Operations Associate</option><option>Pod Lead</option><option>Operations Manager</option></select></label></div><fieldset className="check-field"><legend>Assigned brands</legend><div>{data.brands.map(b=><label key={b.id}><input type="checkbox" checked={form.brandIds.includes(b.id)} onChange={()=>toggle('brandIds',b.id)}/>{b.name}</label>)}</div></fieldset><fieldset className="check-field"><legend>Assigned processes</legend><div>{data.processes.map(p=><label key={p.id}><input type="checkbox" checked={form.processIds.includes(p.id)} onChange={()=>toggle('processIds',p.id)}/>{p.name}</label>)}</div></fieldset><fieldset className="check-field"><legend>Mandatory weekly offs</legend><div className="day-choices">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,i)=><label key={day}><input type="checkbox" checked={form.weeklyOffs.includes(i)} onChange={()=>toggle('weeklyOffs',i)}/>{day}</label>)}</div></fieldset><fieldset className="check-field"><legend>Preferred days off (soft preference)</legend><div className="day-choices">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,i)=><label key={day}><input type="checkbox" checked={(form.preferredOffs||[]).includes(i)} onChange={()=>toggle('preferredOffs',i)}/>{day}</label>)}</div></fieldset><div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}><Plus size={15}/>{saving?'Saving…':record?'Save employee':'Add employee'}</button></div></form></div>
}
function OperationsPage({data,createRecord,updateRecord}) {
  const [section,setSection]=useState('brands');const [modal,setModal]=useState(null);const [search,setSearch]=useState('')
  const configs={brands:{label:'Brands',key:'brands',fields:['name','minStaff','processIds','operatingDays','holidayPolicy']},processes:{label:'Processes',key:'processes',fields:['name','minStaff','operatingDays','holidayPolicy']},pods:{label:'Pods',key:'pods',fields:['name','lead']}}
  const config=configs[section];const records=data[config.key].filter(r=>`${r.name||''} ${r.id||''}`.toLowerCase().includes(search.toLowerCase()))
  const dayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  return <><PageHeading eyebrow="OPERATING MODEL" title="Operations setup" description="Configure client brands, service lines, and operational pods." right={<button className="button button-primary" onClick={()=>setModal({type:'create',section})}><Plus size={16}/>Add {section==='brands'?'brand':section==='processes'?'process':'pod'}</button>}/><div className="tab-row">{Object.entries(configs).map(([key,c])=><button key={key} className={`tab-button ${section===key?'selected':''}`} onClick={()=>{setSection(key);setSearch('')}}>{c.label}<span>{data[c.key].length}</span></button>)}</div><div className="roster-toolbar"><div className="toolbar-search"><Search size={16}/><input placeholder={`Search ${config.label.toLowerCase()}`} value={search} onChange={e=>setSearch(e.target.value)}/></div><span className="result-count">{records.length} {config.label.toLowerCase()}</span></div><section className="panel assignments-panel"><div className="table-wrap">{section==='brands'?<table><thead><tr><th>Brand</th><th>Processes</th><th>Operating days</th><th>Holiday rule</th><th>Minimum staffing</th><th>Resources</th><th>Status</th><th></th></tr></thead><tbody>{records.map(b=><tr key={b.id}><td><b>{b.name}</b></td><td>{(b.processIds||[]).map(pid=>data.processes.find(p=>p.id===pid)?.name||pid).join(', ')||'None'}</td><td>{(b.operatingDays||[]).length===7?'Every day':(b.operatingDays||[]).map(d=>dayNames[d]).join(', ')}</td><td>{b.holidayPolicy==='operate'?'Operates':'Closed'}</td><td>{b.minStaff}</td><td>{data.employees.filter(e=>e.active&&e.brandIds.includes(b.id)).length} assigned</td><td><span className={`status-pill ${b.active?'status-good':'status-muted'}`}><span/>{b.active?'Active':'Inactive'}</span></td><td><button className="row-action" onClick={()=>setModal({type:'edit',section,record:b})}>Edit rules</button></td></tr>)}</tbody></table>:section==='processes'?<table><thead><tr><th>Process</th><th>Operating days</th><th>Holiday rule</th><th>Minimum staffing</th><th>Brands</th><th>Status</th><th></th></tr></thead><tbody>{records.map(p=><tr key={p.id}><td><b>{p.name}</b></td><td>{(p.operatingDays||[]).length===7?'Every day':(p.operatingDays||[]).map(d=>dayNames[d]).join(', ')}</td><td>{p.holidayPolicy==='operate'?'Operates':'Closed'}</td><td>{p.minStaff||1}</td><td>{data.brands.filter(b=>b.active&&b.processIds.includes(p.id)).length}</td><td><span className={`status-pill ${p.active?'status-good':'status-muted'}`}><span/>{p.active?'Active':'Inactive'}</span></td><td><button className="row-action" onClick={()=>setModal({type:'edit',section,record:p})}>Edit rules</button></td></tr>)}</tbody></table>:<table><thead><tr><th>Pod</th><th>Pod lead</th><th>Team size</th><th></th></tr></thead><tbody>{records.map(pod=><tr key={pod.id}><td><b>{pod.name}</b></td><td>{data.employees.find(e=>e.id===pod.lead)?.name||'Unassigned'}</td><td>{data.employees.filter(e=>e.podId===pod.id&&e.active).length} employees</td><td><button className="row-action" onClick={()=>setModal({type:'edit',section,record:pod})}>Edit pod</button></td></tr>)}</tbody></table>}</div></section>{modal&&<OperationsModal data={data} section={modal.section} record={modal.record} onClose={()=>setModal(null)} onSave={async form=>{const saved=modal.record?await updateRecord(configs[modal.section].key,modal.record,form):await createRecord(configs[modal.section].key,form);if(saved!==false)setModal(null)}}/>}</>
}
function OperationsModal({data,section,record,onClose,onSave}) {
  const empty=section==='brands'?{name:'',active:true,minStaff:1,operatingDays:[1,2,3,4,5],holidayPolicy:'closed',processIds:data.processes.filter(p=>p.active).slice(0,1).map(p=>p.id),processMinimums:{},dailyMinimums:{}}:section==='processes'?{name:'',active:true,minStaff:1,operatingDays:[1,2,3,4,5],holidayPolicy:'closed'}:{name:'',lead:data.employees.find(e=>e.active&&e.role==='Pod Lead')?.id||''}
  const [form,setForm]=useState(()=>({...empty,...record}));const [saving,setSaving]=useState(false);const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const toggle=(field,id)=>setForm(f=>{const values=f[field]||[];const add=!values.includes(id);const processMinimums={...f.processMinimums};if(field==='processIds'){if(add)processMinimums[id]=1;else delete processMinimums[id]}return{...f,[field]:add?[...values,id]:values.filter(x=>x!==id),...(field==='processIds'?{processMinimums}:{})}})
  async function submit(e){e.preventDefault();setSaving(true);await onSave(form);setSaving(false)}
  return <div className="modal-backdrop"><form className="modal small-modal" onSubmit={submit}><div className="modal-head"><div><span className="eyebrow">OPERATING MODEL</span><h2>{record?'Edit':'Add'} {section==='brands'?'brand':section==='processes'?'process':'pod'}</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={18}/></button></div><label>Name<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>{section==='pods'?<label>Pod lead<select value={form.lead||''} onChange={e=>setForm({...form,lead:e.target.value})}><option value="">Unassigned</option>{(record?data.employees.filter(p=>p.active&&p.podId===record.id):[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>:<><label>{section==='brands'?'Minimum distinct staff per brand':'Minimum staff for this process'}<input required type="number" min="1" max="20" value={form.minStaff||1} onChange={e=>setForm({...form,minStaff:Number(e.target.value)})}/></label><fieldset className="check-field"><legend>Operating days</legend><div className="day-choices">{days.map((d,i)=><label key={d}><input type="checkbox" checked={(form.operatingDays||[]).includes(i)} onChange={()=>toggle('operatingDays',i)}/>{d}</label>)}</div></fieldset><label>Public holiday rule<select value={form.holidayPolicy||'closed'} onChange={e=>setForm({...form,holidayPolicy:e.target.value})}><option value="closed">Closed on public holidays</option><option value="operate">Operates on public holidays</option></select></label><label>Active<select value={String(form.active!==false)} onChange={e=>setForm({...form,active:e.target.value==='true'})}><option value="true">Active</option><option value="false">Inactive</option></select></label>{section==='brands'&&<><fieldset className="check-field"><legend>Processes and minimum coverage</legend><div>{data.processes.map(p=><label key={p.id}><input type="checkbox" checked={(form.processIds||[]).includes(p.id)} onChange={()=>toggle('processIds',p.id)}/>{p.name}{(form.processIds||[]).includes(p.id)&&<input aria-label={`${p.name} minimum staff`} className="mini-number" type="number" min="1" max="20" value={form.processMinimums?.[p.id]||1} onChange={e=>setForm({...form,processMinimums:{...form.processMinimums,[p.id]:Number(e.target.value)}})}/>}</label>)}</div></fieldset><fieldset className="check-field"><legend>Day-specific brand minimum (optional)</legend><div className="day-choices">{days.map((d,i)=><label key={d}>{d}<input aria-label={`${d} minimum brand staff`} className="mini-number" type="number" min="1" max="20" placeholder="—" value={form.dailyMinimums?.[i]||''} onChange={e=>setForm({...form,dailyMinimums:{...form.dailyMinimums,[i]:e.target.value?Number(e.target.value):undefined}})}/></label>)}</div></fieldset></>}</>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}><Check size={15}/>{saving?'Saving…':'Save changes'}</button></div></form></div>
}
function AvailabilityPage({data,addAvailability,addHoliday,updateHoliday,updateAvailability}) {
  const [showForm,setShowForm]=useState(false);const [mode,setMode]=useState('leave');const [employeeId,setEmployeeId]=useState(data.employees.find(e=>e.active)?.id||'');const [date,setDate]=useState(new Date().toISOString().slice(0,10));const [status,setStatus]=useState('approved');const [note,setNote]=useState('');const [holidayEdit,setHolidayEdit]=useState(null)
  async function submit(e){e.preventDefault();if(mode==='holiday'){if(holidayEdit)await updateHoliday(holidayEdit,{date,name:note});else await addHoliday({date,name:note})}else await addAvailability({employeeId,date,type:mode,status,note});setShowForm(false);setHolidayEdit(null);setNote('')}
  const records=[...data.availability.map(a=>({...a,recordType:'availability'})),...data.holidays.map(h=>({...h,recordType:'holiday',type:'public holiday',status:'calendar'}))].sort((a,b)=>a.date.localeCompare(b.date))
  return <><PageHeading eyebrow="WORKFORCE PLANNING" title="Availability" description="Manage weekly schedules, time off approvals, comp-offs, and public holidays." right={<><button className="button button-secondary" onClick={()=>{setMode('holiday');setHolidayEdit(null);setDate(new Date().toISOString().slice(0,10));setNote('');setShowForm(true)}}><Plus size={15}/>Add public holiday</button><button className="button button-primary" onClick={()=>{setMode('leave');setShowForm(true)}}><Plus size={16}/>Add time off</button></>}/><div className="metric-grid availability-metrics"><div className="metric-card"><div className="metric-top"><span>Availability records</span><CalendarDays size={17}/></div><div className="metric-value">{data.availability.length}</div><div className="metric-sub">All recorded dates</div></div><div className="metric-card"><div className="metric-top"><span>Pending approvals</span><Activity size={17}/></div><div className="metric-value">{data.availability.filter(a=>a.status==='pending').length}</div><div className="metric-sub">Awaiting manager review</div></div><div className="metric-card"><div className="metric-top"><span>Approved time off</span><Check size={17}/></div><div className="metric-value">{data.availability.filter(a=>a.status==='approved').length}</div><div className="metric-sub">Included in roster validation</div></div><div className="metric-card"><div className="metric-top"><span>Public holidays</span><CalendarDays size={17}/></div><div className="metric-value">{data.holidays.length}</div><div className="metric-sub">Company calendar entries</div></div></div><section className="panel assignments-panel"><div className="panel-head"><div><h2>Time off & public holidays</h2><p>Approved leave and comp-off dates revalidate existing rosters.</p></div></div><div className="table-wrap"><table><thead><tr><th>Employee / scope</th><th>Date</th><th>Type</th><th>Status</th><th>Note</th><th>Review</th></tr></thead><tbody>{records.map(a=><tr key={a.id}><td>{a.recordType==='holiday'?'All employees':data.employees.find(e=>e.id===a.employeeId)?.name||'Unknown employee'}</td><td>{new Date(`${a.date}T00:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</td><td className="capitalize">{a.type.replace('_',' ')}</td><td><span className={`status-pill ${a.status==='approved'||a.status==='calendar'?'status-good':a.status==='pending'?'status-warning':'status-muted'}`}><span/>{a.status==='calendar'?'Scheduled':a.status}</span></td><td>{a.note||a.name||'—'}</td><td>{a.recordType==='holiday'?<button className="row-action" onClick={()=>{setMode('holiday');setHolidayEdit(a);setDate(a.date);setNote(a.name);setShowForm(true)}}>Edit</button>:a.status==='pending'&&<><button className="row-action" onClick={()=>updateAvailability(a,'approved')}>Approve</button> · <button className="row-action" onClick={()=>updateAvailability(a,'rejected')}>Reject</button></>}</td></tr>)}</tbody></table>{!records.length&&<div className="no-rows">No availability or holiday records yet.</div>}</div></section>{showForm&&<div className="modal-backdrop"><form className="modal small-modal" onSubmit={submit}><div className="modal-head"><div><span className="eyebrow">AVAILABILITY</span><h2>{mode==='holiday'?(holidayEdit?'Edit public holiday':'Add public holiday'):'Add time off'}</h2></div><button type="button" className="icon-button" onClick={()=>setShowForm(false)}><X size={18}/></button></div>{mode!=='holiday'&&<label>Employee<select value={employeeId} onChange={e=>setEmployeeId(e.target.value)}>{data.employees.filter(e=>e.active).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>}<label>{mode==='holiday'?'Holiday date':'Date'}<input required type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>{mode!=='holiday'&&<><label>Type<select value={mode} onChange={e=>setMode(e.target.value)}><option value="leave">Planned leave</option><option value="comp_off">Comp-off</option></select></label><label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="approved">Approved</option><option value="pending">Pending approval</option></select></label></>}<label>{mode==='holiday'?'Holiday name':'Note'}<input required={mode==='holiday'} value={note} onChange={e=>setNote(e.target.value)} placeholder={mode==='holiday'?'e.g. Regional observance':'Optional context'}/></label><div className="modal-actions"><button type="button" className="button button-secondary" onClick={()=>setShowForm(false)}>Cancel</button><button className="button button-primary"><Plus size={15}/>{mode==='holiday'?(holidayEdit?'Save holiday':'Add holiday'):'Add record'}</button></div></form></div>}</>
}
function Root(){return <BrowserRouter><AppFrame/></BrowserRouter>}
export default Root
