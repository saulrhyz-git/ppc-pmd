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
| Concerns & Work Orders | 6-month concern charts by building and trade, tenant-portal inbox, concern slips, reactive vs preventive, leadtime compliance, open work orders, recurring concerns |
| Breakdowns & Assets | MTTR, breakdown log, critical system uptime (Power, Water, Elevator, FDAS, AFSS) |
| Financial Performance | Budget utilisation YTD, monthly opex chart, quarterly variance |
| Project Monitoring | CAPEX and projects vs straight-line plan, budget forecast at completion |
| Preventive Maintenance | PM compliance and flagged (late / overdue) tasks |
| Permits, Contracts | Expiry tracking with Red / Amber warnings |
| Safety & Security | Monthly incident reduction, 12-month chart, incident log |
| Data | Spreadsheet-style editing of all 13 registers, CSV import / export, blank templates |
| Settings | Users and screen access, buildings and sections, scoring weights, Red / Amber targets, as-of date, change history |
| Tenant portal | Tenants raise concerns with photos, see status and replies, send follow-ups |

**Roles.** General Manager and Department Head see every building. Supervisors see the buildings in their section.
Admin/Engineers see their assigned buildings. Tenants only see the tenant portal for their own concerns.
All filtering is enforced on the server. Only the Department Head can open Settings beyond "My password".

**Tenant concerns.** When staff press *Receive*, the concern is copied to the Concern slips register. Responding fills
in the response time; marking it Resolved or Closed fills the resolution and closing dates, so the concern KPIs
update automatically.

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
| tenant@example.com | Tenant (Acme Corp, Tower A) |

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

**Backups.** Back up the database (`pg_dump pmd`) and the `UPLOAD_DIR` folder, which holds tenant photos and files.

## Project layout

```
shared/src/datasets.ts    register definitions, validation, CSV
shared/src/engine.ts      KPI engine (port of the prototype's calc / applyData)
shared/src/roles.ts       roles, screen access, building scope
shared/src/thresholds.ts  Red / Amber targets
server/prisma/            database schema, migrations, seed
server/src/               Express API (auth, data, concerns, admin)
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
