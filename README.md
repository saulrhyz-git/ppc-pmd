# PPC Property Management System (PMD)

A web application for the property management department: KPI dashboards per building, concerns and work orders,
breakdowns, preventive maintenance, permits, budgets, projects, contracts, safety, a tenant portal, and data entry for
every register. It is the production version of the single-file prototype (PMD v1.2).

- **Frontend:** React 19 + Vite + TypeScript (`client/`)
- **Backend:** Node.js + Express + Prisma (`server/`)
- **Database:** PostgreSQL
- **Shared logic:** dataset definitions, validation, roles and the KPI engine (`shared/`), used by both sides

## What is in it

| Screen | What it shows |
| --- | --- |
| Needs Focus | Buildings ranked by Red KPIs and attention score, with their three worst issues |
| Overall / Section Overview | Section cards, ranking table, KPI tiles per building |
| Work Orders | Every work order with status, priority and assignees; start / hold / complete / verify / close; work notes and full history. Phone-friendly for technicians |
| Concerns & Work Orders | 6-month concern charts by building and trade, tenant-portal inbox, concern slips, reactive vs preventive, leadtime compliance, open work orders, recurring concerns |
| Buildings & Assets | Units and leased spaces (condominium units, commercial spaces, common areas), equipment with tags, parent/child parts and warranty, and buildings (condominium / commercial). Each unit and piece of equipment shows its work orders and meters. Units can be pasted in bulk from a spreadsheet |
| Meter Readings | Technicians' daily round sheet (phone-friendly) with on-the-spot checks; exceptions (reading lower than previous, missing readings, high / low / zero use against the meter's own baseline); monthly use per meter vs last month; energy balance of the utility main meter against tenant and common-area meters; meter list, events (replacement, rollover) and full reading history with void and replace |
| Breakdowns & Assets | MTTR, breakdown log, critical system uptime (Power, Water, Elevator, FDAS, AFSS) |
| Financial Performance | Budget utilisation YTD, monthly opex chart, quarterly variance |
| Project Monitoring | CAPEX and projects vs straight-line plan, budget forecast at completion |
| Preventive Maintenance | PM compliance and flagged (late / overdue) tasks |
| Permits, Contracts | Expiry tracking with Red / Amber warnings |
| Safety & Security | Monthly incident reduction, 12-month chart, incident log |
| Data | Spreadsheet-style editing of all 13 registers, CSV import / export, blank templates |
| Settings | Users and screen access, buildings and sections, scoring weights, Red / Amber targets, as-of date, change history |
| Tenant portal | Legacy tenant sign-in inside the staff app (see the owner & tenant portal below for the new public portal) |
| Portal Access | Invite owners and tenants to the owner & tenant portal and manage their unit access |

**Roles.** General Manager and Department Head see every building. Supervisors see the buildings in their section.
Admin/Engineers and Technicians see their assigned buildings. Tenants only see the tenant portal for their own concerns.
All filtering is enforced on the server. Only the Department Head can open Settings beyond "My password".

**Assets and meters.** Work orders link to a unit and a piece of equipment (the old free-text Asset column is
kept for older work orders; the upgrade links them automatically where the text matches exactly one asset tag or
name in the same building, and copies the old Asset register rows into equipment records). Meter checks follow the
"Tenant Power Meter Monitoring" design: readings are never edited, only voided and re-entered; meter replacements and
rollovers are logged as events so consumption stays right; a day is compared with the meter's median daily use over
the last 30 days, or with the same weekday when the space has a weekly pattern (for example closed on Sundays).
Limits are stored in the `meterThresholds` setting (defaults in `shared/src/meters.ts`).

**Tenant concerns.** When staff press *Receive*, the concern is copied to the Concern slips register. Responding fills
in the response time; marking it Resolved or Closed fills the resolution and closing dates, so the concern KPIs
update automatically.

## Owner & tenant portal (`/myportal`)

A separate, public-facing site for unit owners, tenants, occupants and their representatives. They see only the
units staff give them access to, file job requests with photos, follow replies and work order status, and message
property management. Requests land in the existing **Concerns** inbox (marked as from the portal), so staff receive,
answer and turn them into work orders exactly as before.

