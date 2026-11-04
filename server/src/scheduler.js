const dayKey = (date) => new Date(date + 'T00:00:00Z').getUTCDay();
const monthDates = (month) => {
  const [year, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => month + '-' + String(i + 1).padStart(2, '0'));
};
const minimum = (value) => Math.max(1, Number(value) || 1);
const processRequired = (brand, process) => minimum(brand.processMinimums?.[process.id] || process.minStaff);
const brandRequired = (brand, day) => minimum(brand.dailyMinimums?.[day] || brand.minStaff);
const holidayFor = (holidays, date, brand) => holidays.some((h) => h.date === date && (h.scope === 'all' || h.scope === brand.id));
const employeeEligible = (employee, brand, process) => Boolean(employee?.active && employee.brandIds?.includes(brand.id) && employee.processIds?.includes(process.id));
const employeeAvailable = (employee, date, day, approvedAway) => Boolean(employee && !employee.weeklyOffs?.includes(day) && !approvedAway.has(employee.id + ':' + date));

function operatingProcesses(brand, weekday, holiday, processById) {
  if (!brand?.active || !brand.operatingDays?.includes(weekday) || (holiday && brand.holidayPolicy !== 'operate')) return [];
  return (brand.processIds || []).map((id) => processById.get(id)).filter((p) => p?.active && p.operatingDays?.includes(weekday) && (!holiday || p.holidayPolicy === 'operate'));
}

function approvedAwaySet(availability) {
  return new Set(availability.filter((item) => item.status === 'approved').map((item) => item.employeeId + ':' + item.date));
}

function requirementsFor(brand, processes, weekday) {
  const processRequirements = processes.map((process) => ({ process, required: processRequired(brand, process) }));
  return {
    processes: processRequirements,
    brandRequired: brandRequired(brand, weekday),
    requiredProcessSlots: processRequirements.reduce((sum, item) => sum + item.required, 0),
  };
}

function inspectEntries(roster, state) {
  const { employees, brands, processes, holidays, availability } = state;
  const processById = new Map(processes.map((p) => [p.id, p]));
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const approvedAway = approvedAwaySet(availability);
  const invalid = new Set();
  const conflicts = [];
  const conflictIds = new Set();
  const byDateEmployee = new Map();
  const add = (conflict) => {
    if (!conflictIds.has(conflict.id)) {
      conflictIds.add(conflict.id);
      conflicts.push(conflict);
    }
  };
  const assignmentConflict = (entry, type, message) => {
    invalid.add(entry);
    add({
      id: type + ':' + entry.id,
      entryId: entry.id,
      type: type === 'calendar_conflict' ? type : 'scheduling_conflict',
      severity: 'critical',
      date: entry.date,
      brandId: entry.brandId,
      processId: entry.processId,
      employeeId: entry.employeeId,
      message,
    });
  };

  for (const entry of roster.entries) {
    const employee = employeeById.get(entry.employeeId);
    const brand = brandById.get(entry.brandId);
    const process = processById.get(entry.processId);
    const weekday = dayKey(entry.date);
    const calendarValid = Boolean(brand && process
      && operatingProcesses(brand, weekday, holidayFor(holidays, entry.date, brand), processById).some((p) => p.id === process.id));

    if (!employeeEligible(employee, brand || {}, process || {}) || !brand?.active || !process?.active) {
      assignmentConflict(entry, 'eligibility', 'Assigned employee is inactive or is not assigned to this brand and process.');
    }
    if (employee?.weeklyOffs?.includes(weekday)) {
      assignmentConflict(entry, 'off', 'Assignment falls on the employee’s mandatory weekly off.');
    }
    if (approvedAway.has(entry.employeeId + ':' + entry.date)) {
      assignmentConflict(entry, 'away', 'Assignment overlaps approved leave or comp-off.');
    }
    if (!calendarValid) {
      assignmentConflict(entry, 'calendar_conflict', 'Assignment does not match the brand and process operating calendars.');
    }

    const key = entry.date + ':' + entry.employeeId;
    const group = byDateEmployee.get(key) || [];
    group.push(entry);
    byDateEmployee.set(key, group);
  }

  for (const group of byDateEmployee.values()) {
    const brandIds = new Set(group.map((entry) => entry.brandId));
    if (brandIds.size > 1) {
      for (const entry of group) {
        invalid.add(entry);
        add({
          id: 'overlap:' + entry.id,
          entryId: entry.id,
          type: 'scheduling_conflict',
          severity: 'critical',
          date: entry.date,
          brandId: entry.brandId,
          processId: entry.processId,
          employeeId: entry.employeeId,
          message: 'Employee has assignments to conflicting brands on ' + entry.date + '.',
        });
      }
      continue;
    }

    const entriesByProcess = new Map();
    for (const entry of group) {
      const sameProcess = entriesByProcess.get(entry.processId) || [];
      sameProcess.push(entry);
      entriesByProcess.set(entry.processId, sameProcess);
    }
    for (const sameProcess of entriesByProcess.values()) {
      if (sameProcess.length < 2) continue;
      for (const [index, entry] of sameProcess.entries()) {
        // Preserve one canonical row for coverage while flagging every row in
        // the duplicate group. Extra rows cannot inflate staffing counts.
        if (index > 0) invalid.add(entry);
        add({
          id: 'duplicate:' + entry.id,
          entryId: entry.id,
          type: 'scheduling_conflict',
          severity: 'critical',
          date: entry.date,
          brandId: entry.brandId,
          processId: entry.processId,
          employeeId: entry.employeeId,
          message: 'Employee has a duplicate assignment to the same process on ' + entry.date + '.',
        });
      }
    }
  }

  return { validEntries: roster.entries.filter((entry) => !invalid.has(entry)), conflicts };
}

