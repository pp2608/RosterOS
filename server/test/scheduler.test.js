const test = require('node:test');
const assert = require('node:assert/strict');
const { generateRoster, validateRoster, calculateCoverage } = require('../src/scheduler');
const date='2026-11-02'; // Monday, deliberately not a public holiday.
const day=(value)=>new Date(`${value}T00:00:00Z`).getUTCDay();
const process=(id,operatingDays=[0,1,2,3,4,5,6],holidayPolicy='operate',minStaff=1)=>({id,name:id,active:true,operatingDays,holidayPolicy,minStaff});
const brand=(id,processIds,minStaff=1,operatingDays=[0,1,2,3,4,5,6],holidayPolicy='operate',processMinimums={})=>({id,name:`Brand ${id}`,active:true,processIds,minStaff,operatingDays,holidayPolicy,processMinimums});
const employee=(id,brandIds,processIds,weeklyOffs=[],preferredOffs=[])=>({id,name:`Employee ${id}`,active:true,brandIds,processIds,weeklyOffs,preferredOffs});
const unavailable=(employeeId,type='leave',status='approved',onDate=date)=>({id:`${employeeId}-${type}`,employeeId,date:onDate,type,status});
function schedule({employees,brands,processes,holidays=[],availability=[]}){return generateRoster({month:'2026-11',employees,brands,processes,holidays,availability});}
function dayEntries(roster,onDate=date){return roster.entries.filter(e=>e.date===onDate);}
function issues(roster,onDate=date){return roster.conflicts.filter(e=>e.date===onDate);}

test('Scenario 1: one unavailable owner creates an explained gap for every process on a single-resource brand',()=>{
  const roster=schedule({employees:[employee('e1',['b1'],['cs','acc'])],brands:[brand('b1',['cs','acc'])],processes:[process('cs'),process('acc')],availability:[unavailable('e1')]});
  assert.deepEqual(dayEntries(roster).map(e=>e.processId),[]);
  const processGaps=issues(roster).filter(c=>c.type==='process_coverage_gap');
  assert.equal(processGaps.length,2);
  for(const conflict of processGaps){assert.equal(conflict.severity,'critical');assert.match(conflict.message,/needs 1 distinct staff; 0 assigned/);assert.match(conflict.message,/approved unavailability/);}
  assert.equal(issues(roster).filter(c=>c.type==='brand_coverage_gap').length,1);
});

test('Scenario 2: a three-person, process-split brand preserves coverage when one worker is away',()=>{
  const roster=schedule({employees:[employee('e1',['b1'],['cs']),employee('e2',['b1'],['acc']),employee('e3',['b1'],['ndr'])],brands:[brand('b1',['cs','acc','ndr'])],processes:[process('cs'),process('acc'),process('ndr')],availability:[unavailable('e1')]});
  assert.deepEqual(dayEntries(roster).map(e=>e.processId).sort(),['acc','ndr']);
  assert.equal(issues(roster).some(c=>c.processId==='cs'&&c.severity==='critical'),true);
  assert.equal(issues(roster).some(c=>c.processId==='acc'||c.processId==='ndr'),false);
  assert.match(issues(roster).find(c=>c.processId==='cs').message,/Only 0 eligible employees/);
});

test('Scenario 3: a shared process is covered by the remaining assigned employee',()=>{
  const roster=schedule({employees:[employee('e1',['b1'],['cs']),employee('e2',['b1'],['cs'])],brands:[brand('b1',['cs'])],processes:[process('cs')],availability:[unavailable('e1')]});
  assert.deepEqual(dayEntries(roster).map(e=>e.employeeId),['e2']);
  assert.equal(issues(roster).length,0);
});

test('Scenario 4: Sunday and public holiday policies are applied separately at process level',()=>{
  const sunday='2026-11-01';
  const roster=schedule({employees:[employee('e1',['b-weekend'],['weekend']),employee('e2',['b-closed'],['closed']),employee('e3',['b-holiday'],['holiday'])],brands:[brand('b-weekend',['weekend'],1,[0],'operate'),brand('b-closed',['closed'],1,[0],'operate'),brand('b-holiday',['holiday'],1,[0],'operate')],processes:[process('weekend',[0],'operate'),process('closed',[1,2,3,4,5,6],'closed'),process('holiday',[0],'operate')],holidays:[{date:sunday,name:'Foundation Day',scope:'all'}]});
  assert.equal(dayEntries(roster,sunday).some(e=>e.processId==='weekend'),true);
  assert.equal(dayEntries(roster,sunday).some(e=>e.processId==='holiday'),true);
  assert.equal(dayEntries(roster,sunday).some(e=>e.processId==='closed'),false);
  assert.equal(issues(roster,sunday).some(c=>c.processId==='closed'),false);
});