**Staff side.** *Portal Access* (Department Head, Supervisors and Admin/Engineers for their own buildings; the
General Manager can view) lists units and portal accounts. *+ Invite* picks a unit, the person's email and their
relation (Owner, Tenant, Occupant, Representative), whether they may file requests, whether they see requests others
filed for the unit (on by default for owners), and an optional end date such as the lease end. The app shows a
one-time invitation link for staff to send; the person opens it and sets their own password. Staff can also issue a
password reset link, unlock, sign someone out everywhere, reset two-step sign-in for a lost phone, revoke a unit or
disable the account (which signs them out at once). Every action is in the change history.

**Security design**

- Portal accounts are not staff users: separate table, separate sign-in endpoint, separate cookie (`ppc_portal`,
  HttpOnly, SameSite=Strict, scoped to `/api/portal`). Staff cookies do not work on the portal API and portal cookies
  do not work on the staff API. The portal page has its own bundle, so the public never downloads the staff app.
- Invitation only. Invitation (72 h) and reset (24 h) links are random 256-bit tokens, single use, stored only as
  SHA-256 hashes, and carried after `#` so they never reach server logs or Referer headers.
- Passwords: at least 12 characters, common and name/email-based passwords refused, bcrypt cost 12. Changing the
  password signs out other devices.
- Two-step sign-in (authenticator app, RFC 6238) with 10 single-use recovery codes. Secrets are AES-256-GCM encrypted
  at rest, recovery codes hashed, a code cannot be reused, and 5 wrong codes end the attempt. A reset link does not
  bypass it. Set `PORTAL_REQUIRE_MFA=1` to make it mandatory for everyone.
- Brute-force protection: per-IP and per-IP+email rate limits, account lockout that grows (15 min, 1 h, 24 h), and the
  same answer and timing for unknown emails, wrong passwords and locked accounts.
- Sessions: random tokens stored hashed; 30 min idle and 12 h absolute timeout; a new token at every sign-in; people
  can see and end their other sessions.
- Access control on the server for every query: only units with current, unrevoked, unexpired access; everything
  else answers 404. Tenants see their own requests unless allowed to see all.
- Forged cross-site requests are blocked (custom header plus Origin check). Responses are `no-store`.
- Uploads: photos and PDF only, checked by file content rather than name, 10 MB and 5 files each; downloads are
  permission-checked and served sandboxed.

**Putting it on the internet.** The portal lives on the main site at `https://<your domain>/myportal` (no subdomain
needed). Serve the site over HTTPS only, set `COOKIE_SECURE=1`, `TRUST_PROXY=1` behind nginx (otherwise every visitor
shares one rate limit), and `PORTAL_PUBLIC_URL=https://<your domain>` (without `/myportal`) plus `PORTAL_SECRET` in
`.env`. The portal page calls the API at `/api/portal/`. If the staff app should stay internal-only on the same
domain, let nginx allow `/myportal`, `/api/portal/`, `/assets/` and `/favicon.svg` from the internet and restrict
everything else to your office network or VPN, for example:

```nginx
location ~ ^/(myportal|api/portal/|assets/|favicon\.svg) { proxy_pass http://127.0.0.1:3000; }
location / { allow 10.0.0.0/8; allow 192.168.0.0/16; deny all; proxy_pass http://127.0.0.1:3000; }
```

`server/scripts/portal-smoke.ts` runs 22 end-to-end security checks against a development server and database.

## Run it locally (development)

Requirements: Node.js 20 or newer, and PostgreSQL 14 or newer (or Docker).

```bash
docker compose up -d          # starts PostgreSQL on localhost:5432 (skip if you have Postgres already)
cp .env.example .env          # then edit DATABASE_URL and SESSION_SECRET
npm install
npm run db:migrate            # creates the tables
npm run db:seed               # demo users, 5 buildings and sample data
npm run dev                   # API on :3000, web app on http://localhost:5173
```

Demo accounts (password `ChangeMe123!`, or `SEED_PASSWORD` if you set it):

