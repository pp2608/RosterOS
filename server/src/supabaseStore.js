const { createClient } = require('@supabase/supabase-js');
const { validateRoster } = require('./scheduler');

function createSupabaseStore(url,key,providedClient){
  const client=providedClient||createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const assert=(result)=>{if(result.error)throw new Error(`Supabase ${result.error.message}`);return result.data||[]};
  async function rows(table){return assert(await client.from(table).select('*'));}
  async function upsert(table,values){if(values.length)assert(await client.from(table).upsert(values));}
  async function load(){
    const [pods,employees,brands,processes,availability,holidays,employeeBrands,employeeProcesses,brandProcesses,rosters,entries]=await Promise.all([
      'pods','employees','brands','processes','availability','holidays','employee_brands','employee_processes','brand_processes','rosters','roster_entries'].map(rows));
    const empBrand=new Map(),empProcess=new Map(),brandProc=new Map();
    for(const link of employeeBrands)empBrand.set(link.employee_id,[...(empBrand.get(link.employee_id)||[]),link.brand_id]);
    for(const link of employeeProcesses)empProcess.set(link.employee_id,[...(empProcess.get(link.employee_id)||[]),link.process_id]);
    for(const link of brandProcesses)brandProc.set(link.brand_id,[...(brandProc.get(link.brand_id)||[]),link]);
    const state={
      pods:pods.map(p=>({id:p.id,name:p.name,lead:p.lead_employee_id})),
      employees:employees.map(e=>({id:e.id,employeeCode:e.employee_code,name:e.name,email:e.email,podId:e.pod_id,role:e.role,active:e.active,weeklyOffs:e.weekly_offs||[],preferredOffs:e.preferred_offs||[],brandIds:empBrand.get(e.id)||[],primaryBrandIds:employeeBrands.filter(link=>link.employee_id===e.id&&link.is_primary).map(link=>link.brand_id),processIds:empProcess.get(e.id)||[]})),
      brands:brands.map(b=>{const rel=brandProc.get(b.id)||[];return{id:b.id,name:b.name,active:b.active,timezone:b.timezone,operatingDays:b.operating_days,holidayPolicy:b.holiday_policy,minStaff:b.min_staff,dailyMinimums:b.daily_minimums||{},processIds:rel.map(r=>r.process_id),processMinimums:Object.fromEntries(rel.map(r=>[r.process_id,r.min_staff]))}}),
      processes:processes.map(p=>({id:p.id,name:p.name,active:p.active,minStaff:p.min_staff,operatingDays:p.operating_days,holidayPolicy:p.holiday_policy})),
      holidays:holidays.map(h=>({id:h.id,date:h.date,name:h.name,scope:h.scope})),
      availability:availability.map(a=>({id:a.id,employeeId:a.employee_id,date:a.date,type:a.type,status:a.status,note:a.note})),
      rosters:rosters.map(r=>({id:r.id,month:String(r.month).slice(0,7),status:r.status,generatedAt:r.generated_at,validatedAt:r.validated_at,entries:entries.filter(e=>e.roster_id===r.id).map(e=>({id:e.id,date:e.work_date,brandId:e.brand_id,processId:e.process_id,employeeId:e.employee_id,status:'assigned',source:e.source})),conflicts:[]})),
    };
    for(const roster of state.rosters)validateRoster(roster,state);
    return state;
  }
  async function saveWorkforce(state){
    await upsert('pods',state.pods.map(p=>({id:p.id,name:p.name,lead_employee_id:null})));
    await upsert('employees',state.employees.map(e=>({id:e.id,employee_code:e.employeeCode,name:e.name,email:e.email,pod_id:e.podId,role:e.role,active:e.active,weekly_offs:e.weeklyOffs||[],preferred_offs:e.preferredOffs||[]})));
    await upsert('pods',state.pods.map(p=>({id:p.id,name:p.name,lead_employee_id:p.lead||null})));
    await upsert('processes',state.processes.map(p=>({id:p.id,name:p.name,active:p.active,operating_days:p.operatingDays,holiday_policy:p.holidayPolicy,min_staff:p.minStaff||1})));
    await upsert('brands',state.brands.map(b=>({id:b.id,name:b.name,active:b.active,timezone:b.timezone||'Asia/Kolkata',operating_days:b.operatingDays,holiday_policy:b.holidayPolicy,min_staff:b.minStaff||1,daily_minimums:b.dailyMinimums||{}})));
    const primaryByEmployee=new Map(state.employees.map(e=>[e.id,new Set(e.primaryBrandIds||[])]));
    const eb=state.employees.flatMap(e=>e.brandIds.map(brand_id=>({employee_id:e.id,brand_id,is_primary:primaryByEmployee.get(e.id).has(brand_id)})));
    const ep=state.employees.flatMap(e=>e.processIds.map(process_id=>({employee_id:e.id,process_id})));
    const bp=state.brands.flatMap(b=>b.processIds.map(process_id=>({brand_id:b.id,process_id,min_staff:b.processMinimums?.[process_id]||1})));
    await upsert('employee_brands',eb);await upsert('employee_processes',ep);await upsert('brand_processes',bp);
    const pruneLinks=async(table,ownerColumn,ownerId,linkColumn,retainedIds)=>{
      let query=client.from(table).delete().eq(ownerColumn,ownerId);
      if(retainedIds.length)query=query.not(linkColumn,'in',`(${retainedIds.join(',')})`);
      assert(await query);
    };
    for(const employee of state.employees){
      await pruneLinks('employee_brands','employee_id',employee.id,'brand_id',employee.brandIds);
      await pruneLinks('employee_processes','employee_id',employee.id,'process_id',employee.processIds);
    }
    for(const brand of state.brands)await pruneLinks('brand_processes','brand_id',brand.id,'process_id',brand.processIds);
    await upsert('holidays',state.holidays.map(h=>({id:h.id,date:h.date,name:h.name,scope:h.scope||'all'})));
    await upsert('availability',state.availability.map(a=>({id:a.id,employee_id:a.employeeId,date:a.date,type:a.type,status:a.status,note:a.note||null})));
    // Workforce edits must never rewrite monthly rosters.
  }
  async function save(state){
    await saveWorkforce(state);
    // Initial synchronization retains existing behavior while writing each
    // roster through the transaction-wrapped, roster-only RPC.
    for(const roster of state.rosters)await saveRoster(roster);
  }
  async function saveRoster(roster){
    if(!/^[0-9a-f-]{36}$/i.test(roster.id))roster.id=require('node:crypto').randomUUID();
    const entries=roster.entries.map(e=>{
      if(!/^[0-9a-f-]{36}$/i.test(e.id))e.id=require('node:crypto').randomUUID();
      return {id:e.id,work_date:e.date,brand_id:e.brandId,process_id:e.processId,employee_id:e.employeeId,source:e.source||'generated'};
    });
    const result=await client.rpc('save_roster',{p_roster:{
      id:roster.id,month:`${roster.month}-01`,status:roster.status,
      generated_at:roster.generatedAt||new Date().toISOString(),validated_at:roster.validatedAt||null,entries,
    }});
    if(result.error)throw new Error(`Supabase ${result.error.message}`);
    if(typeof result.data!=='string')throw new Error('Supabase save_roster returned no roster ID.');
    roster.id=result.data;
    return roster;
  }
  return {load,save,saveWorkforce,saveRoster,client};
}
module.exports={createSupabaseStore};