test('Scenario 5: an employee assigned to multiple brands cannot cover both at the same time',()=>{
  const roster=schedule({employees:[employee('e1',['b1','b2'],['cs'])],brands:[brand('b1',['cs']),brand('b2',['cs'])],processes:[process('cs')]});
  assert.deepEqual(dayEntries(roster).map(e=>e.brandId),['b1']);
  const gap=issues(roster).find(c=>c.brandId==='b2');
  assert.equal(gap.severity,'critical');
  assert.match(gap.message,/already committed to another brand/);
});

test('Scarcity-first generation reserves a shared employee for the brand with no alternate',()=>{
  const roster=schedule({
    employees:[employee('shared',['b1','b2'],['cs']),employee('b1-only',['b1'],['cs'])],
    brands:[brand('b1',['cs']),brand('b2',['cs'])],
    processes:[process('cs')],
  });
  const assignments=dayEntries(roster).map(entry=>[entry.brandId,entry.employeeId]).sort((a,b)=>a[0].localeCompare(b[0]));
  assert.deepEqual(assignments,[['b1','b1-only'],['b2','shared']]);
  assert.equal(issues(roster).filter(issue=>issue.severity==='critical').length,0);
});

test('Generated brand-extra slots can use any eligible operating process without duplicate employees',()=>{
  const employees=[employee('cs-person',['b1'],['cs']),employee('retention-person',['b1'],['retention']),employee('extra-person',['b1'],['retention'])];
  const roster=schedule({employees,brands:[brand('b1',['cs','retention'],3,[1],'operate',{cs:1,retention:1})],processes:[process('cs',[1]),process('retention',[1])]});
  const assignments=dayEntries(roster);
  assert.equal(assignments.length,3);
  assert.equal(new Set(assignments.map(entry=>entry.employeeId)).size,3);
  assert.equal(new Set(assignments.map(entry=>entry.processId)).size,2);
  assert.equal(issues(roster).length,0);
});

test('Approved leave and comp-off block a shift while pending leave does not',()=>{
  const employees=[employee('e1',['b1'],['cs']),employee('e2',['b1'],['cs'])];
  const common={employees,brands:[brand('b1',['cs'])],processes:[process('cs')]};
  const blocked=schedule({...common,availability:[unavailable('e1','leave'),unavailable('e2','comp_off')]});
  assert.equal(dayEntries(blocked).length,0);
  assert.equal(issues(blocked)[0].assigned,0);
  assert.match(issues(blocked)[0].message,/Only 0 eligible employees/);
  const pending=schedule({...common,availability:[unavailable('e1','leave'),unavailable('e2','leave','pending')]});
  assert.deepEqual(dayEntries(pending).map(e=>e.employeeId),['e2']);
  assert.equal(issues(pending).length,0);
});

test('Insufficient process staffing reports required and available resource counts',()=>{
  const roster=schedule({employees:[employee('e1',['b1'],['cs'])],brands:[brand('b1',['cs'],2,[0,1,2,3,4,5,6],'operate',{cs:2})],processes:[process('cs')]});
  const conflict=issues(roster)[0];
  assert.equal(conflict.type,'process_coverage_gap');assert.equal(conflict.severity,'critical');assert.equal(conflict.required,2);assert.equal(conflict.assigned,1);
  assert.match(conflict.message,/needs 2 distinct staff; 1 assigned/);
  assert.match(conflict.message,/Only 1 eligible employees are available/);
});

test('Brand-level minimum is validated separately from fully staffed individual processes',()=>{
  const roster=schedule({employees:[employee('e1',['b1'],['cs'])],brands:[brand('b1',['cs'],2,[0,1,2,3,4,5,6],'operate',{cs:1})],processes:[process('cs')]});
  assert.equal(dayEntries(roster).length,1);
  assert.equal(issues(roster).some(c=>c.type==='process_coverage_gap'),false);
  const conflict=issues(roster).find(c=>c.type==='brand_coverage_gap');
  assert.equal(conflict.severity,'critical');assert.equal(conflict.required,2);assert.equal(conflict.assigned,1);
  assert.match(conflict.message,/requires 2 distinct staff across its operating processes/);
});

