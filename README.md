# RosterOS

RosterOS is a DataStraw internship assessment implementation for monthly staffing across customer brands, operational processes, and pods. The repository contains a React/Vite client and an Express API. It runs with persistent local JSON data without cloud credentials, or uses Supabase PostgreSQL when server credentials are configured.

## Current capabilities

- 32 fictional employees, 24 brands, 4 processes, 5 pods, public holidays, leave requests, comp-offs, weekly offs, and soft day-off preferences.
- Employee create, edit, deactivate, brand/process assignment, pod and role assignment, mandatory weekly offs, and preferred days off.
- Brand and process calendars, public-holiday rules, minimum staffing, per-process brand requirements, day-specific brand staffing, and active/inactive status.
- Pod creation/editing and lead assignment.
- Time-off and public-holiday management, pending leave approval, and availability changes that revalidate generated rosters.
- Deterministic monthly roster generation with brand and process coverage checks, eligibility checks, weekly offs, approved unavailability, and daily assignment collision checks.
- Company, pod, brand, process, and employee filters; assignment list and monthly staff grid; manual reassignment; revalidation; CSV export.
- Explanations for critical coverage gaps and advisory preference conflicts.

The schedule is a daily responsibility assignment model. An employee may cover multiple processes for the same brand on one date as one work shift. They may not cover two different brands on the same date. Shift start/end times and authentication are outside this assessment implementation.

The installed client template did not include Tailwind, React Router, or Lucide React, and package-registry access was unavailable. To keep the requested local build runnable without adding packages, the UI uses component-scoped CSS, browser path navigation with Vite’s SPA fallback, and local inline SVG icons. Recharts is omitted because the dashboard reports computed counts and coverage instead of adding decorative charts.

## Project structure

```text
client/                   React 19 + Vite UI
  src/App.jsx             Dashboard, people, operations, availability, roster views
  src/App.css             Responsive interface styles
  src/icons.jsx           Local inline SVG icons
  src/routing.jsx         Native path routing for offline dependency availability
server/                   Express API and scheduling engine
  src/data.js             Fictional seed records
  src/index.js            REST API and local/Supabase persistence selection
  src/scheduler.js        Deterministic generation and validation rules
  src/supabaseStore.js    Normalized Supabase PostgreSQL adapter
  test/                   Scheduler and API tests (node:test)
  supabase/schema.sql     PostgreSQL schema
  supabase/seed.sql       Repeatable fictional sample dataset
.env.example              Server and optional client settings
APPROACH.md               Short assessment submission note
```

## Run locally

Node.js 20 or newer is recommended. The implementation uses the dependencies already present in the client and server manifests; no Supabase account is needed locally.

1. Copy `.env.example` to `server/.env` and set a demo username, a strong demo password, and a random signing secret. The API will not start without these authentication settings. Keep `server/.env` local and ignored by Git. Leave Supabase values blank and use `ROSTEROS_STORAGE_MODE=auto` for the local JSON store.
2. In one terminal:

   ```powershell
   cd server
   npm install
   npm run dev
   ```

   The API listens on `http://localhost:4000`.

3. In a second terminal:

   ```powershell
   cd client
   npm install
   npm run dev
   ```

   Open the Vite URL shown in the terminal. Its `/api` requests proxy to port 4000.

4. Sign in with the values set in `DEMO_LOGIN_USERNAME` and `DEMO_LOGIN_PASSWORD`. The login is shared by demo viewers; there are no individual accounts or roles. Sign out clears the browser session token.

Local changes are stored in `server/data/local-store.json`, which is ignored by Git. Removing that file intentionally resets the API to `src/data.js` sample records. Tests use their own temporary store.

## Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `PORT` | API | HTTP port; defaults to `4000`. |
| `CLIENT_ORIGIN` | API | Comma-separated exact browser origins. Local development defaults to `http://localhost:5173`; production requires an explicit value and rejects wildcards/paths. |
| `DEMO_LOGIN_USERNAME` | API only | Shared demo login username. Keep it on the server; it is not a frontend build variable. |
| `DEMO_LOGIN_PASSWORD` | API only | Shared demo login password. Use a unique, strong value and keep it on the server. |
| `DEMO_AUTH_SECRET` | API only | Random signing secret of at least 32 bytes for eight-hour bearer tokens. Never expose it to the client. |
| `SUPABASE_URL` | API | Supabase project URL. |
| `SUPABASE_SECRET_KEY` | API only | Current server-side Supabase credential. Never put this in a `VITE_` variable or browser code. |
| `SUPABASE_SERVICE_ROLE_KEY` | API only | Legacy server-side credential name accepted for compatibility. |
| `ROSTEROS_STORAGE_MODE` | API | `auto`, `local-json`, or `supabase`. The Render demo blueprint pins `local-json` and will not connect to Supabase, even if Supabase variables are present. |
| `ROSTEROS_STORE_PATH` | API | Optional local JSON store path. Render uses an isolated temporary path that resets with the service. |
| `VITE_API_URL` | Client build | API origin/prefix for a deployed client, e.g. `https://api.example.com/api`. Leave blank locally to use the Vite proxy. |

