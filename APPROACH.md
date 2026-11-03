# RosterOS approach note

RosterOS treats a roster as a set of daily brand/process assignments with explicit coverage requirements. The API runs a deterministic scheduler: hard availability and calendar rules are applied first, then soft preferences influence tie-breaking. The engine validates at both the process and brand level and returns explainable conflicts when staffing is insufficient. Managers retain control over setup, leave approvals, manual reassignment, and final conflict review.

The model uses normalized employee, brand, process, pod, availability, and roster relationships in Supabase. For local development and assessment review, the API persists the same domain data to a local JSON file without requiring credentials. The client provides the operational views, editing tools, monthly schedule grid, and CSV export.

## 3–5 minute demo checklist

1. Show the 32-person, multi-brand and pod dashboard and availability snapshot.
2. Open Operations setup to show different calendars, brand staffing minimums, process requirements, and pod leads.
3. Generate a month and inspect the monthly work/off/leave grid.
4. Filter the roster by brand or process and inspect critical gap explanations.
5. Edit an employee weekly off or approve/add leave, then revalidate an existing roster.
6. Manually reassign one scheduled employee and show the resulting validation status.
7. Export the filtered month to CSV.

Do not describe this as publicly deployed until hosting and URL checks have actually been completed.