test('Manual assignment to an ineligible employee is revalidated and flagged',()=>{
  const state={employees:[employee('e1',['b1'],['cs']),employee('e2',['b2'],['cs'])],brands:[brand('b1',['cs']),brand('b2',['cs'])],processes:[process('cs')],holidays:[],availability:[]};
  const roster=generateRoster({month:'2026-11',...state});
  const entry=roster.entries.find(e=>e.date===date&&e.brandId==='b1');
  assert.ok(entry);entry.employeeId='e2';entry.source='manual';
  const validated=validateRoster(roster,state);
  assert.equal(validated.status,'needs_review');
  assert.equal(validated.conflicts.some(c=>c.type==='scheduling_conflict'&&c.severity==='critical'&&c.employeeId==='e2'),true);
  assert.equal(validated.conflicts.some(c=>c.type==='process_coverage_gap'&&c.brandId==='b1'),true);
});

test('Employee weekly offs override a soft preferred-off preference',()=>{
  const roster=schedule({employees:[employee('e1',['b1'],['cs'],[0],[1])],brands:[brand('b1',['cs'])],processes:[process('cs')]});
  const monday=dayEntries(roster).find(e=>e.date===date);
  assert.equal(monday.employeeId,'e1');
  assert.equal(issues(roster).some(c=>c.severity==='critical'),false);
  assert.equal(issues(roster).some(c=>c.severity==='warning'&&c.type==='preference_conflict'),true);
});

test('Sunday closures do not create process or brand staffing requirements',()=>{
  const sunday='2026-11-01';
  const roster=schedule({employees:[],brands:[brand('closed-brand',['weekday-only'],2,[1,2,3,4,5,6,0],'operate')],processes:[process('weekday-only',[1,2,3,4,5,6],'operate')]});
  assert.equal(issues(roster,sunday).length,0);
});

test('Operating Sundays require staffing only for processes open on Sunday',()=>{
  const sunday='2026-11-01';
  const roster=schedule({employees:[employee('e1',['b1'],['sun'])],brands:[brand('b1',['sun','weekday'],1,[0,1,2,3,4,5,6],'operate')],processes:[process('sun',[0]),process('weekday',[1,2,3,4,5,6])]});
  assert.deepEqual(dayEntries(roster,sunday).map(e=>e.processId),['sun']);
  assert.equal(issues(roster,sunday).some(c=>c.processId==='weekday'),false);
});

test('Brand-scoped public holidays obey both brand and process policies',()=>{
  const date='2026-11-01';
  const roster=schedule({employees:[],brands:[brand('closed-brand',['closed-process'],1,[0],'closed'),brand('open-brand',['closed-process'],1,[0],'operate')],processes:[process('closed-process',[0],'closed')],holidays:[{date,name:'Local holiday',scope:'closed-brand'}]});
  assert.equal(issues(roster,date).filter(c=>c.brandId==='closed-brand').length,0);
  assert.equal(issues(roster,date).filter(c=>c.brandId==='open-brand').length,2);
  const openRoster=schedule({employees:[],brands:[brand('open-brand',['open-process'],1,[0],'operate')],processes:[process('open-process',[0],'operate')],holidays:[{date,name:'Local holiday',scope:'open-brand'}]});
  assert.equal(issues(openRoster,date).filter(c=>c.type==='process_coverage_gap'||c.type==='brand_coverage_gap').length,2);
});

test('Brand minimum adds only staffing above process minimum totals',()=>{
  const roster=schedule({employees:[employee('e1',['b1'],['cs']),employee('e2',['b1'],['cs'])],brands:[brand('b1',['cs'],2,[0,1,2,3,4,5,6],'operate',{cs:1})],processes:[process('cs')]});
  assert.equal(dayEntries(roster).length,2);
  assert.equal(issues(roster).length,0);
  const coverage=require('../src/scheduler').calculateCoverage(roster,{employees:[employee('e1',['b1'],['cs']),employee('e2',['b1'],['cs'])],brands:[brand('b1',['cs'],2,[0,1,2,3,4,5,6],'operate',{cs:1})],processes:[process('cs')],holidays:[],availability:[]});
  assert.deepEqual({fulfilled:coverage.fulfilledSlots,required:coverage.requiredSlots,percentage:coverage.percentage},{fulfilled:90,required:90,percentage:100});
});

