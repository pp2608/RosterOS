const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {createSupabaseStore}=require('../src/supabaseStore');

test('saveRoster uses only the roster RPC and scopes the submitted entries to one roster',async()=>{
  const calls=[];
  const persistedRosterId=randomUUID();
  const client={
    from(table){calls.push({kind:'from',table});throw new Error(`Unexpected table request: ${table}`);},
    async rpc(name,args){calls.push({kind:'rpc',name,args});return{data:persistedRosterId,error:null};},
  };
  const store=createSupabaseStore('https://example.supabase.co','test-key',client);
  const roster={
    id:'roster-2026-11',month:'2026-11',status:'validated',generatedAt:'2026-11-01T00:00:00.000Z',validatedAt:null,
    entries:[{id:'2026-11-01:brand:process:employee',date:'2026-11-01',brandId:randomUUID(),processId:randomUUID(),employeeId:randomUUID(),source:'generated'}],
  };

  const saved=await store.saveRoster(roster);

  assert.equal(calls.length,1);
  assert.equal(calls[0].kind,'rpc');
  assert.equal(calls[0].name,'save_roster');
  assert.equal(calls[0].args.p_roster.month,'2026-11-01');
  assert.equal(calls[0].args.p_roster.entries.length,1);
  assert.equal(calls[0].args.p_roster.entries[0].work_date,'2026-11-01');
  assert.equal(Object.hasOwn(calls[0].args.p_roster.entries[0],'roster_id'),false);
  assert.equal(saved.id,persistedRosterId);
  assert.match(saved.entries[0].id,/^[0-9a-f-]{36}$/i);
});

test('workforce persistence never writes or deletes roster data',async()=>{
  const calls=[];
  const client={
    from(table){
      const query={
        eq(column,value){calls.push({table,operation:'filter',column,value});return query;},
        not(column,operator,value){calls.push({table,operation:'exclude',column,operator,value});return query;},
        then(resolve,reject){calls.push({table,operation:'delete'});return Promise.resolve({data:[],error:null}).then(resolve,reject);},
      };
      return {
        upsert(values){calls.push({table,operation:'upsert',values});return Promise.resolve({data:[],error:null});},
        delete(){return query;},
      };
    },
    async rpc(name){calls.push({operation:'rpc',name});return{data:randomUUID(),error:null};},
  };
  const store=createSupabaseStore('https://example.supabase.co','test-key',client);
  await store.saveWorkforce({
    pods:[],employees:[],processes:[],brands:[],holidays:[],availability:[],
    rosters:[{id:randomUUID(),month:'2026-11',entries:[{id:randomUUID(),date:'2026-11-01'}]}],
  });
  assert.equal(calls.some(call=>['rosters','roster_entries'].includes(call.table)),false);
  assert.equal(calls.some(call=>call.operation==='rpc'),false);
});

test('roster RPC migration writes only roster tables',()=>{
  const migration=fs.readFileSync(path.join(__dirname,'..','supabase','migrations','202611030001_save_roster_rpc.sql'),'utf8');
  const writtenTables=[...migration.matchAll(/(?:insert\s+into|delete\s+from)\s+public\.([a-z_]+)/gi)].map(match=>match[1]);
  assert.ok(writtenTables.length>0);
  assert.deepEqual([...new Set(writtenTables)].sort(),['roster_entries','rosters']);
});

test('roster RPC is invoker-only, transaction-wrapped, and executable only by service_role',()=>{
  const migration=fs.readFileSync(path.join(__dirname,'..','supabase','migrations','202611030001_save_roster_rpc.sql'),'utf8');
  assert.match(migration,/^begin;\s/i);
  assert.match(migration,/security\s+invoker/i);
  assert.match(migration,/revoke\s+execute\s+on\s+function\s+public\.save_roster\(jsonb\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*;/i);
  assert.match(migration,/grant\s+execute\s+on\s+function\s+public\.save_roster\(jsonb\)\s+to\s+service_role\s*;/i);
  assert.match(migration,/commit;\s*$/i);
});

test('roster generation and roster edits use roster-only persistence',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','src','index.js'),'utf8');
  const generation=source.match(/app\.post\('\/api\/rosters\/generate',[\s\S]*?\n\}\);/);
  const manualEdit=source.match(/app\.patch\('\/api\/rosters\/:month\/entries\/:entryId',[\s\S]*?\n\}\);/);
  const validation=source.match(/app\.post\('\/api\/rosters\/:month\/validate',[\s\S]*?\n\}\);/);
  assert.ok(generation&&generation[0].includes('persistRoster(roster)'));
  assert.ok(manualEdit&&manualEdit[0].includes('persistRoster(roster)'));
  assert.ok(validation&&validation[0].includes('persistRoster(roster)'));
});
