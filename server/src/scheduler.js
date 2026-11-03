const dayKey = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const monthDates = (month) => {
  const [year, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
};
const minimum = (value) => Math.max(1, Number(value) || 1);
const processRequired = (brand, process) => minimum(brand.processMinimums?.[process.id] || process.minStaff);
const brandRequired = (brand, day) => minimum(brand.dailyMinimums?.[day] || brand.minStaff);
const holidayFor = (holidays, date, brand) => holidays.find((h) => h.date === date && (h.scope === 'all' || h.scope === brand.id));
const employeeEligible = (employee, brand, process) => Boolean(employee?.active && employee.brandIds?.includes(brand.id) && employee.processIds?.includes(process.id));
const employeeAvailable = (employee, date, day, approvedAway) => Boolean(employee && !employee.weeklyOffs?.includes(day) && !approvedAway.has(`${employee.id}:${date}`));

function operatingProcesses(brand, weekday, holiday, processById) {
  if (!brand?.active || !brand.operatingDays?.includes(weekday) || (holiday && brand.holidayPolicy !== 'operate')) return [];
  return (brand.processIds || []).map((id) => processById.get(id)).filter((p) => p?.active && p.operatingDays?.includes(weekday) && (!holiday || p.holidayPolicy === 'operate'));
}

function approvedAwaySet(availability) {
  return new Set(availability.filter((item) => item.status === 'approved').map((item) => `${item.employeeId}:${item.date}`));
}

// Requirements are derived once per operating date. Process minimums are the base
// demand; a higher brand minimum adds only the difference as distinct brand slots.
function requirementsFor(brand, processes, weekday) {
  const slots = processes.flatMap((process) => Array.from({ length: processRequired(brand, process) }, (_, index) => ({ process, index, brandExtra: false })));
  const brandExtra = Math.max(0, brandRequired(brand, weekday) - slots.length);
  for (let i = 0; i < brandExtra; i += 1) slots.push({ process: processes[0], index: i, brandExtra: true });
  return { slots, brandExtra };
}

function calculateCoverage(roster, { employees, brands, processes, holidays, availability }) {
  const processById = new Map(processes.map((p) => [p.id, p]));
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const approvedAway = approvedAwaySet(availability);
  const entriesByDate = new Map();
  for (const entry of roster.entries) {
    const list = entriesByDate.get(entry.date) || [];
    list.push(entry);
    entriesByDate.set(entry.date, list);
  }
  let requiredSlots = 0;
  let fulfilledSlots = 0;
  for (const date of monthDates(roster.month)) {
    const weekday = dayKey(date);
    const slots = [];
    const dateEntries = entriesByDate.get(date) || [];
    for (const brand of brands.filter((b) => b.active)) {
      const operating = operatingProcesses(brand, weekday, holidayFor(holidays, date, brand), processById);
      if (!operating.length) continue;
      const requirements = requirementsFor(brand, operating, weekday);
      const brandEntries = dateEntries.filter((entry) => entry.brandId === brand.id);
      for (const slot of requirements.slots.filter((item) => !item.brandExtra)) {
        slots.push({
          candidates: [...new Set(brandEntries
            .filter((entry) => entry.processId === slot.process.id)
            .filter((entry) => {
              const person = employeeById.get(entry.employeeId);
              return employeeEligible(person, brand, slot.process) && employeeAvailable(person, date, weekday, approvedAway);
            })
            .map((entry) => entry.employeeId))],
        });
      }
      // Brand-level minimums are additional slots across operating processes.
      // Let matching choose the assignment that best preserves process coverage.
      for (let i = 0; i < requirements.brandExtra; i += 1) {
        slots.push({
          candidates: [...new Set(brandEntries
            .filter((entry) => operating.some((process) => process.id === entry.processId))
            .filter((entry) => {
              const person = employeeById.get(entry.employeeId);
              const assignedProcess = processById.get(entry.processId);
              return employeeEligible(person, brand, assignedProcess) && employeeAvailable(person, date, weekday, approvedAway);
            })
            .map((entry) => entry.employeeId))],
        });
      }
    }
    requiredSlots += slots.length;
    fulfilledSlots += maximumSlotMatching(slots);
  }
  return { fulfilledSlots, requiredSlots, percentage: requiredSlots ? Math.round(fulfilledSlots / requiredSlots * 100) : 100, explanation: 'Fulfilled distinct staffing slots divided by required process slots plus any additional brand minimum slots.' };
}

function maximumSlotMatching(slots) {
  const employeeToSlot = new Map();
  const assign = (slotIndex, visitedEmployees) => {
    for (const employeeId of slots[slotIndex].candidates) {
      if (visitedEmployees.has(employeeId)) continue;
      visitedEmployees.add(employeeId);
      const priorSlot = employeeToSlot.get(employeeId);
      if (priorSlot === undefined || assign(priorSlot, visitedEmployees)) {
        employeeToSlot.set(employeeId, slotIndex);
        return true;
      }
    }
    return false;
  };
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) assign(slotIndex, new Set());
  return employeeToSlot.size;
}