function evaluateRoster(roster, state) {
  const { employees, brands, processes, holidays, availability } = state;
  const processById = new Map(processes.map((p) => [p.id, p]));
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const inspected = inspectEntries(roster, state);
  const conflicts = inspected.conflicts;
  const add = (conflict) => {
    if (!conflicts.some((item) => item.id === conflict.id)) conflicts.push(conflict);
  };
  let processFulfilledSlots = 0;
  let processRequiredSlots = 0;
  let brandFulfilledEmployees = 0;
  let brandRequiredEmployees = 0;

  for (const date of monthDates(roster.month)) {
    const weekday = dayKey(date);
    const dateEntries = inspected.validEntries.filter((entry) => entry.date === date);
    for (const brand of brands.filter((item) => item.active)) {
      const operating = operatingProcesses(brand, weekday, holidayFor(holidays, date, brand), processById);
      if (!operating.length) continue;
      const requirements = requirementsFor(brand, operating, weekday);
      const entries = dateEntries.filter((entry) => entry.brandId === brand.id);
      const assignedByProcess = new Map(operating.map((process) => [process.id, new Set()]));
      const assignedToBrand = new Set();

      for (const entry of entries) {
        const employee = employeeById.get(entry.employeeId);
        if (!employeeEligible(employee, brand, processById.get(entry.processId))) continue;
        assignedByProcess.get(entry.processId)?.add(employee.id);
        assignedToBrand.add(employee.id);
      }

      for (const { process, required } of requirements.processes) {
        const assigned = assignedByProcess.get(process.id).size;
        processRequiredSlots += required;
        processFulfilledSlots += Math.min(assigned, required);
        if (assigned < required) {
          add({
            id: 'process-gap:' + date + ':' + brand.id + ':' + process.id,
            type: 'process_coverage_gap',
            severity: 'critical',
            date,
            brandId: brand.id,
            processId: process.id,
            required,
            assigned,
            message: brand.name + ' · ' + process.name + ' requires ' + required + ' distinct staff; ' + assigned + ' valid and available.',
          });
        }
      }

      brandRequiredEmployees += requirements.brandRequired;
      brandFulfilledEmployees += Math.min(assignedToBrand.size, requirements.brandRequired);
      if (assignedToBrand.size < requirements.brandRequired) {
        add({
          id: 'brand-gap:' + date + ':' + brand.id,
          type: 'brand_coverage_gap',
          severity: 'critical',
          date,
          brandId: brand.id,
          required: requirements.brandRequired,
          assigned: assignedToBrand.size,
          message: brand.name + ' requires ' + requirements.brandRequired + ' distinct staff across its operating processes; ' + assignedToBrand.size + ' valid and available.',
        });
      }
    }
  }

  const employeeByIdForPreferences = new Map(employees.map((employee) => [employee.id, employee]));
  for (const entry of inspected.validEntries) {
    const employee = employeeByIdForPreferences.get(entry.employeeId);
    if (employee?.preferredOffs?.includes(dayKey(entry.date)) && !employee.weeklyOffs?.includes(dayKey(entry.date))) {
      add({
        id: 'preference:' + entry.id,
        type: 'preference_conflict',
        severity: 'warning',
        date: entry.date,
        brandId: entry.brandId,
        processId: entry.processId,
        employeeId: entry.employeeId,
        message: employee.name + ' is assigned on a preferred day off. Coverage takes priority; consider a voluntary swap if possible.',
      });
    }
  }

  const requiredSlots = processRequiredSlots + brandRequiredEmployees;
  const fulfilledSlots = processFulfilledSlots + brandFulfilledEmployees;
  return {
    conflicts,
    status: conflicts.some((item) => item.severity === 'critical') ? 'needs_review' : 'validated',
    coverage: {
      fulfilledSlots,
      requiredSlots,
      percentage: requiredSlots ? (fulfilledSlots === requiredSlots ? 100 : Math.min(99, Math.round((fulfilledSlots / requiredSlots) * 100))) : 100,
      processFulfilledSlots,
      processRequiredSlots,
      brandFulfilledEmployees,
      brandRequiredEmployees,
      explanation: 'Coverage combines process responsibility positions and distinct brand staffing requirements. One employee may cover multiple processes within a brand but counts once toward that brand’s minimum.',
    },
  };
}

