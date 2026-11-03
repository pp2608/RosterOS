const express = require('express');
const cors = require('cors');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const seed = require('./data');
const { generateRoster, validateRoster, calculateCoverage } = require('./scheduler');
const { createSupabaseStore } = require('./supabaseStore');
const { assertAuthConfiguration, credentialsMatch, issueToken, requireAuthentication } = require('./auth');

const recordCounts = (value) => Object.fromEntries(
  ['employees','brands','processes','pods','holidays','availability','rosters']
    .map((key) => [key, Array.isArray(value[key]) ? value[key].length : 0]),
);
const logPersistence = (event, details = {}) => console.log(JSON.stringify({ event, ...details }));

function clientOrigins(env = process.env) {
  const configured = (env.CLIENT_ORIGIN || '').split(',').map(origin => origin.trim()).filter(Boolean);
  return configured.length ? configured : ['http://localhost:5173'];
}

function assertClientOriginConfiguration(env = process.env) {
  const configured = (env.CLIENT_ORIGIN || '').split(',').map(origin => origin.trim()).filter(Boolean);
  if (env.NODE_ENV === 'production' && configured.length === 0) throw new Error('CLIENT_ORIGIN must be set to the deployed frontend origin in production.');
  for (const origin of configured) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error('CLIENT_ORIGIN must contain one or more valid origin URLs.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('CLIENT_ORIGIN values must be exact http(s) origins without paths or wildcards.');
  }
}

function storageMode(env = process.env) {
  const mode = env.ROSTEROS_STORAGE_MODE?.trim().toLowerCase() || 'auto';
  if (!['auto', 'local-json', 'supabase'].includes(mode)) throw new Error('ROSTEROS_STORAGE_MODE must be auto, local-json, or supabase.');
  return mode;
}