| Email | Role |
| --- | --- |
| gm@example.com | General Manager |
| dh@example.com | Department Head |
| sup.commercial@example.com, sup.industrial@example.com, sup.residential@example.com | Supervisor |
| eng1@example.com, eng2@example.com, eng3@example.com | Admin/Engineer |
| tech1@example.com (Tower A, Plaza B), tech2@example.com (Annex C, Court D, Hall E) | Technician |
| tenant@example.com | Legacy tenant sign-in on the staff page (Acme Corp, Tower A) |

My Portal demo accounts (sign in at `/myportal`, same password): `tenant@example.com` (Acme Corp, tenant of the first
Tower A unit) and `owner@example.com` (Olivia Reyes, owner of the first Court D unit). These are separate from the
staff accounts above. Re-run `npm run db:seed` on an existing development database to add them.

## Deploy to the local server

The app runs as one Node process that serves both the API and the built web app on one port.

One-time setup on the server:

```bash
sudo -u postgres createuser -P pmd               # choose a strong password
sudo -u postgres createdb -O pmd pmd
git clone https://github.com/<owner>/<repo>.git /opt/ppc-pmd
cd /opt/ppc-pmd
cp .env.example .env                              # set DATABASE_URL, SESSION_SECRET (openssl rand -hex 32), UPLOAD_DIR
npm ci --include=dev
npm run db:deploy
SEED_SAMPLE=0 SEED_PASSWORD='<temporary password>' npm run db:seed   # users and buildings, no sample data
npm run build
sudo cp deploy/pmd.service /etc/systemd/system/   # edit User / WorkingDirectory first
sudo systemctl daemon-reload && sudo systemctl enable --now pmd
```

Then sign in as `dh@example.com`, change its email and password in Settings, add the real users, and remove or
deactivate the demo accounts.

Every later release:

```bash
cd /opt/ppc-pmd && ./deploy/deploy.sh
```

This pulls `main` from GitHub, installs dependencies, applies database migrations, rebuilds the web app and
restarts the service.

**HTTPS.** Put nginx (or another reverse proxy) in front with a certificate, proxy to `localhost:3000`, and set
`COOKIE_SECURE=1` and `TRUST_PROXY=1` in `.env`.

**Work orders.** Each work order moves through *New → Assigned → In Progress ⇄ On Hold → Completed → Closed*, or
*Cancelled*. Supervisors, Admin/Engineers, the Department Head and the GM (managers) create, assign, edit, verify and
close. Technicians create work orders, and on work orders assigned to them they start, put on hold, resume and mark
completed, and edit the work notes. Anyone with access can comment. Putting on hold, completing and cancelling need a
note. Every change is recorded in the work order's history. Completed and Closed work orders count as done for the
dashboards; Cancelled ones are left out. A received tenant concern can be turned into a work order in one step.

The old "Work orders (master log)" register was moved into the work order table by the `20261124000000_work_orders`
migration (each row's original data is kept in `legacyData`). On the Data screen that register is now read-only;
CSV import still adds work orders.

**Backups.** Back up the database (`pg_dump pmd`) and the `UPLOAD_DIR` folder, which holds tenant photos and files.

## Project layout

```
shared/src/datasets.ts    register definitions, validation, CSV
shared/src/engine.ts      KPI engine (port of the prototype's calc / applyData)
shared/src/roles.ts       roles, screen access, building scope
shared/src/workorders.ts  work order statuses, who may make which status change
shared/src/thresholds.ts  Red / Amber targets
server/prisma/            database schema, migrations, seed
server/src/               Express API (auth, data, concerns, work orders, admin)
client/src/pages/         one file per screen
deploy/                   deploy script and systemd unit
```

## Checks

```bash
npm run typecheck   # all three packages
npm test            # KPI engine and validation tests
```

## Not yet carried over from the prototype

These prototype features are planned for the next phase: the request / approval route (Supervisor → Department Head →
General Manager) with email notifications, the alerts bell, custom metrics, building photos, and the AI-style
"brief supervisor" text.
