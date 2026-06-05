# Admin User-Management Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admin an in-app panel (web build) to list, add, role-change, and remove FlagLabel users — without ever opening the Supabase dashboard.

**Architecture:** A single admin-gated Supabase Edge Function (`admin-users`) holds the service-role key server-side and performs the privileged Auth Admin API calls; the browser talks to it through a thin `src/cloud/admin-users.ts` client. A modal `AdminPanel.tsx` (styled like the existing `UploadModal`) plus an `isAdmin`-gated "Admin" button in the titlebar drive it. Signup stays disabled; no RLS changes.

**Tech Stack:** Deno (Supabase Edge Function) + `@supabase/supabase-js` v2, React 19 + TypeScript (Vite), vitest.

**Spec:** `docs/superpowers/specs/2026-06-05-admin-user-management-design.md`

**Branch:** `feat/admin-user-management` (already created; the spec commit lives there).

---

## File Structure

| File | Responsibility | New/Modified |
|------|----------------|--------------|
| `supabase/functions/admin-users/index.ts` | Privileged endpoint: verify caller is admin, then list/add/setRole/remove via service-role | **Create** |
| `src/cloud/admin-users.ts` | Browser client wrapper + pure email helpers + shared types | **Create** |
| `src/cloud/admin-users.test.ts` | Unit tests for the pure helpers | **Create** |
| `src/cloud/AdminPanel.tsx` | The admin modal UI | **Create** |
| `src/App.tsx` | "Admin" button (gated on `isAdmin`) + panel open state + render | **Modify** |
| `src/App.css` | Styles for the admin panel | **Modify** |

---

## Task 1: Pure helpers + types (TDD)

**Files:**
- Create: `src/cloud/admin-users.ts` (helpers + types only for now)
- Test: `src/cloud/admin-users.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/cloud/admin-users.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeEmail, isValidEmail } from "./admin-users";

describe("normalizeEmail", () => {
  it("trims surrounding whitespace and lowercases", () => {
    expect(normalizeEmail("  Khaled.Ahmed@SIU.edu  ")).toBe("khaled.ahmed@siu.edu");
  });

  it("leaves an already-clean address unchanged", () => {
    expect(normalizeEmail("a@b.co")).toBe("a@b.co");
  });
});

describe("isValidEmail", () => {
  it("accepts a normal address", () => {
    expect(isValidEmail("khaled.ahmed@siu.edu")).toBe(true);
  });

  it.each(["", "no-at-sign", "a@b", "a @b.co", "a@b .co", "@b.co", "a@.co"])(
    "rejects %j",
    (bad) => {
      expect(isValidEmail(bad)).toBe(false);
    },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- admin-users`
Expected: FAIL — `Failed to resolve import "./admin-users"` / functions not defined.

- [ ] **Step 3: Write minimal implementation**

Create `src/cloud/admin-users.ts`:

```ts
// Admin user-management client for the WEB build. Talks to the `admin-users`
// Edge Function (which holds the service-role key); the browser never sees that
// key. Also exports the pure email helpers and shared types used by AdminPanel.

export type Role = "user" | "admin";

export type AdminUser = {
  id: string;
  email: string;
  role: Role | null;
  last_sign_in_at: string | null;
};

// Lowercase + trim so the same address is never stored under two casings (the
// `app_roles` table and `is_admin()` compare on the literal email string).
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Pragmatic single-line check: one `@`, a dot-bearing domain, no whitespace.
// The Auth API is the real validator; this just stops obvious typos client-side.
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- admin-users`
Expected: PASS (8 assertions across both describes).

- [ ] **Step 5: Commit**

```bash
git add src/cloud/admin-users.ts src/cloud/admin-users.test.ts
git commit -m "feat(admin): pure email helpers + admin-user types"
```

---

## Task 2: Browser client wrapper

**Files:**
- Modify: `src/cloud/admin-users.ts` (append the invoke wrapper + 4 functions)

- [ ] **Step 1: Append the client functions**

Add to the bottom of `src/cloud/admin-users.ts`:

