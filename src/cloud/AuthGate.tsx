import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { isTauri } from "./platform";
import { getSupabaseClient } from "./supabase-client";

// Wraps the whole app with the web-only invite-only login gate.
//
//   - Desktop (Tauri): pure pass-through. No Supabase import is touched, no
//     session check, no login — desktop stays auth-free and offline, identical
//     to before.
//   - Web (browser): blocks anonymous visitors. Shows an email+password login
//     screen until there is a session, then renders the app plus a thin
//     sign-out bar. Sessions persist across reload (supabase-js localStorage).
export function AuthGate({ children }: { children: React.ReactNode }) {
  if (isTauri()) {
    return <>{children}</>;
  }
  return <WebAuthGate>{children}</WebAuthGate>;
}

function WebAuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  // `null` while we don't yet know whether a session exists (initial load);
  // resolving it first avoids flashing the login screen for an already-signed-in
  // user on reload.
  const [ready, setReady] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabaseClient();
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : String(e));
      setReady(true);
      return;
    }

    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
        setReady(true);
      })
      .catch(() => setReady(true));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (configError) {
    return <ConfigErrorScreen message={configError} />;
  }
  if (!ready) {
    return <CenteredMessage>Loading…</CenteredMessage>;
  }
  if (!session) {
    return <LoginScreen />;
  }

  return (
    <div className="auth-shell">
      <div className="auth-bar">
        <span className="auth-bar-email">{session.user.email}</span>
        <button
          type="button"
          className="title-btn"
          onClick={() => getSupabaseClient().auth.signOut()}
        >
          Sign out
        </button>
      </div>
      {children}
    </div>
  );
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitting(true);
      setError(null);
      try {
        const { error: signInError } = await getSupabaseClient().auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) setError(signInError.message);
        // On success, onAuthStateChange in WebAuthGate swaps in the app.
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [email, password],
  );

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1 className="auth-title">FlagLabel</h1>
        <p className="auth-subtitle">Sign in to the shared dataset.</p>
        <label className="auth-field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}
        <button
          type="submit"
          className="btn primary auth-submit"
          disabled={submitting}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        <p className="auth-note">
          Access is invite-only. Contact the project admin for an account.
        </p>
      </form>
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-screen">
      <div className="auth-loading">{children}</div>
    </div>
  );
}

function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">FlagLabel</h1>
        <div className="auth-error" role="alert">
          {message}
        </div>
      </div>
    </div>
  );
}
