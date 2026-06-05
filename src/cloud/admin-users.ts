// Admin user-management client for the WEB build. Talks to the `admin-users`
// Edge Function (which holds the service-role key); the browser never sees that
// key. Also exports the pure email helpers and shared types used by AdminPanel.

import { getSupabaseClient } from "./supabase-client";

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
