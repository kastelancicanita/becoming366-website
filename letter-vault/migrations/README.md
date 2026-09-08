# Letter Vault — Database Migrations

Run migrations manually in the Supabase SQL Editor (staging project first).

| File | Purpose |
|------|---------|
| `001_phase1_connectivity.sql` | Minimal connectivity table |
| `002_phase2_crypto_poc.sql` | Encryption POC table |
| `003_phase3_entitlements.sql` | Entitlements + access codes |
| `004_phase4_email.sql` | Outbound email + webhooks |
| `005_phase5_delivery.sql` | Scheduled delivery letters |
| `006_phase6_management.sql` | Management tokens, sessions, delivery email changes |
| `007_phase7_collections.sql` | Collections, letter slots, vault sessions, atomic seal RPC |

## How to apply

1. Open Supabase Dashboard → SQL Editor.
2. Paste **contents** of the migration file (not the file path).
3. Run once per environment (staging, later production).

Track applied migrations in `letter_vault_schema_meta.schema_version` (`phase7` after migration 007).