function allocateDailySlots(slots) {
  const employeeToAssignment = new Map();
  const assign = (slotIndex, visitedEmployees) => {
    for (const option of slots[slotIndex].options) {
      const employeeId = option.employee.id;
      if (visitedEmployees.has(employeeId)) continue;
      visitedEmployees.add(employeeId);
      const previous = employeeToAssignment.get(employeeId);
      if (!previous || assign(previous.slotIndex, visitedEmployees)) {
        employeeToAssignment.set(employeeId, { slotIndex, option });
        return true;
      }
    }
    return false;
  };
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) assign(slotIndex, new Set());
  return employeeToAssignment;
}

function generateRoster({ month, employees, brands, processes, holidays, availability }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Month must use YYYY-MM format.');
  const activeEmployees = employees.filter((e) => e.active);
  const activeBrands = brands.filter((b) => b.active);
  const processById = new Map(processes.map((p) => [p.id, p]));
  const entries = [];
  const conflicts = [];
  const approvedAway = approvedAwaySet(availability);
  for (const date of monthDates(month)) {
    const weekday = dayKey(date);
    const dailySlots = [];
    const demands = new Map();
    for (const brand of activeBrands) {
      const operating = operatingProcesses(brand, weekday, holidayFor(holidays, date, brand), processById);
      if (!operating.length) continue;
      const requirements = requirementsFor(brand, operating, weekday);
      const eligible = new Map();
      const available = new Map();
      const processSlots = requirements.slots.filter((slot) => !slot.brandExtra);
      for (const process of operating) {
        const people = activeEmployees.filter((person) => employeeEligible(person, brand, process));
        eligible.set(process.id, people);
        available.set(process.id, people.filter((person) => employeeAvailable(person, date, weekday, approvedAway)));
        for (let index = 0; index < processRequired(brand, process); index += 1) {
          dailySlots.push({
            kind: 'process', brand, process, index,
            options: available.get(process.id).map((person) => ({ employee: person, process })),
          });
        }
      }
      for (let index = 0; index < requirements.brandExtra; index += 1) {
        const options = operating.flatMap((process) => available.get(process.id).map((person) => ({ employee: person, process })));
        dailySlots.push({ kind: 'brandExtra', brand, process: null, index, options });
      }
      demands.set(brand.id, { brand, operating, processSlots, eligible, available, brandExtra: requirements.brandExtra });
    }

    // Count each employee's distinct eligible brand/process options for this day.
    const employeeOptions = new Map();
    const processPoolSizes = new Map();
    for (const slot of dailySlots) {
      const pool = new Set(slot.options.map((option) => option.employee.id));
      if (slot.kind === 'process') processPoolSizes.set(`${slot.brand.id}:${slot.process.id}`, pool.size);
      for (const option of slot.options) {
        const key = `${slot.brand.id}:${option.process.id}`;
        const choices = employeeOptions.get(option.employee.id) || new Set();
        choices.add(key);
        employeeOptions.set(option.employee.id, choices);
      }
    }
    const compareEmployees = (a, b) => (employeeOptions.get(a.employee.id)?.size || 0) - (employeeOptions.get(b.employee.id)?.size || 0)
      || Number((a.employee.preferredOffs || []).includes(weekday)) - Number((b.employee.preferredOffs || []).includes(weekday))
      || a.employee.id.localeCompare(b.employee.id);
    for (const slot of dailySlots) {
      slot.options.sort((a, b) => compareEmployees(a, b)
        || (processPoolSizes.get(`${slot.brand.id}:${a.process.id}`) || 0) - (processPoolSizes.get(`${slot.brand.id}:${b.process.id}`) || 0)
        || a.process.id.localeCompare(b.process.id));
    }

    // Fill process minimums first, ordered by the size of their eligible pools;
    // extra brand slots follow and may use any operating process for that brand.
    dailySlots.sort((a, b) => Number(a.kind === 'brandExtra') - Number(b.kind === 'brandExtra')
      || new Set(a.options.map((option) => option.employee.id)).size - new Set(b.options.map((option) => option.employee.id)).size
      || a.brand.id.localeCompare(b.brand.id)
      || (a.process?.id || '').localeCompare(b.process?.id || '')
      || a.index - b.index);
    const assignments = allocateDailySlots(dailySlots);
    const matchedSlots = new Map();
    const processMatched = new Map();
    const brandMatched = new Map();
    for (const [employeeId, assignment] of assignments) {
      const slot = dailySlots[assignment.slotIndex];
      matchedSlots.set(assignment.slotIndex, assignment.option);
      brandMatched.set(slot.brand.id, (brandMatched.get(slot.brand.id) || 0) + 1);
      if (slot.kind === 'process') {
        const key = `${slot.brand.id}:${slot.process.id}`;
        processMatched.set(key, (processMatched.get(key) || 0) + 1);
      }
      const assignedProcess = assignment.option.process;
      entries.push({
        id: `${date}:${slot.brand.id}:${assignedProcess.id}:${slot.kind === 'brandExtra' ? `extra${slot.index + 1}` : slot.index + 1}`,
        date, brandId: slot.brand.id, processId: assignedProcess.id, employeeId,
        status: 'assigned', source: 'generated',
      });
    }

    for (const { brand, operating, eligible, available, brandExtra } of demands.values()) {
      let processGap = false;
      for (const process of operating) {
        const required = processRequired(brand, process);
        const assigned = processMatched.get(`${brand.id}:${process.id}`) || 0;
        if (assigned >= required) continue;
        processGap = true;
        const eligiblePeople = eligible.get(process.id) || [];
        const availablePeople = available.get(process.id) || [];
        const reason = !eligiblePeople.length ? 'No employees are assigned to this brand and process.' : availablePeople.length < required ? `Only ${availablePeople.length} eligible employees are available after weekly offs and approved unavailability.` : 'Eligible employees are already assigned to another responsibility that day.';
        conflicts.push({ id: `gap:${date}:${brand.id}:${process.id}`, type: 'process_coverage_gap', severity: 'critical', date, brandId: brand.id, processId: process.id, required, assigned, message: `${brand.name} · ${process.name} needs ${required} distinct staff; ${assigned} assigned. ${reason}` });
      }
      const matchedExtras = [...matchedSlots].filter(([index]) => dailySlots[index].brand.id === brand.id && dailySlots[index].kind === 'brandExtra').length;
      if (brandExtra > matchedExtras && !processGap) conflicts.push({ id: `brand-gap:${date}:${brand.id}`, type: 'brand_coverage_gap', severity: 'critical', date, brandId: brand.id, required: brandRequired(brand, weekday), assigned: brandMatched.get(brand.id) || 0, message: `${brand.name} requires ${brandRequired(brand, weekday)} distinct staff across its operating processes; the additional brand minimum cannot be met.` });
    }
  }
  addPreferenceNotices(entries, employees, conflicts);
  return { id: `roster-${month}`, month, status: conflicts.some((c) => c.severity === 'critical') ? 'needs_review' : 'validated', generatedAt: new Date().toISOString(), entries, conflicts };
}