test('Coverage percentage counts fulfilled distinct slots rather than assignment rows',()=>{
  const employeeA=employee('e1',['b1'],['cs']);
  const employeeB=employee('e2',['b1'],['cs']);
  const brandData=brand('b1',['cs'],1,[1],'operate',{cs:2});
  const processData=process('cs', [1], 'operate', 2);
  const {calculateCoverage}=require('../src/scheduler');
  const entries=['02','09','16','23','30'].flatMap(day=>[
    {date:`2026-11-${day}`,brandId:'b1',processId:'cs',employeeId:'e1'},
    {date:`2026-11-${day}`,brandId:'b1',processId:'cs',employeeId:'e1'},
  ]);
  const coverage=calculateCoverage({month:'2026-11',entries},{employees:[employeeA,employeeB],brands:[brandData],processes:[processData],holidays:[],availability:[]});
  assert.deepEqual({fulfilled:coverage.fulfilledSlots,required:coverage.requiredSlots,percentage:coverage.percentage},{fulfilled:10,required:15,percentage:67});
});

test('Coverage matching avoids greedy undercount when one employee is assigned to multiple eligible processes',()=>{
  const e1=employee('e1',['b1'],['cs','retention']);
  const e2=employee('e2',['b1'],['cs']);
  const brandData=brand('b1',['cs','retention']);
  const processData=[process('cs',[1]),process('retention',[1])];
  const mondays=Array.from({length:30},(_,i)=>`2026-11-${String(i+1).padStart(2,'0')}`).filter(d=>day(d)===1);
  const entries=mondays.flatMap(onDate=>[
    {date:onDate,brandId:'b1',processId:'cs',employeeId:'e1'},
    {date:onDate,brandId:'b1',processId:'cs',employeeId:'e2'},
    {date:onDate,brandId:'b1',processId:'retention',employeeId:'e1'},
  ]);
  const roster={month:'2026-11',entries};
  const state={employees:[e1,e2],brands:[brandData],processes:processData,holidays:[],availability:[]};

  // Reproduce the previous first-match walk for this fixture to compare results.
  let oldFulfilled=0;
  for(const onDate of mondays){
    const used=new Set();
    for(const processDataItem of processData){
      const match=entries.filter(e=>e.date===onDate&&e.brandId==='b1'&&e.processId===processDataItem.id).find(e=>{
        const person=state.employees.find(x=>x.id===e.employeeId);
        return !used.has(e.employeeId)&&person.brandIds.includes('b1')&&person.processIds.includes(processDataItem.id);
      });
      if(match){used.add(match.employeeId);oldFulfilled+=1;}
    }
  }

  const coverage=calculateCoverage(roster,state);
  assert.equal(oldFulfilled,5);
  assert.deepEqual({fulfilled:coverage.fulfilledSlots,required:coverage.requiredSlots,percentage:coverage.percentage},{fulfilled:15,required:15,percentage:100});
});

test('Brand extra slots can be matched to an eligible assignment on any operating process',()=>{
  const employees=[employee('e1',['b1'],['cs']),employee('e2',['b1'],['retention']),employee('e3',['b1'],['retention'])];
  const brandData=brand('b1',['cs','retention'],3,[1],'operate',{cs:1,retention:1});
  const processData=[process('cs',[1]),process('retention',[1])];
  const mondays=Array.from({length:30},(_,i)=>`2026-11-${String(i+1).padStart(2,'0')}`).filter(d=>day(d)===1);
  const entries=mondays.flatMap(onDate=>[
    {date:onDate,brandId:'b1',processId:'cs',employeeId:'e1'},
    {date:onDate,brandId:'b1',processId:'retention',employeeId:'e2'},
    {date:onDate,brandId:'b1',processId:'retention',employeeId:'e3'},
  ]);
  const coverage=calculateCoverage({month:'2026-11',entries},{employees,brands:[brandData],processes:processData,holidays:[],availability:[]});
  assert.deepEqual({fulfilled:coverage.fulfilledSlots,required:coverage.requiredSlots,percentage:coverage.percentage},{fulfilled:25,required:25,percentage:100});
});