The server needs these required demo authentication variables in `server/.env`:

```dotenv
DEMO_LOGIN_USERNAME=your-demo-username
DEMO_LOGIN_PASSWORD=use-a-unique-long-password
DEMO_AUTH_SECRET=paste-a-random-secret-of-at-least-32-bytes
```

Generate a signing secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Configure all three `DEMO_*` values in the API host's server-side environment for a public demo. Do not put them in `client/.env`, any `VITE_*` variable, source code, or GitHub. All API data and export routes require a valid bearer token; only `GET /api/health` and `POST /api/auth/login` are public. Tokens are held in browser session storage and expire after eight hours.

The public Render blueprint uses `ROSTEROS_STORAGE_MODE=local-json` with a separate `/tmp` store and does not provision or connect a database. It loads only the fictional seed data; changes made during the demo are temporary and reset when the service restarts or redeploys. Do not add credentials for the existing Supabase project to Render.

Supabase remains available for local or separate test environments by choosing `ROSTEROS_STORAGE_MODE=supabase` and supplying `SUPABASE_URL` plus a server-only `SUPABASE_SECRET_KEY`. Use a newly provisioned, isolated demo project only. Never point the public assessment demo at the existing November roster or live Supabase project. For a new empty isolated project, apply `server/supabase/schema.sql` and then either run `server/supabase/seed.sql` or allow the API to initialize the empty schema from fictional `server/src/data.js` data.

There is no versioned migration directory yet. `schema.sql` is the initial schema/bootstrap file; `CREATE TABLE IF NOT EXISTS` does not migrate an older table layout. For an existing project, inspect its schema and data before applying changes, and write a targeted migration rather than running the sample seed. The adapter reads and writes the normalized tables through the server-side Supabase client. Related writes are sequential rather than transactional, so do not treat this assessment adapter as production-ready for concurrent users.

`GET /api/health` is public and returns a 200 response with readiness and persistence mode for hosting-platform checks. The Render blueprint points its health check at `/api/health`.

The database adapter writes related tables through sequential Supabase REST requests. The shared demo login gates access to the application but does not provide individual accounts, roles, or row-level authorization. Do not use it for multi-user production operations; move multi-table mutations into PostgreSQL RPC functions/transactions and add authenticated roles and row-level access rules before exposing manager actions publicly.

## Architecture and scheduling

The client is a React interface served by Vite. The Express REST API owns roster generation and validation; browser code does not make scheduling decisions. `src/supabaseStore.js` maps normalized PostgreSQL relationships to the engine’s domain objects. Local development uses the same API with a durable JSON file.

For every date in the selected month the scheduler:

1. Resolves each active brand’s operating day and applicable holiday policy.
2. Resolves active brand processes and each process’s own calendar and holiday policy.
3. Finds active employees assigned to both the brand and process.
4. Removes employees on mandatory weekly offs or approved leave/comp-off.
5. Satisfies process minimums, then adds eligible staff until the brand’s distinct-resource minimum is met.
6. Prevents an employee from being allocated to different brands on the same day. The same brand resource may cover its processes as one shift.
7. Chooses candidates by soft preferred-off avoidance, then current daily workload, then stable employee ID order.
8. Emits critical process gaps, brand-level gaps, scheduling conflicts, and warning-level preference notices with counts and reasons.

Generation retains incomplete days as explicit conflicts and marks the roster `needs_review`; it does not label an under-covered roster valid. Revalidation after edits or availability changes checks persisted entries against current eligibility, calendars, weekly offs, approved unavailability, cross-brand conflicts, and both brand/process requirements. It flags conflicts for manager action rather than silently regenerating manual changes.

## Data model

The schema includes pods and leads, employees, brands, processes, employee-to-brand and employee-to-process joins, brand-to-process requirements, holidays, availability, rosters, and roster entries. Foreign keys, unique keys, checks, and lookup indexes protect the relationships. Brand-level daily staffing overrides are keyed by weekday; brand-process minimums live in a normalized join table.

The seed has 32 employees in five pods, 24 fictional brands, and four processes. Nineteen of 24 brands (about 79%) are single-resource; the other five have two or three resources. The sample includes cross-brand employees, shared process assignments, different calendars, preferences, leave, and comp-off. Two employees are operations coordinators available for new accounts.

## API overview