```ts
import { getSupabaseClient } from "./supabase-client";

// Invoke the `admin-users` Edge Function. supabase-js automatically attaches the
// signed-in user's JWT as the Authorization header, which the function uses for
// its admin check. On a non-2xx the error is a FunctionsHttpError carrying the
// Response in `.context`; pull the server's `{ error }` so the UI shows a real
// message instead of a generic "non-2xx status code".
async function invokeAdmin<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: { action, ...payload },
  });
  if (error) {
    let message = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const body = await ctx.json();
        if (body?.error) message = body.error as string;
      } catch {
        /* keep the generic message if the body isn't JSON */
      }
    }
    throw new Error(message);
  }
  return data as T;
}

export async function listUsers(): Promise<AdminUser[]> {
  const res = await invokeAdmin<{ users: AdminUser[] }>("list");
  return res.users;
}

export async function addUser(email: string, role: Role): Promise<void> {
  await invokeAdmin("add", { email: normalizeEmail(email), role });
}

export async function setRole(id: string, role: Role): Promise<void> {
  await invokeAdmin("setRole", { id, role });
}

export async function removeUser(id: string): Promise<void> {
  await invokeAdmin("remove", { id });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Re-run the unit tests (still green)**

Run: `npm test -- admin-users`
Expected: PASS (the new imports don't break the pure-helper tests).

- [ ] **Step 4: Commit**

```bash
git add src/cloud/admin-users.ts
git commit -m "feat(admin): browser client for the admin-users function"
```

---

## Task 3: The Edge Function

**Files:**
- Create: `supabase/functions/admin-users/index.ts`

- [ ] **Step 1: Write the function**

Create `supabase/functions/admin-users/index.ts`:

```ts
// admin-users — privileged user-management endpoint for FlagLabel.
//
// Trust boundary: the browser may call this, but every request must prove it
// comes from an admin BEFORE any service-role action runs. Step 1 validates the
// caller's JWT and runs the existing `is_admin()` RPC AS the caller; only then
// does Step 2 use the service-role client (which bypasses RLS) to mutate users.
//
// Env vars are auto-injected by Supabase into deployed functions:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  // 1) Validate caller and confirm admin, acting AS the caller.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Invalid session" }, 401);
  const callerEmail = (userData.user.email ?? "").toLowerCase();

  const { data: isAdmin, error: adminErr } = await caller.rpc("is_admin");
  if (adminErr) return json({ error: "Admin check failed" }, 500);
  if (isAdmin !== true) return json({ error: "Admin privileges required" }, 403);

  // 2) Service-role client for the privileged mutations (bypasses RLS).
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let payload: { action?: string; email?: string; role?: string; id?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  try {
    switch (payload.action) {
      case "list": {
        const { data: list, error } = await admin.auth.admin.listUsers();
        if (error) throw error;
        const { data: roles } = await admin
          .from("app_roles")
          .select("email, role");
        const roleByEmail = new Map(
          (roles ?? []).map((r: { email: string; role: string }) => [
            r.email,
            r.role,
          ]),
        );
        const users = list.users.map((u) => ({
          id: u.id,
          email: u.email ?? "",
          role: roleByEmail.get(u.email ?? "") ?? null,
          last_sign_in_at: u.last_sign_in_at ?? null,
        }));
        return json({ users });
      }

      case "add": {
        const email = (payload.email ?? "").trim().toLowerCase();
        const role = payload.role === "admin" ? "admin" : "user";
        if (!email) return json({ error: "Email is required" }, 400);
        const { error: createErr } = await admin.auth.admin.createUser({
          email,
          email_confirm: true, // pre-confirmed + passwordless; sends NO email
        });
        if (createErr) {
          if ((createErr.message ?? "").toLowerCase().includes("already")) {
            return json(
              { error: "A user with that email already exists" },
              409,
            );
          }
          throw createErr;
        }
        const { error: roleErr } = await admin
          .from("app_roles")
          .upsert({ email, role }, { onConflict: "email" });
        if (roleErr) throw roleErr;
        return json({ ok: true });
      }

      case "setRole": {
        const role = payload.role === "admin" ? "admin" : "user";
        if (!payload.id) return json({ error: "User id is required" }, 400);
        const { data: got, error: getErr } = await admin.auth.admin.getUserById(
          payload.id,
        );
        if (getErr || !got.user?.email) {
          return json({ error: "User not found" }, 404);
        }
        // Guard against the admin demoting themselves into a lockout.
        if (got.user.email.toLowerCase() === callerEmail && role !== "admin") {
          return json({ error: "You can't remove your own admin role" }, 400);
        }
        const { error: upErr } = await admin
          .from("app_roles")
          .upsert({ email: got.user.email, role }, { onConflict: "email" });
        if (upErr) throw upErr;
        return json({ ok: true });
      }

      case "remove": {
        if (!payload.id) return json({ error: "User id is required" }, 400);
        const { data: got, error: getErr } = await admin.auth.admin.getUserById(
          payload.id,
        );
        if (getErr || !got.user) return json({ error: "User not found" }, 404);
        if ((got.user.email ?? "").toLowerCase() === callerEmail) {
          return json({ error: "You can't remove your own account" }, 400);
        }
        const { error: delErr } = await admin.auth.admin.deleteUser(payload.id);
        if (delErr) throw delErr;
        if (got.user.email) {
          await admin.from("app_roles").delete().eq("email", got.user.email);
        }
        return json({ ok: true });
      }

      default:
        return json({ error: `Unknown action: ${payload.action}` }, 400);
    }
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "Unexpected error" },
      500,
    );
  }
});
```

- [ ] **Step 2: Commit the source**

```bash
git add supabase/functions/admin-users/index.ts
git commit -m "feat(admin): admin-gated user-management edge function"
```

---

## Task 4: Deploy + smoke-test the function

**Files:** none (deploy + verify).

- [ ] **Step 1: Deploy via the Supabase MCP**

Use the MCP tool `mcp__plugin_supabase_supabase__deploy_edge_function` with:
- `project_id`: `uggjzcbozdxvuawxddrn`
- `name`: `admin-users`
- `files`: the contents of `supabase/functions/admin-users/index.ts`

Expected: deploy succeeds; `mcp__plugin_supabase_supabase__list_edge_functions` shows `admin-users` ACTIVE.
(CLI alternative if MCP is unavailable: `supabase functions deploy admin-users --project-ref uggjzcbozdxvuawxddrn`.)

- [ ] **Step 2: Verify the admin gate from logs / a logged-in call**

Sign in to `flaglabel.vercel.app` as `toqitahamid.sarker@siu.edu` (admin), open the browser console, and run:

```js
const { data, error } = await window.__sb?.functions.invoke("admin-users", { body: { action: "list" } });
console.log(data, error);
```

If `window.__sb` isn't exposed, defer this check to Task 6's UI smoke test instead.
Expected: a `{ users: [...] }` array including `toqitahamid.sarker@siu.edu` and `seth.morelock@siu.edu`.

- [ ] **Step 3: Confirm a non-admin is rejected (server-side check)**

Inspect with `mcp__plugin_supabase_supabase__get_logs` (`service: "edge-function"`) after the call.
Expected: admin call returns 200; any non-admin call returns 403. (No commit — deploy only.)

---

## Task 5: AdminPanel modal component

**Files:**
- Create: `src/cloud/AdminPanel.tsx`

- [ ] **Step 1: Write the component**

Create `src/cloud/AdminPanel.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import {
  listUsers,
  addUser,
  setRole,
  removeUser,
  isValidEmail,
  type AdminUser,
  type Role,
} from "./admin-users";

