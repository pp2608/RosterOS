# RosterOS — Smart Workforce & Roster Management System

RosterOS is a smart roster management system developed as part of the DataStraw internship assessment. It helps manage employees, customer brands, operational processes, pods, availability, and monthly staffing schedules through a centralized web application.

The system uses a deterministic, rule-based scheduling engine to generate monthly rosters, check staffing requirements, identify conflicts, and support manual roster adjustments.

## Live Application

- **Live App:** https://roster-os-eight.vercel.app
- **Backend API:** https://rosteros-assessment-api.onrender.com
- **API Health Check:** https://rosteros-assessment-api.onrender.com/api/health
- **GitHub Repository:** https://github.com/pp2608/RosterOS
- **Database:** Supabase PostgreSQL

## Features

- Employee management, including create, edit, and deactivate operations.
- Brand and process management.
- Pod creation, editing, and lead assignment.
- Employee-to-brand and employee-to-process assignments.
- Weekly offs and preferred days off.
- Leave requests, approved leave, and comp-off management.
- Public holiday and operating calendar configuration.
- Brand-level and process-level staffing requirements.
- Monthly automated roster generation.
- Employee eligibility and availability checks.
- Detection of staffing gaps and scheduling conflicts.
- Manual employee reassignment.
- Roster validation and revalidation.
- Monthly roster view and CSV export.
- Dashboard showing workforce statistics and roster coverage.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 |
| Build Tool | Vite |
| Backend | Node.js |
| API Framework | Express.js |
| Database | Supabase PostgreSQL |
| Scheduling Engine | JavaScript |
| Styling | Component-scoped CSS |
| Deployment | Vercel and Render |
| Testing | Node.js built-in test runner |

## Project Structure

```text
RosterOS/
│
├── client/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── App.css
│   │   ├── icons.jsx
│   │   └── routing.jsx
│   └── vercel.json
│
├── server/
│   ├── src/
│   │   ├── data.js
│   │   ├── index.js
│   │   ├── scheduler.js
│   │   └── supabaseStore.js
│   │
│   ├── test/
│   ├── supabase/
│   │   ├── schema.sql
│   │   └── seed.sql
│   └── package.json
│
├── .env.example
├── render.yaml
└── README.md
```

## System Architecture

RosterOS follows a client-server architecture.

1. **Frontend:** React provides the dashboard and workforce management interface.
2. **Backend:** Express exposes REST APIs and handles business logic.
3. **Scheduling engine:** The backend generates and validates rosters using predefined rules.
4. **Database:** Supabase PostgreSQL stores workforce and roster data.
5. **Deployment:** The frontend is hosted on Vercel and the backend API on Render.

The frontend communicates with the backend API. Scheduling decisions and validation are handled on the server rather than in browser code.

## Database Design

The database uses normalized tables to represent the workforce and operational structure.

Main entities include:

- Employees
- Brands
- Processes
- Pods
- Employee-to-brand assignments
- Employee-to-process assignments
- Brand-to-process requirements
- Availability
- Holidays
- Rosters
- Roster entries

Employees can be associated with multiple brands and processes. Brand-process relationships define the processes required by each brand and their staffing minimums.

## Roster Generation Logic

RosterOS uses a deterministic, rule-based scheduling algorithm rather than AI-based scheduling.

For every date in the selected month, the scheduler:

1. Checks whether each brand is operational on that date.
2. Checks the operating calendar and holiday rules.
3. Identifies the active processes required by each brand.
4. Finds employees eligible for the relevant brand and process.
5. Excludes employees on mandatory weekly offs.
6. Excludes employees with approved leave or comp-off.
7. Allocates eligible employees to satisfy process-level staffing requirements.
8. Checks the distinct employee requirement at brand level.
9. Prevents employees from being assigned to different brands on the same date.
10. Records staffing gaps, conflicts, and preference warnings.

Employees may cover multiple processes for the same brand on the same day as one work shift. They cannot be assigned to two different brands on the same day.

Candidate selection considers preferred days off, current daily workload, and stable employee ID ordering.

## Validation and Conflict Handling

The validation engine checks:

- Employee eligibility.
- Active and inactive employee status.
- Brand and process assignments.
- Operating calendars.
- Public holidays.
- Mandatory weekly offs.
- Approved leave and comp-offs.
- Cross-brand daily assignment conflicts.
- Process-level staffing minimums.
- Brand-level distinct employee requirements.
- Preferred day-off conflicts.

The system distinguishes between critical staffing conflicts and advisory preference notices.

Incomplete staffing is not silently treated as valid. Managers can review conflicts, make manual changes, and run validation again.

## Current Live Demo Status

The live dashboard currently displays the following workforce information:

| Metric | Live value |
|---|---:|
| Active employees | 48 |
| Active brands | 24 |
| Operating processes | 4 |
| Operational pods | 5 |
| Scheduled assignments | 639 |
| Staffing coverage | 73% |
| Staffing slots fulfilled | 1,080 / 1,483 |
| Critical issues | 405 |
| Preference notices | 124 |

<sub>Figures reflect the live dashboard at the time this README was updated. The current roster is marked Needs Review because staffing requirements remain incomplete.</sub>

## Assessment Design Questions

### 1. How are employees, brands, processes, and pods modelled?

Employees belong to pods, and pod leads reference employees. Employees and brands have many-to-many relationships through assignment tables. Employee-process assignments determine which processes an employee can support.

A separate brand-process relationship stores the processes required by each brand and their minimum staffing requirements.

### 2. How does the system generate and validate rosters?

The backend iterates through the dates in the selected month, checks brand and process calendars, filters eligible employees, and allocates staff based on availability and scheduling priorities.

The validation engine then checks process-level and brand-level staffing requirements. Unmet requirements are recorded as conflicts with reasons.

### 3. How does the system handle single-resource and multi-employee brands?

For a single-resource brand, one eligible employee can cover multiple processes for that brand as one work shift.

For multi-employee brands, different employees can be assigned to different processes. Brand-level minimum staffing rules ensure that enough distinct employees are available.

### 4. What happens if the only employee for a brand is unavailable?

If the employee is on approved leave, comp-off, or a mandatory weekly off, they are excluded from the candidate pool.

The scheduler records critical process-level gaps and a brand-level staffing gap if the required minimum is not met. The manager can review the issue and take corrective action.

### 5. How are conflicting requirements or insufficient staffing handled?

Hard constraints take priority over preferences. The system does not allocate employees who are unavailable, ineligible, or already assigned to another brand on the same day.

If staffing requirements cannot be fulfilled, the system records the gaps and displays the reasons. Preferred day-off conflicts are treated as advisory notices.

### 6. Which steps are automated and which remain under human control?

Roster generation, employee eligibility checks, and validation are automated.

Managers remain responsible for configuring employees, brands, processes, calendars, approving leave, making manual adjustments, and deciding how to resolve conflicts.

This approach combines automation with human decision-making.

### 7. What would change if the team and brand count doubled?

The existing relational data model supports adding more employees and brands without redesigning the entire application.

For larger workloads, I would introduce pagination, optimized database indexes, background roster-generation jobs, improved candidate lookup, and stronger multi-user access controls.

### 8. What would be improved first with another week?

I would prioritize:

- Individual user authentication and role-based permissions.
- Manager and pod-lead access controls.
- Atomic database transactions for multi-table updates.
- Audit history for roster changes.
- More extensive testing with larger workforce datasets.
- Performance improvements for monthly roster generation.

## Running the Project Locally

### Prerequisites

- Node.js 20 or newer.
- npm.
- Git.

### 1. Clone the repository

```bash
git clone https://github.com/pp2608/RosterOS.git
cd RosterOS
```

### 2. Configure the backend

Create a `.env` file inside the `server` directory using `.env.example` as a reference.

Configure the demo authentication values:

```env
PORT=4000
CLIENT_ORIGIN=http://localhost:5173

DEMO_LOGIN_USERNAME=your-demo-username
DEMO_LOGIN_PASSWORD=your-strong-password
DEMO_AUTH_SECRET=your-random-secret

ROSTEROS_STORAGE_MODE=local-json
```

For local development, the local JSON storage mode can be used without connecting Supabase.

