# Exam Printery Desk

A system for running an exam printery when the owner is not always there. It tracks every exam from the print order to the cash in the owner's hand, and checks for fraud along the way.

**Stack:** Django + Django REST Framework + PostgreSQL (backend), Next.js (phone app, installable and works offline for sales visits), Celery + Redis (SMS and daily summary).

## How it works

| Role | Screens | What they do |
|---|---|---|
| **Owner** | Overview, Fraud checks, Printing, Store, Debts, Schools, Cash, Team | Posts print orders and prices, creates worker accounts, approves discounts, confirms cash, cancels wrong records, sees everything |
| **Printer** | Printing | Records the copier meter reading and a photo before and after every job, plus copies printed and spoilt sheets |
| **Store keeper** | Store, Cash | Folds and counts copies (without seeing the printer's figure), records serial numbers, issues copies to sales people, takes returns, receives cash from sales people and hands it to the owner |
| **Sales person** | My field, Debts | Accepts issued copies, records each school sale (school, copies, price, payment, delivery note number and photo, serials), collects debts |

Stock flow: **print order → printed → counted by store → issued → sold or returned**.
Cash flow: **school → sales person → store keeper → owner (confirmed)**. Mobile money goes straight to the business number and is matched against the owner's statement.

### Fraud checks
- **Copier meter:** pages printed must equal copies × pages per copy + spoilt sheets, and every meter page must belong to a recorded job (gaps are flagged). Readings come with photos.
- **Blind count:** the store keeper counts without seeing the printer's number; differences are flagged.
- **Serial numbers:** counted range, issued ranges, ranges sold to each school. Flags numbers outside the counted range (extra printing), numbers sold twice, and numbers sold by someone never issued them.
- **Paper:** reams given by the owner vs sheets used by the meter, checked in surprise counts.
- **Surprise stock counts** by the owner, with the expected figures hidden until saved.
- **Schools:** each school with a phone number gets an SMS after every sale ("Reply 1 if correct, 2 if not"). Each week the owner also gets a list of schools to phone, and can report schools that have the exams but aren't in the records.
- **Mobile money:** each recorded payment must appear on the owner's statement, pasted in or sent by the payment provider's webhook, with the same amount. A transaction ID can only be used once.
- **Delivery notes:** numbers can't repeat, and every sale needs a photo of the signed note.
- **Discounts:** sales below the set price wait for the owner. If the owner rejects one, the debt is worked out at the set price.
- **Candidates vs copies:** schools buying far fewer copies than they have candidates are flagged.
- **Nothing is deleted:** the owner cancels records with a reason, workers report mistakes, and every change is kept in history (Django admin → History).

## Run it on your computer

Needs Python 3.12+, Node 22, PostgreSQL 16 (and Redis only if you want background jobs to run separately).

```bash
# 1. Database
createdb printery   # or: psql -c "CREATE USER printery WITH PASSWORD 'printery' CREATEDB;" -c "CREATE DATABASE printery OWNER printery;"

# 2. Backend
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
export DJANGO_DEBUG=1 DJANGO_SECURE_COOKIES=0
python manage.py migrate
python manage.py create_demo_team --password choose-a-password   # owner, printer, store, musa, sarah
python manage.py runserver 8000

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 and sign in as `owner`, `printer`, `store`, `musa` or `sarah`.

On the real system, create the owner with `python manage.py createsuperuser`. The owner then creates everyone else on the **Team** screen.

Tests: `cd backend && python -m pytest` (the full process, every fraud check, offline retries and role permissions).

## Put it online on Render

The repository includes `render.yaml`, a Render Blueprint that creates everything:

| Render service | What it is |
|---|---|
| Neon (not Render) | PostgreSQL database: create it at https://console.neon.tech |
| `exam-printery-api` | Django API and admin, with a 2 GB disk for meter and delivery-note photos |
| `exam-printery-app` | The phone app. **This is the address your team opens.** |
| `exam-printery-daily-summary` | Cron job that texts the owner at 20:37 Kampala time |

1. **Database:** at https://console.neon.tech create a project in **AWS Europe Central 1 (Frankfurt)**, open **Connect**, and copy the connection string. It looks like `postgresql://neondb_owner:…@ep-…-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`.
1. Sign in at https://dashboard.render.com, then **New → Blueprint**, and connect the `Exam-Printery-Desk` GitHub repository.
2. Render asks for the values marked `sync: false`:
   - `DATABASE_URL`: the Neon connection string (Render asks twice, once for the API and once for the cron job; paste the same one)
   - `BUSINESS_NAME`: your printery's name
   - `OWNER_USERNAME` and `OWNER_PASSWORD`: your owner login, created on the first deploy (password 8+ characters)
   - `OWNER_PHONE`: for the daily summary (07XXXXXXXX)
   - `AT_API_KEY` and `AT_SENDER_ID`: leave empty until you have Africa's Talking
3. Click **Apply**. The first build takes about 5–10 minutes.
4. Open the **exam-printery-app** URL (for example `https://exam-printery-app.onrender.com`), sign in as the owner, and add your workers on the **Team** screen.

The API, app and cron job use paid "Starter" plans: the free plans sleep after 15 minutes and can't keep photos. Neon's free plan works for a start; it pauses when idle, so the first request after a quiet spell takes a second or two. Check current prices on Render's pricing page.

**Your own domain (optional):** add it to `exam-printery-app` under Settings → Custom Domains. Then set `DJANGO_CSRF_TRUSTED_ORIGINS` to `https://your-domain` in the `printery-settings` environment group.

**SMS later:** in the `printery-settings` group, set `SMS_PROVIDER=africastalking`, `AT_USERNAME`, `AT_API_KEY` and `AT_SENDER_ID`. Point Africa's Talking's incoming messages to `https://YOUR-APP-URL/api/webhooks/sms/?token=` followed by the generated `SMS_WEBHOOK_TOKEN`.

**Backups:** Neon keeps a restore history of the database (its length depends on your Neon plan). Photos are on the API's disk, which Render snapshots daily.

## Put it online on your own server

On a small cloud server (VPS) with Docker:

```bash
cp .env.example .env      # fill in every value
docker compose up -d --build
docker compose exec backend python manage.py createsuperuser
```

This starts PostgreSQL, Redis, Django (gunicorn), a Celery worker, Celery beat (daily summary), Next.js and nginx on port 80. **Add HTTPS before real use**, for example with Caddy or Certbot in front of port 80. Then set `DJANGO_ALLOWED_HOSTS` and `DJANGO_CSRF_TRUSTED_ORIGINS` to your domain.

Back up the `pgdata` and `media` volumes every day (database and photos).

## Integrations

| What | How to switch on |
|---|---|
| **SMS** (school confirmations, owner daily summary) | Create an Africa's Talking account, then set `SMS_PROVIDER=africastalking`, `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID`, `OWNER_PHONE`. In Africa's Talking, point incoming messages to `https://YOUR-DOMAIN/api/webhooks/sms/?token=SMS_WEBHOOK_TOKEN`. |
| **Mobile money** | Ask your payment provider (MTN MoMo / Airtel Money aggregator) to POST each payment to `https://YOUR-DOMAIN/api/webhooks/momo/` with header `X-Webhook-Token: MOMO_WEBHOOK_TOKEN` and JSON `{"transaction_id": "...", "amount": 60000, "payer": "07..."}`. Until then, paste statements on the Fraud checks screen. |
| **Daily summary time** | `SUMMARY_HOUR` / `SUMMARY_MINUTE` (Africa/Kampala time). |

## Project layout

```
backend/
  accounts/        User with role (owner, printer, store, sales)
  printery/
    models.py      Exams, print runs, counts, issues, returns, schools, visits, payments, cash, checks
    services.py    Stock, cash and debt arithmetic, and every fraud check
    views.py       API for each screen, role permissions, webhooks
    tasks.py       School confirmation SMS, owner daily summary
    tests/         End-to-end tests
frontend/
  app/             Screens: owner, print, store, cash, field, debts, login
  lib/outbox.ts    Offline queue for school visits
deploy/nginx.conf  Serves the app and the API on one domain
```
