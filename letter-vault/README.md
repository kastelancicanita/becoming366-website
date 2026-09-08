# Letter Vault — Backend Infrastructure

Phase 1 skeleton only. Governing spec: Final Letter Vault Architecture v1.

This directory is **additive**. It does not replace or modify the static Becoming366 website.

## Structure

```
letter-vault/
├── README.md                 ← this file
├── .env.example              ← secret names (no values)
├── migrations/               ← SQL migrations (run manually in Supabase)
└── worker/                   ← Cloudflare Worker API
    ├── wrangler.toml
    ├── package.json
    └── src/
```

## Phase 1 scope (complete)

- Health-check API (`GET /v1/health`)
- Supabase connectivity check (when secrets are configured)
- Staging / development Worker environments
- Migration folder with minimal connectivity table

## Phase 2 scope (encryption POC — staging dummy data only)

- Envelope encryption: AES-256-GCM per payload, DEK wrapped with `LETTER_VAULT_MASTER_KEY_V1`
- Staging-only routes (never return plaintext in HTTP responses):
  - `POST /v1/staging/poc/roundtrip` — in-memory encrypt/decrypt test
  - `POST /v1/staging/poc/seal` — encrypt dummy text and store ciphertext in DB
  - `GET /v1/staging/poc/verify/:id` — decrypt-verify stored record (no plaintext in response)
- Migration `002_phase2_crypto_poc.sql` — POC table + schema_version `phase2`
- All `dummy_text` payloads must start with `DUMMY:` (staging guard)

**Not included yet (Phase 5+):** scheduled future delivery, customer-facing Vault UI, Etsy API/webhooks, magic links, production setup.

## Phase 4 scope (transactional email — staging dummy data only)

- Resend integration via `RESEND_API_KEY` (Cloudflare secret)
- Sender: `The Letter Vault <letters@vault.becoming366.com>`
- Seal confirmation template — operational content only, **no letter body**
- `letter_vault_email_outbound` + `letter_vault_email_webhook_events` tables
- Webhook: `POST /v1/webhooks/resend` (Svix signature verified)
- Staging endpoints:
  - `POST /v1/staging/email/send-confirmation` — idempotent dummy send
  - `GET /v1/staging/email/status/:id` — admin only
  - `POST /v1/staging/webhooks/simulate` — test dedupe/out-of-order without Resend
- Migration `004_phase4_email.sql`
- MailerLite and main website **untouched**

## Phase 5 scope (scheduled delivery — staging dummy data only)

- `letter_vault_letters` — encrypted letters with `delivery_at` (UTC timestamptz)
- `letter_vault_delivery_attempts` — attempt metadata, no plaintext
- `letter_vault_scheduler_runs` — scheduler heartbeat
- Cloudflare Cron (`* * * * *` on staging) + manual `/v1/staging/scheduler/run`
- Atomic claim (SEALED/RETRY_REQUIRED → PROCESSING with lease)
- Stale PROCESSING recovery → RETRY_REQUIRED
- Future delivery email template (plaintext only in Resend outbound payload)
- Staging endpoints: `seal-scheduled`, `scheduler/run`, `scheduler/status`, `letters/status/:id`
- Migration `005_phase5_delivery.sql`

**Not included yet (Phase 7+):** customer-facing Vault UI, Etsy API/webhooks, production setup.

## Phase 6 scope (management access + delivery email — staging dummy data only)

- **Manage my letter** flow: Letter ID + purchaser email → generic response → short-lived one-time magic link (20 min) to purchaser email
- Management session: operational metadata only — **no decrypted letter body**
- Delivery email update: new address pending until verified via email to the new address
- Letters without delivery email supported; scheduler preserves encrypted letter as `AWAITING_DELIVERY_EMAIL`
- No reminder/annual/upcoming-delivery emails
- Tables: `letter_vault_management_tokens`, `letter_vault_management_sessions`, `letter_vault_delivery_email_changes`, `letter_vault_delivery_email_audit`
- Migration `006_phase6_management.sql`
- Staging endpoints:
  - `POST /v1/staging/management/request`
  - `POST|GET /v1/staging/management/activate`
  - `GET /v1/staging/management/session`
  - `POST /v1/staging/management/delivery-email/request`
  - `POST|GET /v1/staging/management/delivery-email/confirm`
  - Admin test helpers under `/v1/staging/management/test/*`
- Live verification: `node scripts/phase6-final-verify.mjs`

**Unresolved (by design in Phase 6):** purchaser permanent email loss recovery — no insecure bypass; future support/recovery policy TBD.

**Not included yet (Phase 7+):** customer-facing Vault UI, Etsy, production.

## Phase 3 scope (MVP entitlements — staging dummy data only)

- `letter_vault_entitlements` table — one purchase = one letter (`letters_allowed = 1`)
- Secure access codes: HMAC-SHA256 hash stored; raw code shown once at issue only
- Staging-only endpoints:
  - `POST /v1/staging/entitlements/issue` — admin header required; creates dummy entitlement
  - `POST /v1/staging/entitlements/verify` — code + email; does **not** consume
  - `POST /v1/staging/entitlements/consume` — atomic dummy consumption test
  - `GET /v1/staging/entitlements/status/:id` — admin only; no raw code
- Rate limiting on verify/consume
- Generic denial responses (no enumeration)
- Migration `003_phase3_entitlements.sql`
- Scripts: `create-staging-entitlement.mjs`, `phase3-staging-test.mjs`

## Manual setup (Anita)

### 1. Supabase staging project

1. Create a free project at [supabase.com](https://supabase.com) (choose **EU** region).
2. Run `migrations/001_phase1_connectivity.sql` in the Supabase SQL Editor.
3. For Phase 2, also run `migrations/002_phase2_crypto_poc.sql`.
4. For Phase 3, also run `migrations/003_phase3_entitlements.sql`.
5. For Phase 4, also run `migrations/004_phase4_email.sql`.
6. For Phase 5, also run `migrations/005_phase5_delivery.sql`.
7. For Phase 6, also run `migrations/006_phase6_management.sql`.
3. Copy **Project URL** and **service_role** key (Settings → API).  
   **Never** put the service_role key in git or in the static website.

### 2. Cloudflare Worker secrets (staging)

From `letter-vault/worker/`:

```bash
npm install
npx wrangler login
npx wrangler secret put SUPABASE_URL --env staging
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging
npx wrangler secret put LETTER_VAULT_MASTER_KEY_V1 --env staging
npx wrangler secret put LETTER_VAULT_STAGING_ADMIN_TOKEN --env staging
npx wrangler secret put RESEND_API_KEY --env staging
npx wrangler secret put RESEND_WEBHOOK_SECRET --env staging
npx wrangler deploy --env staging
```

### 3. Local development

```bash
cp .env.example worker/.dev.vars
# Edit worker/.dev.vars with staging values (file is gitignored)
npm run dev
```

## Health check

```bash
curl https://<your-worker>.workers.dev/v1/health
```

Expected when DB configured:

```json
{
  "status": "ok",
  "service": "letter-vault-api",
  "environment": "staging",
  "database": "connected",
  "schema_version": "phase2"
}
```

## Phase 2 staging test (after deploy + migration 002)

```bash
node scripts/phase2-staging-test.mjs
```

Expected: health OK, roundtrip `decrypt_ok: true`, seal returns an `id`, verify `decrypt_ok: true` — no plaintext in any JSON response.

When secrets are not set (local default):

```json
{
  "status": "ok",
  "service": "letter-vault-api",
  "environment": "development",
  "database": "not_configured"
}
```