function calculateCoverage(roster, state) {
  return evaluateRoster(roster, state).coverage;
}

function allocateDailySlots(slots) {
  const employeeBrand = new Map();
  const employeeProcesses = new Map();
  const brandEmployees = new Map();
  const assignments = [];

  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    const slot = slots[slotIndex];

    for (const option of slot.options) {
      const employeeId = option.employee.id;
      const process = slot.process || option.process;
      const processKey = slot.brand.id + ':' + process.id;
      const assignedToProcess = employeeProcesses.get(processKey) || new Set();
      const assignedBrand = employeeBrand.get(employeeId);
      if (assignedBrand && assignedBrand !== slot.brand.id) continue;
      if (assignedToProcess.has(employeeId)) continue;
      const assignedToBrand = brandEmployees.get(slot.brand.id) || new Set();
      const mustIncreaseDistinct = assignedToBrand.size < slot.brandRequired;
      if (mustIncreaseDistinct && assignedBrand === slot.brand.id) continue;
      employeeBrand.set(employeeId, slot.brand.id);
      assignedToProcess.add(employeeId);
      employeeProcesses.set(processKey, assignedToProcess);
      assignedToBrand.add(employeeId);
      brandEmployees.set(slot.brand.id, assignedToBrand);
      assignments.push({ slotIndex, option });
      break;
    }
  }
  return { assignments, employeeBrand };
}