- `GET /api/health`, `GET /api/bootstrap`
- `POST /api/employees`, `PATCH /api/employees/:id`
- `POST /api/brands`, `PATCH /api/brands/:id`
- `POST /api/processes`, `PATCH /api/processes/:id`
- `POST /api/pods`, `PATCH /api/pods/:id`
- `POST /api/availability`, `PATCH /api/availability/:id`
- `POST /api/holidays`, `PATCH /api/holidays/:id`
- `POST /api/rosters/generate` with `{ "month": "YYYY-MM" }`
- `GET /api/rosters/:month`, `POST /api/rosters/:month/validate`
- `PATCH /api/rosters/:month/entries/:entryId` with `{ "employeeId": "..." }`
- `GET /api/rosters/:month/export.csv`

## Verification

From `server/`, run:

```powershell
npm test
```

From `client/`, run:

```powershell
npm run lint
npm run build
```

Scheduler tests cover single-owner loss, multi-resource coverage, shared processes, Sunday/public-holiday calendars, cross-brand conflicts, approved leave and comp-offs versus pending leave, insufficient staffing, manual invalid edits, and preference warnings. API tests cover sample counts, create/edit, local persistence, availability impact, generation, validation, manual assignment, holiday/pod management, and CSV output.

## Assessment section 8: design questions

1. **How are employees, brands, processes, pods, and their relationships modelled?** Employees belong to a pod and pod leads reference employees. Employees and brands have many-to-many assignment tables for brands and processes. A separate brand-process relation stores each client’s processes and minimum process staffing. Calendars and staffing rules belong to the relevant brand/process records; roster entries reference employee, brand, process, date, and source.

2. **How does the system generate a roster and decide whether constraints are satisfied?** The API iterates dates, brand calendars, then process calendars in stable order. It filters assigned employees by hard availability, allocates using stable preference/workload/ID ordering, then validates process counts and brand distinct-resource counts. Unmet requirements become critical conflicts with counts and reasons.

3. **How does it handle single-resource and multi-employee brands?** A one-person brand can assign its resource across all open processes as a single shift. A multi-resource brand can assign people to different processes or share a process; its brand-level minimum ensures enough distinct employees work that day.

4. **What happens when the employee managing every process for a brand is unavailable?** Approved leave, comp-off, or a mandatory weekly off removes that employee from the candidate pool. Each affected process receives a critical gap; the brand receives a gap if its distinct-resource minimum is missed. The message explains the available capacity and reason.

5. **How are conflicting requirements or insufficient staffing handled?** Hard constraints—active status, assignment eligibility, calendar, weekly off, approved time off, and no cross-brand overlap—take precedence over preferences. Infeasible process and brand requirements remain visible with required/assigned counts. Preference violations are warnings.

6. **Which steps are automated and which remain under human control? Why?** Candidate allocation and validation are automated and deterministic. Managers configure assignments/calendars, approve leave, make manual changes, and decide how to handle conflicts or preference warnings. The tool exposes infeasible days instead of making unapproved business decisions or silently publishing them.

7. **What would change if the team and brand count doubled?** The schema and CRUD API accept additional records without code changes. I would add pagination and date/brand/process indexes, run month generation as a background job, isolate tenants, and optimize candidate lookup to avoid rescanning every employee per responsibility.

8. **What would be improved first with another week?** I would replace the shared demo login with individual authenticated roles and manager/pod-lead permissions, make multi-table writes atomic through PostgreSQL transactions/RPC, and add audit history. I would also run the app against provisioned Supabase and hosted services before calling it production-ready.

## Deployment and submission

### Render API and Vercel client

`render.yaml` defines the Express API service, pinned Node runtime, install/start commands, health check, and isolated `local-json` storage mode. `client/vercel.json` defines the Vite build/output and SPA fallback. The public demo does not require Supabase.

1. Create a Vercel project from this repository and set its **Root Directory** to `client`. Use the Vite framework preset; the checked-in config uses `npm ci`, `npm run build`, and `dist`. Deploy once to obtain the frontend origin.
2. Create the Render service from `render.yaml`. Set `CLIENT_ORIGIN` to the exact Vercel production origin (for example, `https://your-project.vercel.app`). Set `DEMO_LOGIN_USERNAME`, `DEMO_LOGIN_PASSWORD` (at least 12 characters), and `DEMO_AUTH_SECRET` (random, at least 32 bytes) in Render's environment settings. Keep all `SUPABASE_*` variables unset.
3. Copy the Render service's HTTPS URL and set Vercel's production environment variable `VITE_API_URL` to `https://your-render-service.onrender.com/api`. Redeploy the Vercel client after setting this build-time variable.
4. Check Render's `https://your-render-service.onrender.com/api/health`, then open the Vercel site and sign in using the configured demo username/password.

Do not place demo credentials, signing secrets, Supabase keys, or service-role keys in Vercel variables, `VITE_*` settings, source files, or GitHub. `.gitignore` rules exclude environment files, key files, local JSON state, and service-role-key-named files; only blank-value `.env.example` templates are tracked. This repository is prepared for deployment but has not been deployed; account, domain, and credential setup must be completed by the project owner.

See [APPROACH.md](./APPROACH.md) for the short solution note and demo checklist.