const app = express();
const allowedOrigins = new Set(clientOrigins());
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)) }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', requireAuthentication);
const storePath = process.env.ROSTEROS_STORE_PATH || path.join(__dirname, '..', 'data', 'local-store.json');
let initialStateSource='local-json';
const state = (() => {
  try { return JSON.parse(fs.readFileSync(storePath, 'utf8')); }
  catch { initialStateSource='seed-data';return { ...JSON.parse(JSON.stringify(seed)), rosters: [] }; }
})();
let remoteStore=null;
let stateSource=initialStateSource;
async function persist() {
  if(remoteStore)return remoteStore.save(state);
  fs.mkdirSync(path.dirname(storePath), { recursive:true });
  fs.writeFileSync(storePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
async function persistRoster(roster) {
  if(remoteStore)return remoteStore.saveRoster(roster);
  return persist();
}
async function initialize(){
  assertAuthConfiguration();
  assertClientOriginConfiguration();
  const mode=storageMode();
  if(mode==='local-json'){
    logPersistence('persistence.initialized',{source:stateSource,storageMode:mode,counts:recordCounts(state)});
    return;
  }
  const supabaseUrl=process.env.SUPABASE_URL?.trim();
  const supabaseKey=process.env.SUPABASE_SECRET_KEY?.trim()||process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if(mode==='supabase'&&(!supabaseUrl||!supabaseKey))throw new Error('ROSTEROS_STORAGE_MODE=supabase requires SUPABASE_URL and SUPABASE_SECRET_KEY.');
  if(!supabaseUrl&&!supabaseKey){
    logPersistence('persistence.initialized',{source:stateSource,counts:recordCounts(state)});
    return;
  }
  if(!supabaseUrl||!supabaseKey)throw new Error('Supabase configuration is incomplete. Set SUPABASE_URL and SUPABASE_SECRET_KEY.');
  const store=createSupabaseStore(supabaseUrl,supabaseKey);
  const databaseState=await store.load();
  const hasDatabaseData=Object.values(databaseState).some((records)=>Array.isArray(records)&&records.length>0);
  logPersistence('supabase.load.completed',{hasDatabaseData,counts:recordCounts(databaseState)});
  if(hasDatabaseData){Object.assign(state,databaseState);stateSource='supabase';}
  else {await store.save(state);stateSource=`${initialStateSource}-synced-to-supabase`;}
  remoteStore=store;
  logPersistence('persistence.initialized',{source:stateSource,counts:recordCounts(state)});
}
const collections = ['employees', 'brands', 'processes', 'pods', 'holidays', 'availability'];
const labels = { employees:'Employee', brands:'Brand', processes:'Process', pods:'Pod', holidays:'Holiday', availability:'Availability record' };
function validateRecord(collection,record,exceptId){
  const unique=(field,label)=>state[collection].some(item=>item.id!==exceptId&&String(item[field]).toLowerCase()===String(record[field]).toLowerCase());
  const validDays=(days)=>Array.isArray(days)&&days.length>0&&days.every(d=>Number.isInteger(d)&&d>=0&&d<=6);
  const validDate=(value)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;const parsed=new Date(`${value}T00:00:00Z`);return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;};
  if(collection==='employees'){
    if(!record.employeeCode?.trim()||!record.name?.trim()||!record.email?.trim())return'Employee ID, name, and email are required.';
    if(unique('employeeCode','Employee ID'))return'Employee ID is already in use.';if(unique('email','Email'))return'Email is already in use.';
    if(!state.pods.some(p=>p.id===record.podId))return'Select an existing pod.';
    if(!Array.isArray(record.brandIds)||record.brandIds.some(b=>!state.brands.some(x=>x.id===b)))return'Employee brand assignments contain an unknown brand.';
    if(!Array.isArray(record.processIds)||record.processIds.some(p=>!state.processes.some(x=>x.id===p)))return'Employee process assignments contain an unknown process.';
    if(!Array.isArray(record.weeklyOffs)||record.weeklyOffs.some(d=>!Number.isInteger(d)||d<0||d>6))return'Weekly offs must be weekdays from 0 (Sunday) to 6 (Saturday).';
    if((record.preferredOffs||[]).some(d=>!Number.isInteger(d)||d<0||d>6))return'Preferred days must be weekdays from 0 (Sunday) to 6 (Saturday).';
  }
  if(collection==='brands'){
    if(!record.name?.trim())return'Brand name is required.';if(unique('name','Brand'))return'Brand name is already in use.';
    if(!Array.isArray(record.processIds)||record.processIds.some(p=>!state.processes.some(x=>x.id===p)))return'Brand process assignments contain an unknown process.';
    if(!Number.isInteger(Number(record.minStaff))||Number(record.minStaff)<1)return'Brand minimum staffing must be at least one.';
    if(!validDays(record.operatingDays)||!['operate','closed'].includes(record.holidayPolicy))return'Choose operating weekdays and a valid public-holiday rule.';
    if(Object.entries(record.processMinimums||{}).some(([key,value])=>!record.processIds.includes(key)||!Number.isInteger(Number(value))||Number(value)<1))return'Process minimums must reference a selected process and be at least one.';
    if(Object.entries(record.dailyMinimums||{}).some(([key,value])=>!/^([0-6])$/.test(key)||!Number.isInteger(Number(value))||Number(value)<1))return'Day-specific minimums must use weekdays 0–6 and values of at least one.';
  }
  if(collection==='processes'){
    if(!record.name?.trim())return'Process name is required.';if(unique('name','Process'))return'Process name is already in use.';
    if(!Number.isInteger(Number(record.minStaff||1))||Number(record.minStaff||1)<1)return'Process minimum staffing must be at least one.';
    if(!validDays(record.operatingDays)||!['operate','closed'].includes(record.holidayPolicy))return'Choose operating weekdays and a valid public-holiday rule.';
  }
  if(collection==='pods'&&(!record.name?.trim()||unique('name','Pod')||(record.lead&&!state.employees.some(e=>e.id===record.lead&&e.podId===record.id))))return'Pod name must be unique and its lead must be an employee in that pod.';
  if(collection==='availability'){
    if(!state.employees.some(e=>e.id===record.employeeId))return'Availability record must reference an existing employee.';
    if(!validDate(record.date)||!['leave','comp_off'].includes(record.type)||!['pending','approved','rejected'].includes(record.status))return'Availability date, type, or status is invalid.';
    if(state.availability.some(a=>a.id!==exceptId&&a.employeeId===record.employeeId&&a.date===record.date&&a.type===record.type))return'This employee already has an availability record of that type on this date.';
  }
  if(collection==='holidays'&&(!validDate(record.date)||!record.name?.trim()))return'Holiday name and a valid date are required.';
  return'';
}

app.get('/api/health', (_req,res) => res.status(200).json({
  status:'ok', ready:true, persistenceReady:true,
  persistence:remoteStore?'supabase':'local-json', storageMode:storageMode(),
  supabaseConfigured:Boolean(process.env.SUPABASE_URL?.trim()&&(process.env.SUPABASE_SECRET_KEY?.trim()||process.env.SUPABASE_SERVICE_ROLE_KEY?.trim())),
}));
app.post('/api/auth/login', (req,res) => {
  let config;
  try { config=assertAuthConfiguration(); } catch { return res.status(503).json({error:'Demo authentication is not configured on the API server.'}); }
  if(!credentialsMatch(req.body?.username,req.body?.password,config))return res.status(401).json({error:'Invalid demo username or password.'});
  res.json({token:issueToken(config.username,config.secret),expiresInSeconds:8*60*60});
});
app.get('/api/bootstrap', (_req,res) => {
  logPersistence('bootstrap.served',{source:stateSource,counts:recordCounts(state)});
  res.json({ ...state, rosters:state.rosters.map(roster=>({...roster,coverage:calculateCoverage(roster,state)})), stats:{ activeEmployees:state.employees.filter(e=>e.active).length, brands:state.brands.filter(b=>b.active).length, processes:state.processes.filter(p=>p.active).length, pods:state.pods.length } });
});
for (const collection of collections) {
  app.post(`/api/${collection}`, async (req,res) => {
    const body = req.body || {};
    if (collection === 'holidays' && (!/^\d{4}-\d{2}-\d{2}$/.test(body.date||'') || !body.name?.trim())) return res.status(400).json({ error:'Holiday name and date are required.' });
    const defaults=collection==='employees'?{brandIds:[],processIds:[],weeklyOffs:[0,6],preferredOffs:[],role:'Operations Associate'}:collection==='brands'?{processIds:[],processMinimums:{},dailyMinimums:{},operatingDays:[1,2,3,4,5],holidayPolicy:'closed',minStaff:1,timezone:'Asia/Kolkata'}:collection==='processes'?{operatingDays:[1,2,3,4,5],holidayPolicy:'closed',minStaff:1}:collection==='pods'?{lead:null}:{};
    const record = { active:true, ...defaults, ...body, id:body.id || randomUUID() };
    if(collection==='availability'&&(!record.employeeId||!record.date||!['leave','comp_off'].includes(record.type)||!['pending','approved','rejected'].includes(record.status)))return res.status(400).json({error:'Provide an employee, date, leave or comp-off type, and valid status.'});
    const invalid=validateRecord(collection,record);if(invalid)return res.status(400).json({error:invalid});
    state[collection].push(record);
    for(const roster of state.rosters)validateRoster(roster,state);
    await persist();
    res.status(201).json(record);
  });
  app.patch(`/api/${collection}/:id`, async (req,res) => {
    const index = state[collection].findIndex((item) => item.id === req.params.id);
    if (index < 0) return res.status(404).json({ error:`${labels[collection]} not found.` });
    const candidate={ ...state[collection][index], ...req.body, id:req.params.id };
    const invalid=validateRecord(collection,candidate,req.params.id);if(invalid)return res.status(400).json({error:invalid});
    state[collection][index] = candidate;
    for(const roster of state.rosters) validateRoster(roster,state);
    await persist();
    res.json(state[collection][index]);
  });
}
app.post('/api/rosters/generate', async (req,res) => {
  try {
    if(state.rosters.some((roster)=>roster.month===req.body.month))return res.status(409).json({error:'A roster already exists for this month. Existing roster data was preserved.'});
    const roster = generateRoster({ month:req.body.month, ...state });
    state.rosters = [...state.rosters, roster];
    await persistRoster(roster);
    res.status(201).json(roster);
  } catch (error) { res.status(400).json({ error:error.message }); }
});
app.get('/api/rosters/:month', (req,res) => {
  const roster = state.rosters.find((r) => r.month === req.params.month);
  return roster ? res.json({...roster,coverage:calculateCoverage(roster,state)}) : res.status(404).json({ error:'No roster exists for this month.' });
});
app.patch('/api/rosters/:month/entries/:entryId', async (req,res) => {
  const roster = state.rosters.find((r) => r.month === req.params.month);
  if (!roster) return res.status(404).json({ error:'Roster not found.' });
  const entry = roster.entries.find((e) => e.id === req.params.entryId);
  if (!entry) return res.status(404).json({ error:'Roster assignment not found.' });
  if (!state.employees.some((e) => e.id === req.body.employeeId && e.active)) return res.status(400).json({ error:'Select an active employee.' });
  const candidate={...roster,entries:roster.entries.map(item=>({...item}))};
  const candidateEntry=candidate.entries.find(item=>item.id===req.params.entryId);
  candidateEntry.employeeId=req.body.employeeId;
  candidateEntry.source='manual';
  const checked=validateRoster(candidate,state);
  const unsafe=checked.conflicts.filter(c=>c.severity==='critical'&&(c.entryId===candidateEntry.id||(c.employeeId===candidateEntry.employeeId&&c.date===candidateEntry.date)));
  if(unsafe.length)return res.status(409).json({error:'Assignment violates eligibility, availability, calendar, or same-day scheduling rules.',conflicts:unsafe});
  entry.employeeId = req.body.employeeId;
  entry.source = 'manual';
  validateRoster(roster, state);
  await persistRoster(roster);
  res.json({...roster,coverage:calculateCoverage(roster,state)});
});
app.post('/api/rosters/:month/validate', async (req,res) => {
  const roster = state.rosters.find((r) => r.month === req.params.month);
  if (!roster) return res.status(404).json({ error:'Roster not found.' });
  const result=validateRoster(roster, state);await persistRoster(roster);res.json({...result,coverage:calculateCoverage(result,state)});
});
app.get('/api/rosters/:month/export.csv', (req,res) => {
  const roster = state.rosters.find((r) => r.month === req.params.month);
  if (!roster) return res.status(404).json({ error:'Roster not found.' });
  const employee = new Map(state.employees.map((e) => [e.id,e.name]));
  const brand = new Map(state.brands.map((b) => [b.id,b.name]));
  const process = new Map(state.processes.map((p) => [p.id,p.name]));
  const quote = (v) => `"${String(v ?? '').replaceAll('"','""')}"`;
  const csv = ['Date,Brand,Process,Employee,Source', ...roster.entries.map((e) => [e.date,brand.get(e.brandId),process.get(e.processId),employee.get(e.employeeId),e.source].map(quote).join(','))].join('\n');
  res.type('text/csv').attachment(`roster-${roster.month}.csv`).send(csv);
});
app.use((error,_req,res,_next) => { console.error(error); res.status(500).json({ error:'Unexpected server error.' }); });
const port = Number(process.env.PORT) || 4000;
if (require.main === module) initialize().then(()=>{
  const server=app.listen(port, () => console.log(`RosterOS API listening on ${port} (${remoteStore?'Supabase':'local JSON'} persistence)`));
  server.on('error',(error)=>{if(error.code==='EADDRINUSE')console.error(`Port ${port} is already in use; another process may be serving requests.`);else console.error(error.message);process.exitCode=1;});
}).catch((error)=>{console.error(error.message);process.exitCode=1;});
module.exports = { app, state, initialize };
