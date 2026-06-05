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