test('Coverage matching lets one employee satisfy at most one slot across brands per day',()=>{
  const person=employee('e1',['b1','b2'],['cs']);
  const brands=[brand('b1',['cs'],1,[1]),brand('b2',['cs'],1,[1])];
  const entries=brands.map(b=>({date,brandId:b.id,processId:'cs',employeeId:'e1'}));
  const coverage=calculateCoverage({month:'2026-11',entries},{employees:[person],brands,processes:[process('cs',[1])],holidays:[],availability:[]});
  assert.deepEqual({fulfilled:coverage.fulfilledSlots,required:coverage.requiredSlots},{fulfilled:0,required:20});
});

test('Coverage matching still excludes assignments blocked by eligibility, calendars, weekly offs, or approved leave',()=>{
  const person=employee('e1',['b1'],['cs'],[1]);
  const brandData=brand('b1',['cs'],1,[1],'closed');
  const processData=process('cs',[1],'closed');
  const entry={date,brandId:'b1',processId:'cs',employeeId:'e1'};
  const coverageFor=(overrides={})=>calculateCoverage({month:'2026-11',entries:[entry]},{employees:[person],brands:[brandData],processes:[processData],holidays:[],availability:[],...overrides});
  assert.equal(coverageFor().fulfilledSlots,0); // weekly off
  assert.equal(coverageFor({employees:[{...person,weeklyOffs:[]}],availability:[unavailable('e1')]}).fulfilledSlots,0);
  assert.equal(coverageFor({employees:[{...person,weeklyOffs:[]}],holidays:[{date,name:'Closure',scope:'all'}]}).fulfilledSlots,0);
  assert.equal(coverageFor({employees:[{...person,weeklyOffs:[],processIds:[]}]}).fulfilledSlots,0);
});

test('One employee may cover multiple processes on the same brand and day',()=>{
  const roster=schedule({employees:[employee('e1',['b1'],['cs','retention'])],brands:[brand('b1',['cs','retention'])],processes:[process('cs'),process('retention')]});
  assert.equal(dayEntries(roster).length,2);
  assert.equal(issues(roster).filter(c=>c.type==='process_coverage_gap').length,0);
  assert.equal(issues(roster).filter(c=>c.type==='brand_coverage_gap').length,0);
  assert.equal(calculateCoverage(roster,{employees:[employee('e1',['b1'],['cs','retention'])],brands:[brand('b1',['cs','retention'])],processes:[process('cs'),process('retention')],holidays:[],availability:[]}).brandFulfilledEmployees,30);
});

test('Validation accepts same-brand multi-process work and rejects duplicate same-process assignments',()=>{
  const state={employees:[employee('e1',['b1'],['cs','retention'])],brands:[brand('b1',['cs','retention'])],processes:[process('cs'),process('retention')],holidays:[],availability:[]};
  const roster={id:'test',month:'2026-11',entries:[{id:'a',date,brandId:'b1',processId:'cs',employeeId:'e1'},{id:'b',date,brandId:'b1',processId:'retention',employeeId:'e1'}],conflicts:[]};
  validateRoster(roster,state);
  assert.equal(roster.conflicts.some(c=>c.type==='scheduling_conflict'),false);
  roster.entries.push({id:'c',date,brandId:'b1',processId:'cs',employeeId:'e1'});
  validateRoster(roster,state);
  assert.equal(roster.conflicts.some(c=>c.id==='duplicate:c'),true);
});

test('Validation marks every row in a duplicate same-process assignment invalid',()=>{
  const state={employees:[employee('e1',['b1'],['cs'])],brands:[brand('b1',['cs'])],processes:[process('cs')],holidays:[],availability:[]};
  const roster={month:'2026-11',entries:[
    {id:'first',date,brandId:'b1',processId:'cs',employeeId:'e1'},
    {id:'second',date,brandId:'b1',processId:'cs',employeeId:'e1'},
  ]};
  const result=validateRoster(roster,state);
  assert.deepEqual(result.conflicts.filter(conflict=>conflict.id.startsWith('duplicate:')).map(conflict=>conflict.entryId).sort(),['first','second']);
  assert.equal(calculateCoverage(roster,state).fulfilledSlots,2);
});

test('48-person sample preserves the approved ownership and relief fixture',()=>{
  const sample=require('../src/data');
  assert.equal(sample.employees.length,48);
  assert.equal(sample.brands.length,24);
  assert.equal(sample.employees.filter(employee=>employee.primaryBrandIds.length>0).length,30);
  assert.equal(sample.employees.filter(employee=>employee.reliefGroup).length,18);
  assert.equal(sample.brands.filter(brand=>sample.employees.filter(employee=>employee.primaryBrandIds.includes(brand.id)).length===1).length,19);
  assert.equal(sample.employees.find(employee=>employee.name==='Relief Associate 9').brandIds.length,16);
});

