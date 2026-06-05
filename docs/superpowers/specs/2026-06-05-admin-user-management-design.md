# Design: In-app Admin Panel for user management

**Date:** 2026-06-05
**Status:** Approved (brainstorming) — ready for implementation plan
**Chosen approach:** Design 1 — server-side admin API via a Supabase Edge Function

## Problem

Adding a labeler to FlagLabel today means visiting the Supabase dashboard's
"Add user" form, which forces a password field even though the app is
passwordless (OTP-only). The admin (Toqi) wants to add/list/remove users and
change roles **from inside the web app**, never touching the Supabase dashboard
per user.

## Why a server-side endpoint is required

Creating/deleting a Supabase auth user requires the **service-role key**, which
bypasses all Row-Level Security — a master key. The web app
(`flaglabel.vercel.app`) ships a **public** JS bundle, so any key placed in the
frontend is extractable by anyone. Therefore the privileged operations must run
in server-side code that holds the key secretly and only acts after verifying
the caller is an admin. That server-side code is the Edge Function below.

(An alternative "allowlist + RLS gate, no server" design was considered — Design
2 — but rejected because it requires enabling open signup. The admin preferred
keeping signup fully closed so no stranger can ever create an account.)

## Architecture (trust boundary)

```
Admin's browser (App.tsx, isAdmin === true)
   │  supabase.functions.invoke('admin-users', { action, ... })
   │  (supabase-js auto-attaches the admin's JWT as Authorization: Bearer)
   ▼
Supabase Edge Function  «admin-users»   ── holds the service-role key, server-side only
   │  1. validate caller JWT  → auth.getUser()
   │  2. is_admin() RPC       → 403 if not admin
   │  3. perform action with a service-role client
   ▼
Supabase Auth (auth.users)  +  public.app_roles
```

The service-role key never leaves the function. Supabase auto-injects
`SUPABASE_SERVICE_ROLE_KEY` (alongside `SUPABASE_URL`, `SUPABASE_ANON_KEY`) into
deployed edge functions, so there is **no secret to store or paste** anywhere
(not in the repo, not in Vercel).

## Component 1 — Edge Function `supabase/functions/admin-users/index.ts` (Deno)

A single action-based endpoint. Request body: `{ action, ...payload }`.

Every request, in order:
1. Read `Authorization` header; create an anon client bound to that JWT;
   `auth.getUser()` to validate the token. Reject `401` if invalid/missing.
2. `client.rpc('is_admin')` (reuses the existing SECURITY DEFINER helper that
   reads `auth.jwt()->>'email'`). Reject `403` if not admin.
3. Switch on `action`, acting via a **service-role** client
   (`createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`):

| action    | behavior |
|-----------|----------|
| `list`    | `auth.admin.listUsers()` joined with `app_roles` → `[{ id, email, role, last_sign_in_at, created_at }]` |
| `add`     | validate/normalize email → `auth.admin.createUser({ email, email_confirm: true })` (**silent — sends no email**) → upsert `app_roles` row `(email, role)` |
| `setRole` | update the `app_roles` row for the email (`user` ↔ `admin`) |
| `remove`  | `auth.admin.deleteUser(id)` → delete the `app_roles` row for that email |

Key resolution: `auth.users` is keyed by `id`, `app_roles` by `email`. For
`setRole`/`remove` the client sends the user `id`; the function resolves it to
the email (`auth.admin.getUserById`) before touching `app_roles`, keeping the
two stores consistent.

Cross-cutting:
- **CORS:** handle the `OPTIONS` preflight and return CORS headers (the browser
  calls this cross-origin from the Vercel domain).
- **Errors:** structured `{ error: string }` JSON with appropriate status codes
  (`400` bad input, `401` unauthenticated, `403` not admin, `409`/`422` already
  exists, `500` unexpected).
- **Idempotency/edge cases:** `add` on an existing email returns a clear
  "already exists" rather than a 500; `remove`/`setRole` on an unknown email
  returns a clear `404`.

Deployed via the Supabase MCP `deploy_edge_function` (or the CLI).

## Component 2 — Frontend

### `src/cloud/admin-users.ts` (client wrapper + pure helpers)
- `listUsers(): Promise<AdminUser[]>`
- `addUser(email: string, role: Role): Promise<void>`
- `setRole(id: string, role: Role): Promise<void>`
- `removeUser(id: string): Promise<void>`

Each calls `supabase.functions.invoke('admin-users', { body: { action, ... } })`;
supabase-js automatically attaches the signed-in user's JWT. Also exports pure,
unit-testable helpers `normalizeEmail()` and `isValidEmail()`.

### `src/cloud/AdminPanel.tsx` (modal component)
Self-contained modal following the existing `src/cloud/UploadModal.tsx` pattern
(there is already precedent for extracting cloud modals out of `App.tsx`):
- A user table: **email · role dropdown · last sign-in · Remove** per row.
- An "Add user" row: email input + role `<select>` + **Add** button.
- Loading state on first load; inline error banner (`role="alert"`); disabled
  controls while a mutation is in flight; refresh the list after each mutation.

### `src/App.tsx`
- An **"Admin"** button in the header cluster, rendered only when `isAdmin`.
- State to open/close `AdminPanel`; render the modal when open.

## What does NOT change
- **Signup stays disabled** — no posture change; no stranger can create an
  account. (This is the reason no RLS changes are needed.)
- **No RLS migration** — with signup closed, every auth user is one the admin
  minted, so the existing `authenticated`-scoped policies remain correct.

## Error handling summary
- Frontend surfaces the function's `{ error }` message in the panel's inline
  error banner; never blocks the whole app.
- Function never leaks the service-role key or internal errors verbatim;
  returns sanitized messages.
- A non-admin who somehow reaches the function (e.g. a forged call) is stopped
  at step 2 with `403`.

## Testing
- **Unit (vitest):** the pure helpers in `admin-users.ts`
  (`normalizeEmail`, `isValidEmail`), matching the `src/annotations/` style.
- **Manual:** deploy the function and drive the app (via the `run-flaglabel`
  skill / live site) to verify add → appears in list → login works → setRole →
  remove. The Deno function and React modal are not in the vitest suite,
  consistent with how `App.tsx` is treated today.

## Prerequisites & out of scope
- **Custom SMTP (Resend)** is required for an added user to actually *receive*
  their OTP login code — Supabase's default mailer only reaches project team
  members. **Out of scope** for this feature (tracked separately), but noted so
  "add user" is not mistaken for "user can now log in."
- Because this introduces a privileged endpoint plus the service-role key, run a
  **`/security-review`** pass after implementation.

## Success criteria
1. Signed in as admin, an "Admin" button opens a panel listing existing users
   with their roles and last sign-in.
2. Adding an email creates a confirmed, passwordless auth account + `app_roles`
   row, with **no email sent**, and the new user appears in the list.
3. Role changes and removals take effect (removal deletes both the auth account
   and the role row).
4. A non-admin can neither see the button nor successfully call the function.
5. No service-role key exists anywhere in the client bundle or the repo.
6. The dashboard `/auth/users` page is never needed to manage a user.
