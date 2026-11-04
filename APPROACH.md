# RosterOS — Approach Note

RosterOS is a Smart Workforce and Roster Management System developed for the DataStraw internship assessment.

The system treats a roster as a collection of daily brand and process assignments with explicit staffing requirements.

The backend uses a deterministic scheduling algorithm. Hard availability and calendar rules are applied first, while employee preferences influence candidate selection. The scheduler validates staffing at both process and brand levels and reports explainable conflicts when requirements cannot be fulfilled.

Managers retain control over employee setup, leave approvals, manual reassignment, and final conflict resolution.

## Technical Approach

The application follows a client-server architecture:

- **Frontend:** React and Vite provide the workforce management interface.
- **Backend:** Node.js and Express handle APIs, scheduling, and validation.
- **Database:** Supabase PostgreSQL stores employee, brand, process, pod, availability, and roster relationships.
- **Scheduling:** A deterministic rule-based engine generates and validates monthly rosters.
- **Deployment:** Vercel hosts the frontend and Render hosts the backend API.

Local development can use a JSON file for persistence without requiring Supabase credentials.

## Scheduling Approach

For each date in a selected month, the scheduler:

1. Checks brand and process operating calendars.
2. Identifies eligible employees based on brand and process assignments.
3. Excludes employees on weekly offs, approved leave, or comp-off.
4. Allocates employees according to staffing requirements.
5. Prevents an employee from working across different brands on the same day.
6. Checks process-level and brand-level staffing requirements.
7. Reports critical staffing gaps and advisory preference conflicts.

The system does not silently mark incomplete rosters as valid. Managers can review conflicts, make manual changes, and validate the roster again.

## Current Application Structure

The live application currently manages:

- 48 employees
- 24 brands
- 4 processes
- 5 operational pods

## Human Control and Automation

Roster generation and validation are automated. Managers remain responsible for configuring business rules, approving leave, making manual changes, and deciding how to resolve staffing conflicts.

This approach combines scheduling automation with human oversight.

## Future Improvements

With another week of development, I would prioritize:

- Individual authentication and role-based access.
- Manager and pod-lead permissions.
- Atomic database transactions.
- Roster change history and audit logs.
- Improved scheduling performance.
- Additional integration and scalability testing.

## 3–5 Minute Demo Checklist

1. Show the dashboard with employee, brand, process, and pod statistics.
2. Open People to demonstrate employee management.
3. Open Operations to show brand calendars and staffing requirements.
4. Show Availability, weekly offs, leave, and holidays.
5. Open the roster and demonstrate the monthly schedule.
6. Show validation results and explain critical staffing gaps.
7. Demonstrate manual reassignment and revalidation.
8. Export the roster to CSV.

## Live Deployment

- **Frontend:** https://roster-os-eight.vercel.app
- **Backend API:** https://rosteros-assessment-api.onrender.com
- **GitHub:** https://github.com/pp2608/RosterOS

The live application is connected to Supabase PostgreSQL.
