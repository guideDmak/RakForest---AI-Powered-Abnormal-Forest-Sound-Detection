# Account workflow

Registration has three steps: staff details, optional ID card upload, and manual administrator approval. The account is persisted at the end of the attachment step before the approval screen opens. OTP fields on older records are not used for approval. Pending and suspended accounts remain unable to sign in under the existing prototype login implementation.

## Database

Apply `supabase/migrations/20261115000001_account_requested_role.sql` before releasing this UI. It adds the nullable `requested_role` column without rewriting existing accounts. The live project's existing `password_hash` column is still required by the prototype; this change does not migrate authentication to Supabase Auth.

Run with credentials in the local environment, never in command arguments:

```powershell
node --env-file=.env.local scripts/migrate-account-workflow.mjs
```

If the direct database hostname is IPv6-only, set `ACCOUNT_DATABASE_POOLER_HOST` to the project's verified IPv4 session pooler host before running. The script derives the username from `DATABASE_URL` and prints only verification counts. It follows the existing database setup script's TLS configuration; use the project's CA certificate for verified TLS in production.

## Behavior

- `createAccount(input, draftId)` stores a pending record and returns the persisted profile. Keep the draft ID stable for retries after a lost response.
- Account management calls `getProfiles({ strict: true })`: failed reads show retry, successful empty reads show an empty list.
- Role and password changes return the row committed by the database before updating local cache. A missing row is an error.
- Duplicate codes (23505), invalid references (23503), denied access (42501), and missing schema have separate messages.
- A password reset's `notificationStatus` is `sent`, `failed`, or `skipped`. This refers only to the in-app notification. Failure does not roll back the password or report that it was not saved.
- Private card storage contains an object path. Review uses a short-lived signed URL, including for legacy public-URL values.
- The UI and service check the current administrator profile. This remains the existing prototype authentication model, not a replacement for server-enforced production authorization.

## Verification

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build --webpack
node node_modules/@playwright/test/cli.js test tests/accounts.spec.ts
```

The account browser tests intercept Supabase traffic and do not create real accounts, upload real documents, or send real notifications. They cover manual approval, persistence, duplicates, retry, conflict types, private-file failures, account suspension/restoration, and keyboard/mobile behavior.


## Directory management

Apply `supabase/migrations/20261115000002_directory_management.sql` after the account migration:

```powershell
node --env-file=.env.local scripts/migrate-account-workflow.mjs --directory
```

- Opening registration reserves a unique `RF-EMP-0001` style number using a database sequence. Cancellation leaves a gap. Existing employee codes are unchanged; editing a code retains the profile UUID and history.
- Position presets populate role and department; custom positions remain editable.
- The delete dialog always requests the acting administrator's password again. `/api/directory/delete` requires the server-only `SUPABASE_SERVICE_ROLE_KEY` and verifies the password against the existing prototype credential model. No password is logged. This change does not migrate existing credentials to a production authentication provider.
- The service-only database function locks records, rejects self/last-administrator deletion, checks unfinished assignments and zone ownership, and records the deletion plus audit in one transaction. Duplicate requests do not create duplicate audit entries. Transfer blockers first, then retry.
- Soft-deleted profiles and microphones remain in the database for historical reports but disappear from active directories. Database triggers prevent new assignments to deleted records. Historical reports join their recorded profile, microphone and zone IDs.
- Microphone zone `null` explicitly removes membership; omitting it preserves the current value during updates. Save methods use insert for new records and update by UUID for edits, returning the persisted row rather than a cache fallback.
- Polygon drawing has separate view/draw/place modes. Finish drawing before saving; invalid, duplicate or crossing vertices are rejected. Outside microphones require acknowledgement and retain their membership. Numeric vertex controls provide a keyboard alternative to dragging.
- `start-rakforest.cmd` probes the project fingerprint on port 3000. A matching server is reused; another process is reported without termination. The identity endpoint is available only in development.

Verification:

```powershell
node --test scripts/start-local.test.mjs
node node_modules/@playwright/test/cli.js test tests/accounts.spec.ts tests/directory.spec.ts tests/delete-server.spec.ts
node --env-file=.env.local scripts/test-directory-db.mjs
```

Browser/API tests use mocked data. The database test creates temporary records inside a transaction and always rolls it back; it never deletes real accounts or microphones. Its two concurrent sequence reservations intentionally consume numbers, since PostgreSQL sequence allocations are not rolled back. Use the same verified `ACCOUNT_DATABASE_POOLER_HOST` setting as the migration when direct IPv6 access is unavailable.


Zone removal requires the directory migration followed by `20261116000001_zone_soft_delete.sql`. Run `node --env-file=.env.local scripts/migrate-account-workflow.mjs --zones` for an existing installation. Removed zones are hidden from active lists and forms. Report joins preserve historical zone names. Active microphones must be moved or detached before removal.
