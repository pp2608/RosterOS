const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'rosteros-api-'));
process.env.ROSTEROS_STORE_PATH=path.join(tempDir,'state.json');
process.env.DEMO_LOGIN_USERNAME='test-demo';
process.env.DEMO_LOGIN_PASSWORD='test-only-password';
process.env.DEMO_AUTH_SECRET='rosteros-api-test-secret-not-for-real-use-123456789';
process.env.CLIENT_ORIGIN='https://demo.test';
process.env.ROSTEROS_STORAGE_MODE='local-json';
const {app,initialize}=require('../src/index');
let server,base,token;
test.before(async()=>{await initialize();server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}/api`;const login=await call('/auth/login',{method:'POST',auth:false,body:JSON.stringify({username:'test-demo',password:'test-only-password'})});assert.equal(login.response.status,200);token=login.data.token;});
test.after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(tempDir,{recursive:true,force:true});});
async function call(url,options={}){const {auth=true,...requestOptions}=options;const headers={'content-type':'application/json',...requestOptions.headers};if(auth&&token)headers.authorization=`Bearer ${token}`;const response=await fetch(`${base}${url}`,{...requestOptions,headers});const data=response.headers.get('content-type')?.includes('json')?await response.json():await response.text();return{response,data};}

test('authentication protects workforce reads and every roster write route',async()=>{
  const health=await call('/health',{auth:false});assert.equal(health.response.status,200);
  assert.equal(health.data.persistence,'local-json');
  assert.equal(health.data.ready,true);
  const allowedOrigin=await call('/health',{auth:false,headers:{Origin:'https://demo.test'}});assert.equal(allowedOrigin.response.headers.get('access-control-allow-origin'),'https://demo.test');
  const blockedOrigin=await call('/health',{auth:false,headers:{Origin:'https://attacker.example'}});assert.equal(blockedOrigin.response.headers.get('access-control-allow-origin'),null);
  const badLogin=await call('/auth/login',{method:'POST',auth:false,body:JSON.stringify({username:'test-demo',password:'wrong'})});assert.equal(badLogin.response.status,401);
  const bootstrap=await call('/bootstrap',{auth:false});assert.equal(bootstrap.response.status,401);
  const create=await call('/employees',{method:'POST',auth:false,body:JSON.stringify({name:'Unauthorized'})});assert.equal(create.response.status,401);
  const generate=await call('/rosters/generate',{method:'POST',auth:false,body:JSON.stringify({month:'2026-12'})});assert.equal(generate.response.status,401);
  const edit=await call('/rosters/2026-11/entries/test-entry',{method:'PATCH',auth:false,body:JSON.stringify({employeeId:'test'})});assert.equal(edit.response.status,401);
  const validate=await call('/rosters/2026-11/validate',{method:'POST',auth:false,body:'{}'});assert.equal(validate.response.status,401);
  const exportCsv=await call('/rosters/2026-11/export.csv',{auth:false});assert.equal(exportCsv.response.status,401);
  const authorized=await call('/bootstrap');assert.equal(authorized.response.status,200);assert.equal(authorized.data.employees.length,48);
});

test('API bootstrap, employee, brand and process management persists locally',async()=>{
  let result=await call('/bootstrap');assert.equal(result.response.status,200);assert.equal(result.data.employees.length,48);assert.equal(result.data.brands.length,24);assert.equal(result.data.processes.length,4);assert.equal(result.data.pods.length,5);
  const resources=result.data.brands.map(b=>result.data.employees.filter(e=>e.primaryBrandIds.includes(b.id)).length);assert.equal(resources.filter(count=>count===1).length,19);assert.equal(resources.filter(count=>count===2).length,4);assert.equal(resources.filter(count=>count===3).length,1);assert.equal(resources.every(count=>count>=1&&count<=3),true);
  const relief=result.data.employees.filter(e=>e.reliefGroup);assert.equal(relief.length,18);assert.equal(result.data.employees.find(e=>e.name==='Relief Associate 9').brandIds.length,16);
  const createdProcess=(await call('/processes',{method:'POST',body:JSON.stringify({name:'API Test Process',active:true,operatingDays:[1,2,3,4,5,6,0],holidayPolicy:'operate',minStaff:1})}));assert.equal(createdProcess.response.status,201);
  const brand=(await call('/brands',{method:'POST',body:JSON.stringify({name:'API Test Brand',active:true,operatingDays:[1,2,3,4,5,6,0],holidayPolicy:'operate',processIds:[createdProcess.data.id],processMinimums:{[createdProcess.data.id]:1},dailyMinimums:{},minStaff:1})}));assert.equal(brand.response.status,201);
  const employee=(await call('/employees',{method:'POST',body:JSON.stringify({employeeCode:'API-001',name:'Demo Employee',email:'api-demo@example.test',podId:result.data.pods[0].id,role:'Operations Associate',active:true,brandIds:[brand.data.id],primaryBrandIds:[brand.data.id],processIds:[createdProcess.data.id],weeklyOffs:[],preferredOffs:[]})}));assert.equal(employee.response.status,201);
  const invalidPrimary=await call('/employees',{method:'POST',body:JSON.stringify({employeeCode:'API-002',name:'Invalid Primary',email:'invalid-primary@example.test',podId:result.data.pods[0].id,brandIds:[],primaryBrandIds:[brand.data.id],processIds:[],weeklyOffs:[]})});assert.equal(invalidPrimary.response.status,400);
  const changed=await call(`/employees/${employee.data.id}`,{method:'PATCH',body:JSON.stringify({name:'Updated Demo Employee'})});assert.equal(changed.data.name,'Updated Demo Employee');
  assert.equal(fs.existsSync(process.env.ROSTEROS_STORE_PATH),true);
  const persisted=JSON.parse(fs.readFileSync(process.env.ROSTEROS_STORE_PATH,'utf8'));
  assert.equal(persisted.employees.find(e=>e.id===employee.data.id).name,'Updated Demo Employee');
  const generated=await call('/rosters/generate',{method:'POST',body:JSON.stringify({month:'2026-12'})});assert.equal(generated.response.status,201);
  const before=(await call('/rosters/2026-12')).data.entries;
  const unchanged=await call(`/employees/${employee.data.id}`,{method:'PATCH',body:JSON.stringify(changed.data)});assert.equal(unchanged.response.status,200);
  assert.deepEqual((await call('/rosters/2026-12')).data.entries,before);
  const renamed=await call(`/employees/${employee.data.id}`,{method:'PATCH',body:JSON.stringify({name:'Updated Again'})});assert.equal(renamed.response.status,200);
  assert.deepEqual((await call('/rosters/2026-12')).data.entries,before);
});

test('availability changes, roster generation, manual edit, validation and CSV export work end to end',async()=>{
  const data=(await call('/bootstrap')).data;const employee=data.employees.find(e=>e.employeeCode==='API-001');const brand=data.brands.find(b=>b.name==='API Test Brand');const process=data.processes.find(p=>p.name==='API Test Process');
  const leave=await call('/availability',{method:'POST',body:JSON.stringify({employeeId:employee.id,date:'2026-11-04',type:'leave',status:'approved',note:'API scenario'})});assert.equal(leave.response.status,201);
  const generated=await call('/rosters/generate',{method:'POST',body:JSON.stringify({month:'2026-11'})});assert.equal(generated.response.status,201);
  const duplicateGeneration=await call('/rosters/generate',{method:'POST',body:JSON.stringify({month:'2026-11'})});assert.equal(duplicateGeneration.response.status,409);
  const preserved=(await call('/rosters/2026-11')).data;assert.equal(preserved.id,generated.data.id);assert.deepEqual(preserved.entries,generated.data.entries);
  assert.equal(generated.data.entries.some(e=>e.date==='2026-11-04'&&e.brandId===brand.id&&e.employeeId===employee.id),false);
  assert.equal(generated.data.conflicts.some(c=>c.date==='2026-11-04'&&c.brandId===brand.id&&c.processId===process.id&&c.severity==='critical'),true);
  const entry=generated.data.entries.find(e=>e.brandId===brand.id&&e.processId===process.id&&e.employeeId===employee.id&&e.date!=='2026-11-04');assert.ok(entry);
  const other=data.employees.find(e=>e.id!==employee.id&&e.active);
  const rejected=await call(`/rosters/2026-11/entries/${encodeURIComponent(entry.id)}`,{method:'PATCH',body:JSON.stringify({employeeId:other.id})});assert.equal(rejected.response.status,409);
  const afterRejected=(await call('/rosters/2026-11')).data;assert.equal(afterRejected.entries.find(e=>e.id===entry.id).employeeId,employee.id);
  const edited=await call(`/rosters/2026-11/entries/${encodeURIComponent(entry.id)}`,{method:'PATCH',body:JSON.stringify({employeeId:employee.id})});assert.equal(edited.response.status,200);assert.equal(edited.data.entries.find(e=>e.id===entry.id).source,'manual');
  assert.ok(edited.data.coverage.requiredSlots>0);assert.match(edited.data.coverage.explanation,/Coverage combines process responsibility/);
  const validated=await call('/rosters/2026-11/validate',{method:'POST',body:'{}'});assert.equal(validated.response.status,200);assert.ok(validated.data.validatedAt);
  const csv=await call('/rosters/2026-11/export.csv');assert.equal(csv.response.status,200);assert.match(csv.data,/Date,Brand,Process,Employee,Source/);assert.match(csv.data,/API Test Brand/);
});

test('public holidays and pod assignment controls accept configured records',async()=>{
  const initial=(await call('/bootstrap')).data;
  const holiday=await call('/holidays',{method:'POST',body:JSON.stringify({date:'2026-11-05',name:'Test Observance',scope:'all'})});assert.equal(holiday.response.status,201);
  const pod=initial.pods[1];const updated=await call(`/pods/${pod.id}`,{method:'PATCH',body:JSON.stringify({name:'Orbit Operations'})});assert.equal(updated.data.name,'Orbit Operations');
  const now=(await call('/bootstrap')).data;assert.equal(now.holidays.some(h=>h.name==='Test Observance'),true);
});

test('holiday creation defaults to all brands and rejects unknown scopes',async()=>{
  const created=await call('/holidays',{method:'POST',body:JSON.stringify({date:'2026-11-06',name:'Default Scope Holiday'})});
  assert.equal(created.response.status,201);
  assert.equal(created.data.scope,'all');
  const invalid=await call('/holidays',{method:'POST',body:JSON.stringify({date:'2026-11-07',name:'Unknown Scope Holiday',scope:'missing-brand'})});
  assert.equal(invalid.response.status,400);
});