test('Brand coverage counts a same-brand multi-process employee once toward distinct headcount',()=>{
  const person=employee('e1',['b1'],['cs','retention']);
  const brandData=brand('b1',['cs','retention'],2);
  const roster={month:'2026-11',entries:[
    {id:'cs',date,brandId:'b1',processId:'cs',employeeId:'e1'},
    {id:'retention',date,brandId:'b1',processId:'retention',employeeId:'e1'},
  ]};
  const coverage=calculateCoverage(roster,{employees:[person],brands:[brandData],processes:[process('cs'),process('retention')],holidays:[],availability:[]});
  assert.equal(coverage.processFulfilledSlots,2);
  assert.equal(coverage.brandFulfilledEmployees,1);
  const evaluated=validateRoster(roster,{employees:[person],brands:[brandData],processes:[process('cs'),process('retention')],holidays:[],availability:[]});
  assert.equal(evaluated.conflicts.some(conflict=>conflict.type==='brand_coverage_gap'&&conflict.required===2&&conflict.assigned===1),true);
});

test('Cross-brand same-day validation rejects every colliding assignment and excludes them from coverage',()=>{
  const person=employee('shared',['b1','b2'],['cs']);
  const state={employees:[person],brands:[brand('b1',['cs']),brand('b2',['cs'])],processes:[process('cs')],holidays:[],availability:[]};
  const roster={month:'2026-11',entries:[
    {id:'one',date,brandId:'b1',processId:'cs',employeeId:'shared'},
    {id:'two',date,brandId:'b2',processId:'cs',employeeId:'shared'},
  ]};
  const validated=validateRoster(roster,state);
  assert.equal(validated.conflicts.filter(conflict=>conflict.type==='scheduling_conflict'&&conflict.date===date).length,2);
  assert.equal(calculateCoverage(roster,state).fulfilledSlots,0);
});

test('Validation flags manual assignment on leave, weekly off, or a closed calendar',()=>{
  const base={employees:[employee('e1',['b1'],['cs'])],brands:[brand('b1',['cs'],1,[1,2,3,4,5,6],'closed')],processes:[process('cs',[1,2,3,4,5,6],'closed')],holidays:[],availability:[]};
  const make=()=>({id:'test',month:'2026-11',entries:[{id:'manual',date:'2026-11-01',brandId:'b1',processId:'cs',employeeId:'e1',source:'manual'}],conflicts:[]});
  const leave=make();validateRoster(leave,{...base,availability:[unavailable('e1','leave','approved','2026-11-01')]});
  assert.equal(leave.conflicts.some(c=>c.id==='away:manual'&&c.severity==='critical'),true);
  const off=make();off.entries[0].date='2026-11-02';base.employees[0].weeklyOffs=[1];validateRoster(off,base);
  assert.equal(off.conflicts.some(c=>c.id==='off:manual'&&c.severity==='critical'),true);
  const closed=make();validateRoster(closed,base);
  assert.equal(closed.conflicts.some(c=>c.id==='calendar_conflict:manual'&&c.severity==='critical'),true);
});

test('Preference notices stay advisory while coverage gaps remain critical',()=>{
  const roster=schedule({employees:[employee('e1',['b1'],['cs'],[],[1])],brands:[brand('b1',['cs'],1,[0,1,2,3,4,5,6],'operate',{cs:2})],processes:[process('cs')]});
  assert.equal(roster.conflicts.some(c=>c.type==='preference_conflict'&&c.severity==='warning'),true);
  assert.equal(roster.conflicts.some(c=>c.type==='process_coverage_gap'&&c.severity==='critical'),true);
});

test('Roster candidate ordering is deterministic for unchanged inputs',()=>{
  const input={employees:[employee('e2',['b1'],['cs'],[],[1]),employee('e1',['b1'],['cs'])],brands:[brand('b1',['cs'])],processes:[process('cs')]};
  const first=schedule(input),second=schedule(input);
  const assignments=roster=>roster.entries.map(e=>[e.date,e.brandId,e.processId,e.employeeId]);
  assert.deepEqual(assignments(first),assignments(second));
});