function addPreferenceNotices(entries, employees, conflicts) {
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  for (const entry of entries) {
    const employee = employeeById.get(entry.employeeId);
    if (employee?.preferredOffs?.includes(dayKey(entry.date)) && !employee.weeklyOffs?.includes(dayKey(entry.date))) conflicts.push({ id: `preference:${entry.id}`, type: 'preference_conflict', severity: 'warning', date: entry.date, brandId: entry.brandId, processId: entry.processId, employeeId: entry.employeeId, message: `${employee.name} is assigned on a preferred day off. Coverage takes priority; consider a voluntary swap if possible.` });
  }
}

function validateRoster(roster, { employees, brands, processes, holidays, availability }) {
  const conflicts = [];
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const processById = new Map(processes.map((p) => [p.id, p]));
  const approvedAway = approvedAwaySet(availability);
  const byDateEmployee = new Map();
  const invalidEntries = new Set();
  const add = (conflict) => { if (!conflicts.some((c) => c.id === conflict.id)) conflicts.push(conflict); };
  for (const entry of roster.entries) {
    const key = `${entry.date}:${entry.employeeId}`;
    const prior = byDateEmployee.get(key) || [];
    const employee = employeeById.get(entry.employeeId);
    const brand = brandById.get(entry.brandId);
    const process = processById.get(entry.processId);
    const day = dayKey(entry.date);
    const calendarValid = brand && process && operatingProcesses(brand, day, holidayFor(holidays, entry.date, brand), processById).some((p) => p.id === process.id);
    const assignmentConflict = (type, message) => {
      invalidEntries.add(entry.id);
      add({ id: `${type}:${entry.id}`, entryId: entry.id, type: type === 'calendar_conflict' ? type : 'scheduling_conflict', severity: 'critical', date: entry.date, brandId: entry.brandId, processId: entry.processId, employeeId: entry.employeeId, message });
    };
    if (!employeeEligible(employee, brand || {}, process || {}) || !brand?.active || !process?.active) assignmentConflict('eligibility', 'Assigned employee is inactive or is not assigned to this brand and process.');
    if (employee?.weeklyOffs?.includes(day)) assignmentConflict('off', 'Assignment falls on the employee’s mandatory weekly off.');
    if (approvedAway.has(`${entry.employeeId}:${entry.date}`)) assignmentConflict('away', 'Assignment overlaps approved leave or comp-off.');
    if (!calendarValid) assignmentConflict('calendar_conflict', 'Assignment does not match the brand and process operating calendars.');
    if (prior.length > 0) {
      // Cross-brand overlap remains prohibited by the existing daily collision rule;
      // same-brand process overlap is now explicitly prohibited as well.
      invalidEntries.add(entry.id);
      add({ id: `overlap:${entry.id}`, entryId: entry.id, type: 'scheduling_conflict', severity: 'critical', date: entry.date, brandId: entry.brandId, processId: entry.processId, employeeId: entry.employeeId, message: `Employee has incompatible assignments on ${entry.date}; one person cannot cover multiple processes or brands on the same day.` });
    }
    prior.push(entry);
    byDateEmployee.set(key, prior);
  }

  for (const date of monthDates(roster.month)) {
    const weekday = dayKey(date);
    const dateEntries = roster.entries.filter((e) => e.date === date && !invalidEntries.has(e.id));
    for (const brand of brands.filter((b) => b.active)) {
      const operating = operatingProcesses(brand, weekday, holidayFor(holidays, date, brand), processById);
      if (!operating.length) continue;
      const { slots } = requirementsFor(brand, operating, weekday);
      const used = new Set();
      const assignedByProcess = new Map();
      const invalidByProcess = new Map();
      const invalidBrandEmployees = new Set();
      let processGap = false;
      for (const p of operating) assignedByProcess.set(p.id, new Set());
      for (const entry of roster.entries.filter((e) => e.date === date && e.brandId === brand.id && invalidEntries.has(e.id))) {
        const processSet = invalidByProcess.get(entry.processId) || new Set();
        processSet.add(entry.employeeId);
        invalidByProcess.set(entry.processId, processSet);
        invalidBrandEmployees.add(entry.employeeId);
      }
      for (const entry of dateEntries.filter((e) => e.brandId === brand.id)) {
        const employee = employeeById.get(entry.employeeId);
        if (employeeEligible(employee, brand, processById.get(entry.processId)) && employeeAvailable(employee, date, weekday, approvedAway)) assignedByProcess.get(entry.processId)?.add(employee.id);
      }
      for (const process of operating) {
        const assigned = assignedByProcess.get(process.id);
        const required = processRequired(brand, process);
        const invalidAssigned = invalidByProcess.get(process.id)?.size || 0;
        if (assigned.size + invalidAssigned < required) {
          processGap = true;
          add({ id: `process-gap:${date}:${brand.id}:${process.id}`, type: 'process_coverage_gap', severity: 'critical', date, brandId: brand.id, processId: process.id, required, assigned: assigned.size, message: `${brand.name} · ${process.name} requires ${required} distinct staff; ${assigned.size} valid and available.` });
        }
        for (const id of assigned) used.add(id);
      }
      const brandNeed = Math.max(0, brandRequired(brand, weekday) - slots.length);
      if (brandNeed && !processGap && used.size + invalidBrandEmployees.size < brandRequired(brand, weekday)) add({ id: `brand-gap:${date}:${brand.id}`, type: 'brand_coverage_gap', severity: 'critical', date, brandId: brand.id, required: brandRequired(brand, weekday), assigned: used.size, message: `${brand.name} requires ${brandRequired(brand, weekday)} distinct staff across its operating processes; ${used.size} valid and available.` });
    }
  }
  addPreferenceNotices(roster.entries, employees, conflicts);
  roster.conflicts = conflicts;
  roster.status = conflicts.some((c) => c.severity === 'critical') ? 'needs_review' : 'validated';
  roster.validatedAt = new Date().toISOString();
  return roster;
}

module.exports = { generateRoster, validateRoster, calculateCoverage };
