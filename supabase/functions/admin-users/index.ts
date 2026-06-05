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
        // listUsers is paginated (~50/page by default); pull every page so the
        // panel never silently truncates the user list.
        type AuthUser = {
          id: string;
          email?: string | null;
          last_sign_in_at?: string | null;
        };
        const all: AuthUser[] = [];
        let page = 1;
        for (;;) {
          const { data, error } = await admin.auth.admin.listUsers({
            page,
            perPage: 1000,
          });
          if (error) throw error;
          all.push(...data.users);
          if (data.users.length < 1000) break;
          page += 1;
        }
        const { data: roles } = await admin
          .from("app_roles")
          .select("email, role");
        const roleByEmail = new Map(
          (roles ?? []).map((r: { email: string; role: string }) => [
            r.email,
            r.role,
          ]),
        );
        const users = all.map((u) => ({
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
          .upsert(
            { email: got.user.email.toLowerCase(), role },
            { onConflict: "email" },
          );
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
          const { error: roleDelErr } = await admin
            .from("app_roles")
            .delete()
            .eq("email", got.user.email.toLowerCase());
          if (roleDelErr) throw roleDelErr;
        }
        return json({ ok: true });
      }

      default:
        return json({ error: `Unknown action: ${payload.action}` }, 400);
    }
  } catch (e) {
    // Log the real error server-side; never return internal detail (schema,
    // constraint text, etc.) to the browser.
    console.error("admin-users error:", e);
    return json({ error: "Internal error" }, 500);
  }
});