function generateRoster({ month, employees, brands, processes, holidays, availability }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Month must use YYYY-MM format.');
  const activeEmployees = employees.filter((employee) => employee.active);
  const activeBrands = brands.filter((brand) => brand.active);
  const processById = new Map(processes.map((process) => [process.id, process]));
  const approvedAway = approvedAwaySet(availability);
  const entries = [];
  const conflicts = [];

  for (const date of monthDates(month)) {
    const weekday = dayKey(date);
    const dailySlots = [];
    const demands = [];
    const eligibleBrandOptions = new Map();

    for (const brand of activeBrands) {
      const operating = operatingProcesses(brand, weekday, holidayFor(holidays, date, brand), processById);
      if (!operating.length) continue;
      const requirements = requirementsFor(brand, operating, weekday);
      const availableByProcess = new Map();
      for (const { process, required } of requirements.processes) {
        const eligible = activeEmployees.filter((employee) => employeeEligible(employee, brand, process));
        const available = eligible.filter((employee) => employeeAvailable(employee, date, weekday, approvedAway));
        availableByProcess.set(process.id, { eligible, available, required });
        const candidates = available.map((employee) => ({ employee, process }));
        for (const employee of available) {
          const choices = eligibleBrandOptions.get(employee.id) || new Set();
          choices.add(brand.id);
          eligibleBrandOptions.set(employee.id, choices);
        }
        for (let index = 0; index < required; index += 1) {
          dailySlots.push({ brand, process, index, brandRequired: requirements.brandRequired, options: candidates });
        }
      }
      const extraCount = Math.max(0, requirements.brandRequired - requirements.requiredProcessSlots);
      if (extraCount) {
        const candidates = operating.flatMap((process) => availableByProcess.get(process.id).available.map((employee) => ({ employee, process })));
        for (let index = 0; index < extraCount; index += 1) {
          dailySlots.push({ brand, process: null, index, extra: true, brandRequired: requirements.brandRequired, options: candidates });
        }
      }
      demands.push({ brand, operating, requirements, availableByProcess });
    }

    const compareOptions = (a, b) => (eligibleBrandOptions.get(a.employee?.id)?.size || 0) - (eligibleBrandOptions.get(b.employee?.id)?.size || 0)
      || Number((a.employee?.preferredOffs || []).includes(weekday)) - Number((b.employee?.preferredOffs || []).includes(weekday))
      || String(a.employee?.id || '').localeCompare(String(b.employee?.id || ''));

    for (const slot of dailySlots) {
      slot.options.sort(compareOptions);
    }
    const slotFlexibility = (slot) => slot.options.reduce((sum, option) => sum + (option.employee.brandIds?.length || 0) * (option.employee.processIds?.length || 0), 0);
    dailySlots.sort((a, b) => new Set(a.options.map((option) => option.employee.id)).size - new Set(b.options.map((option) => option.employee.id)).size
      || slotFlexibility(a) - slotFlexibility(b)
      || Number(Boolean(a.extra)) - Number(Boolean(b.extra))
      || a.brand.id.localeCompare(b.brand.id)
      || String(a.process?.id || '').localeCompare(String(b.process?.id || ''))
      || a.index - b.index);

    const allocated = allocateDailySlots(dailySlots);
    const processAssigned = new Map();
    const brandAssigned = new Map();
    const entryCounter = new Map();

    const addEntry = (brand, process, employee, suffix) => {
      const key = brand.id + ':' + process.id;
      const next = entryCounter.get(key) || 0;
      entryCounter.set(key, next + 1);
      entries.push({
        id: date + ':' + brand.id + ':' + process.id + ':' + (suffix || String(next + 1)),
        date,
        brandId: brand.id,
        processId: process.id,
        employeeId: employee.id,
        status: 'assigned',
        source: 'generated',
      });
      const processSet = processAssigned.get(key) || new Set();
      processSet.add(employee.id);
      processAssigned.set(key, processSet);
      const brandSet = brandAssigned.get(brand.id) || new Set();
      brandSet.add(employee.id);
      brandAssigned.set(brand.id, brandSet);
    };

    for (const { slotIndex, option } of allocated.assignments) {
      const slot = dailySlots[slotIndex];
      addEntry(slot.brand, slot.process || option.process, option.employee, slot.extra ? 'extra' + (slot.index + 1) : undefined);
    }

    const extras = demands.slice().sort((a, b) => {
      const countA = a.availableByProcess.size;
      const countB = b.availableByProcess.size;
      return countA - countB || a.brand.id.localeCompare(b.brand.id);
    });
    for (const demand of extras) {
      const { brand, operating, requirements, availableByProcess } = demand;
      let assigned = brandAssigned.get(brand.id) || new Set();
      while (assigned.size < requirements.brandRequired) {
        const candidates = [...new Map(operating.flatMap((process) => availableByProcess.get(process.id).available
          .filter((employee) => !allocated.employeeBrand.has(employee.id))
          .map((employee) => [employee.id, employee])).values())]
          .sort((a, b) => compareOptions({ employee: a }, { employee: b }));
        const employee = candidates[0];
        if (!employee) break;
        const process = operating
          .filter((item) => employee.processIds?.includes(item.id))
          .sort((a, b) => (processAssigned.get(brand.id + ':' + a.id)?.size || 0) - (processAssigned.get(brand.id + ':' + b.id)?.size || 0) || a.id.localeCompare(b.id))[0];
        if (!process) break;
        allocated.employeeBrand.set(employee.id, brand.id);
        addEntry(brand, process, employee, 'extra' + (assigned.size + 1));
        assigned = brandAssigned.get(brand.id);
      }
    }

    for (const { brand, operating, requirements, availableByProcess } of demands) {
      for (const { process, required } of requirements.processes) {
        const assigned = processAssigned.get(brand.id + ':' + process.id)?.size || 0;
        if (assigned >= required) continue;
        const { eligible, available } = availableByProcess.get(process.id);
        const reason = !eligible.length
          ? 'No employees are assigned to this brand and process.'
          : available.length < required
            ? 'Only ' + available.length + ' eligible employees are available after weekly offs and approved unavailability.'
            : 'Eligible employees are already committed to another brand or another slot for this process.';
        conflicts.push({
          id: 'gap:' + date + ':' + brand.id + ':' + process.id,
          type: 'process_coverage_gap',
          severity: 'critical',
          date,
          brandId: brand.id,
          processId: process.id,
          required,
          assigned,
          message: brand.name + ' · ' + process.name + ' needs ' + required + ' distinct staff; ' + assigned + ' assigned. ' + reason,
        });
      }
      const assignedPeople = brandAssigned.get(brand.id)?.size || 0;
      if (assignedPeople < requirements.brandRequired) {
        conflicts.push({
          id: 'brand-gap:' + date + ':' + brand.id,
          type: 'brand_coverage_gap',
          severity: 'critical',
          date,
          brandId: brand.id,
          required: requirements.brandRequired,
          assigned: assignedPeople,
          message: brand.name + ' requires ' + requirements.brandRequired + ' distinct staff across its operating processes; ' + assignedPeople + ' assigned.',
        });
      }
    }
  }

  addPreferenceNotices(entries, employees, conflicts);
  return {
    id: 'roster-' + month,
    month,
    status: conflicts.some((conflict) => conflict.severity === 'critical') ? 'needs_review' : 'validated',
    generatedAt: new Date().toISOString(),
    entries,
    conflicts,
  };
}

function addPreferenceNotices(entries, employees, conflicts) {
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  for (const entry of entries) {
    const employee = employeeById.get(entry.employeeId);
    if (employee?.preferredOffs?.includes(dayKey(entry.date)) && !employee.weeklyOffs?.includes(dayKey(entry.date))) {
      conflicts.push({
        id: 'preference:' + entry.id,
        type: 'preference_conflict',
        severity: 'warning',
        date: entry.date,
        brandId: entry.brandId,
        processId: entry.processId,
        employeeId: entry.employeeId,
        message: employee.name + ' is assigned on a preferred day off. Coverage takes priority; consider a voluntary swap if possible.',
      });
    }
  }
}

function validateRoster(roster, state) {
  const evaluation = evaluateRoster(roster, state);
  roster.conflicts = evaluation.conflicts;
  roster.status = evaluation.status;
  roster.validatedAt = new Date().toISOString();
  return roster;
}

module.exports = { generateRoster, validateRoster, calculateCoverage };