// Admin-only user management for the web build. Lists users, adds a new one by
// email, toggles role, and removes. All privileged work happens in the
// `admin-users` edge function; this component only calls the client wrapper and
// reflects loading/error state. Styling uses the shared modal vocabulary
// (`upload-overlay`, `btn`) plus `admin-*` classes owned by App.css.

type AdminPanelProps = {
  currentEmail: string;
  onClose: () => void;
};

function formatLastSeen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function AdminPanel(props: AdminPanelProps) {
  const { currentEmail, onClose } = props;

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<Role>("user");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await listUsers());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Escape closes the panel when not mid-mutation.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const onAdd = useCallback(async () => {
    const email = newEmail.trim();
    if (!isValidEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addUser(email, newRole);
      setNewEmail("");
      setNewRole("user");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [newEmail, newRole, refresh]);

  const onChangeRole = useCallback(
    async (u: AdminUser, role: Role) => {
      setBusy(true);
      setError(null);
      try {
        await setRole(u.id, role);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const onRemove = useCallback(
    async (u: AdminUser) => {
      setBusy(true);
      setError(null);
      try {
        await removeUser(u.id);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const onBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !busy) onClose();
    },
    [busy, onClose],
  );

  return (
    <div
      className="upload-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Manage users"
      onClick={onBackdropClick}
    >
      <div className="upload-modal admin-modal">
        <div className="upload-modal-head">
          <div className="upload-modal-title">Manage users</div>
          <div className="upload-modal-sub">
            Add or remove people who can sign in to FlagLabel.
          </div>
        </div>

        <div className="upload-modal-body">
          <div className="admin-addrow">
            <input
              className="admin-email-input"
              type="email"
              placeholder="name@university.edu"
              value={newEmail}
              disabled={busy}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onAdd();
              }}
            />
            <select
              className="admin-role-select"
              value={newRole}
              disabled={busy}
              onChange={(e) => setNewRole(e.target.value as Role)}
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            <button
              type="button"
              className="btn primary"
              disabled={busy || newEmail.trim() === ""}
              onClick={() => void onAdd()}
            >
              Add user
            </button>
          </div>

          <p className="admin-hint">
            New users get no email. Tell them to visit FlagLabel and sign in with
            their email to receive a login code.
          </p>

          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          {loading ? (
            <div className="admin-empty">Loading users…</div>
          ) : users.length === 0 ? (
            <div className="admin-empty">No users yet.</div>
          ) : (
            <div className="admin-userlist">
              {users.map((u) => {
                const isSelf = u.email.toLowerCase() === currentEmail.toLowerCase();
                return (
                  <div className="admin-userrow" key={u.id}>
                    <span className="admin-uemail">
                      {u.email}
                      {isSelf && <span className="admin-self"> (you)</span>}
                    </span>
                    <span className="admin-ulast">
                      last seen {formatLastSeen(u.last_sign_in_at)}
                    </span>
                    <select
                      className="admin-role-select"
                      value={u.role ?? "user"}
                      disabled={busy || isSelf}
                      onChange={(e) =>
                        void onChangeRole(u, e.target.value as Role)
                      }
                      title={
                        isSelf ? "You can't change your own role" : "Change role"
                      }
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                    <button
                      type="button"
                      className="admin-remove"
                      disabled={busy || isSelf}
                      onClick={() => void onRemove(u)}
                      title={
                        isSelf
                          ? "You can't remove yourself"
                          : `Remove ${u.email}`
                      }
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="upload-modal-foot">
          <span className="upload-count">
            {users.length} user{users.length === 1 ? "" : "s"}
          </span>
          <span className="upload-actions">
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={onClose}
            >
              Done
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/cloud/AdminPanel.tsx
git commit -m "feat(admin): AdminPanel modal component"
```

---

## Task 6: Wire the panel into App.tsx

**Files:**
- Modify: `src/App.tsx` (import, state, button in the titlebar account cluster, render)

- [ ] **Step 1: Add the import**

In `src/App.tsx`, just below the existing `import { UploadModal } from "./cloud/UploadModal";` (line ~73):

```tsx
import { AdminPanel } from "./cloud/AdminPanel";
```

- [ ] **Step 2: Add panel open state**

In the web-only state block, just after `const [uploadModalSite, setUploadModalSite] = useState<string | null>(null);` (line ~807):

```tsx
// Web-only admin user-management panel (gated on isAdmin in the titlebar).
const [adminPanelOpen, setAdminPanelOpen] = useState(false);
```

- [ ] **Step 3: Add the "Admin" button to the account cluster**

In the titlebar account cluster, change the existing block (around line 2877) so the button sits before "Sign out":

```tsx
                <span className="title-account">
                  <span className="title-account-email" title={account.email}>
                    {account.email}
                  </span>
                  {isAdmin && (
                    <button
                      className="title-btn ghost"
                      onClick={() => setAdminPanelOpen(true)}
                      title="Manage users"
                    >
                      Admin
                    </button>
                  )}
                  <button
                    className="title-btn ghost"
                    onClick={account.signOut}
                    title="Sign out of FlagLabel"
                  >
                    Sign out
                  </button>
                </span>
```

- [ ] **Step 4: Render the panel**

Next to the existing `UploadModal` render (around line 3756), add:

```tsx
      {!isTauri() && adminPanelOpen && account && (
        <AdminPanel
          currentEmail={account.email}
          onClose={() => setAdminPanelOpen(false)}
        />
      )}
```

- [ ] **Step 5: Typecheck + tests + build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: tsc clean; vitest all green (existing suite + Task 1's tests); vite build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(admin): Admin button + panel wiring in titlebar"
```

---

## Task 7: AdminPanel styles

**Files:**
- Modify: `src/App.css` (append an admin-panel section)

- [ ] **Step 1: Append the CSS**

Add to the end of `src/App.css` (uses the same design tokens the rest of the app uses; adjust token names to match the existing `:root` if any differ):

```css
/* ── Admin user-management panel ─────────────────────────────────────── */
.admin-modal {
  width: min(680px, 92vw);
}
.admin-addrow {
  display: flex;
  gap: 8px;
  align-items: center;
}
.admin-email-input {
  flex: 1 1 auto;
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle, #2a2a2a);
  background: var(--bg-elevated, #181818);
  color: var(--text-primary, #eee);
  font-size: 14px;
}
.admin-email-input:focus-visible {
  outline: 2px solid var(--accent, #34a382);
  outline-offset: 1px;
}
.admin-role-select {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-subtle, #2a2a2a);
  background: var(--bg-elevated, #181818);
  color: var(--text-primary, #eee);
  font-size: 13px;
}
.admin-hint {
  margin: 10px 0 0;
  font-size: 12.5px;
  color: var(--text-secondary, #9a9a9a);
}
.admin-empty {
  padding: 18px 0;
  text-align: center;
  color: var(--text-secondary, #9a9a9a);
  font-size: 13px;
}
.admin-userlist {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border-subtle, #2a2a2a);
}
.admin-userrow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 2px;
  border-bottom: 1px solid var(--border-subtle, #2a2a2a);
}
.admin-uemail {
  flex: 1 1 auto;
  font-size: 14px;
  color: var(--text-primary, #eee);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.admin-self {
  color: var(--text-secondary, #9a9a9a);
  font-size: 12px;
}
.admin-ulast {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--text-secondary, #9a9a9a);
}
.admin-remove {
  flex: 0 0 auto;
  padding: 6px 10px;
  border-radius: 7px;
  border: 1px solid var(--border-subtle, #2a2a2a);
  background: transparent;
  color: #e06a6a;
  font-size: 12.5px;
  cursor: pointer;
}
.admin-remove:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.admin-remove:not(:disabled):hover {
  background: rgba(224, 106, 106, 0.12);
}
```

- [ ] **Step 2: Visual smoke test (run-flaglabel skill or live site)**

Run the web build (`npm run dev`) signed in as the admin, click **Admin** in the titlebar.
Expected: the panel opens, lists `toqitahamid.sarker@siu.edu` (you) and `seth.morelock@siu.edu`; your own role select + Remove are disabled; the add row + hint render.

- [ ] **Step 3: Commit**

```bash
git add src/App.css
git commit -m "style(admin): styles for the user-management panel"
```

---

## Task 8: End-to-end verification + security review

**Files:** none.

- [ ] **Step 1: Full add → list → remove round-trip**

In the running web app as admin: add a throwaway test email (e.g. `zz.temp@siu.edu`), confirm it appears in the list with role `user`, toggle it to `admin` and back, then Remove it. Confirm in Supabase:

Use `mcp__plugin_supabase_supabase__execute_sql` (`project_id: uggjzcbozdxvuawxddrn`):
```sql
select email from auth.users where email = 'zz.temp@siu.edu';
select email, role from public.app_roles where email = 'zz.temp@siu.edu';
```
Expected (after the Remove): both queries return **zero rows**.

- [ ] **Step 2: Confirm "add" sent no email**

Use `mcp__plugin_supabase_supabase__get_logs` (`service: "auth"`) right after an add.
Expected: a user-created event, **no** email/OTP send event for that address.

- [ ] **Step 3: Self lockout guard**

In the panel, confirm your own row's role select and Remove button are disabled, and that a direct `setRole(self, "user")` / `removeUser(self)` call returns a 400 from the function (covered by the guards in Task 3).

- [ ] **Step 4: Security review**

Run the `/security-review` command against the branch diff. Focus: the service-role key never appears in `dist/` or any client file, the admin gate can't be bypassed, and CORS/error handling don't leak internals.

Run: `grep -rn "service_role\|SERVICE_ROLE" src/ dist/ 2>/dev/null`
Expected: **no matches** (the key lives only in the deployed function's env).

- [ ] **Step 5: Final commit (if the review prompts fixes)**

```bash
git add -A
git commit -m "chore(admin): address security-review findings"
```

---

## Done criteria (from the spec)

1. Admin sees an "Admin" button → panel listing users with role + last sign-in. ✅ Tasks 5–7
2. Adding an email creates a confirmed passwordless account + `app_roles` row, no email sent, appears in list. ✅ Tasks 3, 8
3. Role changes and removals take effect (removal deletes both stores). ✅ Tasks 3, 8
4. A non-admin can neither see the button nor call the function. ✅ Tasks 3 (403 gate), 6 (`isAdmin` gate)
5. No service-role key in the client bundle or repo. ✅ Task 8 Step 4
6. The dashboard `/auth/users` page is never needed. ✅ whole feature

## Out of scope (tracked separately)
- **Custom SMTP (Resend)** so added users actually receive their OTP login code. Without it, a non-team user can be added but cannot yet log in.
