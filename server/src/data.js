const processNames = ['Customer Support', 'Abandoned Cart Conversions', 'Retention', 'Non-Delivery Report'];
const uuid = (n) => `${Number(n).toString(16).padStart(8,'0')}-0000-4000-8000-000000000000`;
const pods = [
  { id: uuid(10), name: 'Mumbai Central', lead: uuid(100) },
  { id: uuid(11), name: 'Pune West', lead: uuid(107) },
  { id: uuid(12), name: 'Bengaluru South', lead: uuid(114) },
  { id: uuid(13), name: 'Hyderabad Deccan', lead: uuid(121) },
  { id: uuid(14), name: 'Gurugram North', lead: uuid(128) },
];
const names = [
  'Aarav Kulkarni','Sana Deshmukh','Rohan Patil','Anagha Joshi','Siddharth More','Isha Bendre','Aditya Shinde',
  'Aditi Sharma','Arjun Bhatia','Kavya Saini','Nikhil Verma','Meher Gill','Farhan Siddiqui','Ritu Awasthi',
  'Nandini Krishnan','Karthik Subramanian','Meera Nair','Vignesh Iyer','Lakshmi Menon','Rahul Reddy','Sneha Rao',
  'Anirban Chatterjee','Madhuri Das','Pranav Mohanty','Jahanvi Shah','Tenzin Dolma','Ayesha Contractor','Gurpreet Kaur',
  'Joel D’Souza','Pooja Borkar','Sourav Dutta','Mariam Thomas',
];
const employees = names.map((name, i) => ({
  id: uuid(100+i), employeeCode: `DS-${String(i + 1).padStart(3, '0')}`, name,
  email: `${name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replaceAll('’', '').toLowerCase().replaceAll(' ', '.')}@example.test`, podId: pods[Math.floor(i / 7)].id,
  role: [0,7,14,21,28].includes(i) ? 'Pod Lead' : i === 31 ? 'Operations Manager' : [2,5,9,12,16,19,24,27].includes(i) ? 'Senior Operations Associate' : 'Operations Associate', active: true,
  weeklyOffs: [[0,6],[1,2],[2,3],[3,4],[4,5],[5,0],[6,1]][i % 7],
  preferredOffs: [[1],[3],[4],[5],[6],[2],[0]][i % 7],
  brandIds: [], processIds: [],
}));
const brandNames = [
  'Aavaran Living','Nivara Home','Urban Mitti','House of Veda','Zariya Fashion','Neem & Co.','Sattva Essentials','The Daily Ritual',
  'Mysa Organics','Kosha Kitchen','Aarika Studio','Monsoon Pantry','Tattva Naturals','Paper Boat Home','Indie Loom','Mitti & More',
  'Namma Wellness','Gulmohar Kids','Cedar & Clay','Rasa Beauty','Sunday Saree Co.','Good Earth Pantry','Katha Living','Little Millet Co.',
];
const brands = brandNames.map((name,i) => ({
  id: uuid(1000+i), name, active: true, timezone: 'Asia/Kolkata',
  operatingDays: i % 4 === 0 ? [1,2,3,4,5,6,0] : i % 3 === 0 ? [1,2,3,4,5,6] : [1,2,3,4,5],
  holidayPolicy: i % 4 === 0 ? 'operate' : 'closed',
  processIds: i % 5 === 2 ? ['cs','retention'] : i % 5 === 4 ? ['cs','ndr'] : ['cs'],
  processMinimums: Object.fromEntries((i % 5 === 2 ? ['cs','retention'] : i % 5 === 4 ? ['cs','ndr'] : ['cs']).map(processId=>[processId,1])),
  dailyMinimums: {},
  minStaff: i < 19 ? 1 : 2,
}));
const processes = processNames.map((name,i) => ({ id: uuid(2000+i), name, active: true, minStaff:1, operatingDays: i === 1 ? [1,2,3,4,5,6] : i === 2 ? [1,2,3,4,5] : [1,2,3,4,5,6,0], holidayPolicy: i === 3 ? 'closed' : 'operate' }));
const processIds = { cs:processes[0].id, acc:processes[1].id, retention:processes[2].id, ndr:processes[3].id };
for(const brand of brands){brand.processIds=brand.processIds.map(id=>processIds[id]);brand.processMinimums=Object.fromEntries(Object.entries(brand.processMinimums).map(([key,value])=>[processIds[key],value]));}
for(const employee of employees)employee.processIds=employee.processIds.map(id=>processIds[id]);
// Nineteen of 24 accounts have one assigned resource; the rest have shared coverage.
brands.forEach((brand, i) => {
  const count = i < 19 ? 1 : i < 23 ? 2 : 3;
  const start = i < 19 ? i : i < 23 ? 19 + (i - 19) * 2 : 27;
  const pool = employees.slice(start, start + count);
  pool.forEach((employee, j) => {
    if (!employee.brandIds.includes(brand.id)) employee.brandIds.push(brand.id);
    brand.processIds.forEach((processId, processIndex) => {
      if ((count === 1 || j === processIndex || processId === processIds.cs) && !employee.processIds.includes(processId)) employee.processIds.push(processId);
    });
  });
});
// A small number of specialists provide planned cover across client accounts.
for (const [employeeIndex, brandIndex] of [[19,21],[21,22]]) {
  const employee=employees[employeeIndex], brand=brands[brandIndex];
  employee.brandIds.push(brand.id);
  for(const processId of brand.processIds)if(!employee.processIds.includes(processId))employee.processIds.push(processId);
}
employees.forEach((employee) => {
  if (!employee.brandIds.length && employee.role !== 'Operations Manager') employee.role = 'Operations Coordinator';
  if (!employee.processIds.length) employee.processIds.push(processIds.cs);
});
const year = 2026;
const holidays = [
  { id:uuid(3000), date:`${year}-01-26`, name:'Republic Day', scope:'all' },
  { id:uuid(3001), date:`${year}-03-04`, name:'Holi', scope:'all' },
  { id:uuid(3002), date:`${year}-08-15`, name:'Independence Day', scope:'all' },
  { id:uuid(3003), date:`${year}-09-14`, name:'Ganesh Chaturthi', scope:'all' },
  { id:uuid(3004), date:`${year}-10-02`, name:'Gandhi Jayanti', scope:'all' },
  { id:uuid(3005), date:`${year}-10-20`, name:'Dussehra', scope:'all' },
  { id:uuid(3006), date:`${year}-11-08`, name:'Diwali', scope:'all' },
  { id:uuid(3007), date:`${year}-12-25`, name:'Christmas Day', scope:'all' },
];
const today = new Date();
const dateAt = (offset) => { const d = new Date(today); d.setDate(d.getDate()+offset); return d.toISOString().slice(0,10); };
const availability = [
  {id:uuid(4000),employeeId:employees[3].id,date:dateAt(3),type:'leave',status:'approved',note:'Family commitment'},
  {id:uuid(4001),employeeId:employees[10].id,date:dateAt(5),type:'leave',status:'pending',note:'Planned annual leave'},
  {id:uuid(4002),employeeId:employees[19].id,date:dateAt(1),type:'comp_off',status:'approved',note:'Comp-off for weekend coverage'},
  {id:uuid(4003),employeeId:employees[27].id,date:dateAt(-1),type:'leave',status:'approved',note:'Personal leave'},
  {id:uuid(4004),employeeId:employees[15].id,date:dateAt(12),type:'comp_off',status:'pending',note:'Comp-off request'},
];
module.exports = { employees, brands, processes, pods, holidays, availability };