Never commit actual credentials or secret keys to GitHub.

### 3. Install and start the backend

```bash
cd server
npm install
npm run dev
```

The backend runs at:

```text
http://localhost:4000
```

### 4. Install and start the frontend

Open another terminal:

```bash
cd client
npm install
npm run dev
```

Open the Vite URL displayed in the terminal, normally:

```text
http://localhost:5173
```

The frontend uses the Vite development proxy to communicate with the backend API.

### 5. Login

Use the username and password configured in the backend `.env` file.

## Environment Variables

| Variable | Purpose |
|---|---|
| `PORT` | Backend API port |
| `CLIENT_ORIGIN` | Allowed frontend origin |
| `DEMO_LOGIN_USERNAME` | Demo login username |
| `DEMO_LOGIN_PASSWORD` | Demo login password |
| `DEMO_AUTH_SECRET` | Token signing secret |
| `ROSTEROS_STORAGE_MODE` | Selects local JSON or Supabase storage |
| `ROSTEROS_STORE_PATH` | Optional local JSON storage path |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Server-side Supabase credential |
| `SUPABASE_SERVICE_ROLE_KEY` | Alternative legacy server-side credential |
| `VITE_API_URL` | Deployed backend API URL used by the frontend |

Supabase credentials must remain on the backend. Never expose them through frontend code or `VITE_*` variables.

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | API health check |
| GET | `/api/bootstrap` | Initial application data |
| POST | `/api/employees` | Create employee |
| PATCH | `/api/employees/:id` | Update employee |
| POST | `/api/brands` | Create brand |
| PATCH | `/api/brands/:id` | Update brand |
| POST | `/api/processes` | Create process |
| PATCH | `/api/processes/:id` | Update process |
| POST | `/api/pods` | Create pod |
| PATCH | `/api/pods/:id` | Update pod |
| POST | `/api/availability` | Add availability record |
| PATCH | `/api/availability/:id` | Update availability |
| POST | `/api/holidays` | Add holiday |
| PATCH | `/api/holidays/:id` | Update holiday |
| POST | `/api/rosters/generate` | Generate monthly roster |
| GET | `/api/rosters/:month` | Retrieve monthly roster |
| POST | `/api/rosters/:month/validate` | Validate roster |
| PATCH | `/api/rosters/:month/entries/:entryId` | Manually reassign employee |
| GET | `/api/rosters/:month/export.csv` | Export roster CSV |

## Testing

Backend tests can be run from the `server` directory:

```bash
npm test
```

Frontend checks can be run from the `client` directory:

```bash
npm run lint
npm run build
```

The tests cover scheduling rules, employee eligibility, availability, leave, weekly offs, staffing requirements, conflict detection, manual changes, and API operations.

## Deployment

### Frontend — Vercel

The React/Vite frontend is deployed on Vercel.

Live URL:

https://roster-os-eight.vercel.app

### Backend — Render

The Express API is hosted on Render.

API URL:

https://rosteros-assessment-api.onrender.com

Health endpoint:

https://rosteros-assessment-api.onrender.com/api/health

### Database — Supabase

The live application is connected to Supabase PostgreSQL for database operations.

Database credentials are configured server-side and must not be committed to the repository.

### Security Considerations

The current implementation uses a shared demo login. It is intended for assessment demonstration and not as a complete production authentication system.

Before production use, the application should have individual user accounts, role-based permissions, audit logging, stronger database transaction handling, and appropriate access policies.

## Future Improvements

- Individual authentication and role-based access.
- Manager and pod-lead dashboards.
- Automated leave approval workflows.
- Advanced workload balancing.
- Improved scheduling optimization.
- Roster history and audit logs.
- Notifications for staffing gaps.
- Background processing for large roster-generation jobs.
- More extensive performance and integration testing.

## Author

**Parth Patil**

BSc Information Technology Student

- **GitHub:** https://github.com/pp2608
- **LinkedIn:** https://www.linkedin.com/in/parth-patil-b54031348/
- **Portfolio:** https://parthpatilportfolio.netlify.app

---

*RosterOS — Smart Workforce and Roster Management System | DataStraw Internship Assessment*
