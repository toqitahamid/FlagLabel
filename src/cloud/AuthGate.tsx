import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { isTauri } from "./platform";
import { getSupabaseClient } from "./supabase-client";

// Web-only account handle, surfaced into App's merged titlebar so the single
// header can show the signed-in email and a Sign-out control. Null on desktop
// (no auth there), so the titlebar simply omits the account cluster.
export type Account = { email: string; signOut: () => void };
const AccountContext = createContext<Account | null>(null);
export function useAccount(): Account | null {
  return useContext(AccountContext);
}

// Wraps the whole app with the web-only invite-only login gate.
//
//   - Desktop (Tauri): pure pass-through. No Supabase import is touched, no
//     session check, no login — desktop stays auth-free and offline, identical
//     to before.
//   - Web (browser): blocks anonymous visitors. Shows a passwordless email-OTP
//     login screen until there is a session, then renders the app plus a thin
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

  // The header used to be two stacked bars (this account strip + App's titlebar).
  // Now there's one: hand the account down via context and let App's titlebar
  // render the email + Sign out at the far right (the "Bookend" layout).
  return (
    <AccountContext.Provider
      value={{
        email: session.user.email ?? "",
        signOut: () => {
          void getSupabaseClient().auth.signOut();
        },
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

// Passwordless email OTP login (see ADR-0004). Two steps: request a 6-digit
// code (`signInWithOtp`), then verify it (`verifyOtp`). There is deliberately
// no password path — institutional Microsoft/Defender Safe Links prefetches and
// burns one-time *link* tokens, so a plain-text code is the only email-based
// factor that survives. `shouldCreateUser: false` keeps it invite-only.
function LoginScreen() {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Seconds left before "Resend code" re-enables; mirrors Supabase's ~60s
  // per-user OTP cooldown so we don't invite a rate-limit error.
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = useCallback(async (): Promise<boolean> => {
    setSubmitting(true);
    setError(null);
    try {
      const { error: otpError } = await getSupabaseClient().auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false },
      });
      if (otpError) {
        setError(friendlyAuthError(otpError.message));
        return false;
      }
      setCooldown(60);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [email]);

  const onSubmitEmail = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (await sendCode()) {
        setCode("");
        setStep("code");
      }
    },
    [sendCode],
  );

  const onSubmitCode = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setSubmitting(true);
      setError(null);
      try {
        const { error: verifyError } = await getSupabaseClient().auth.verifyOtp({
          email: email.trim(),
          token: code.trim(),
          type: "email",
        });
        if (verifyError) setError(friendlyAuthError(verifyError.message));
        // On success, onAuthStateChange in WebAuthGate swaps in the app.
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [email, code],
  );

  if (step === "email") {
    return (
      <div className="auth-screen">
        <form className="auth-card" onSubmit={onSubmitEmail}>
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
            {submitting ? "Sending code…" : "Send code"}
          </button>
          <p className="auth-note">
            Access is invite-only. Contact the admin if your email isn't recognized.
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={onSubmitCode}>
        <h1 className="auth-title">Check your email</h1>
        <p className="auth-subtitle">We sent a 6-digit code to {email}.</p>
        <label className="auth-field">
          <span>Verification code</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            required
            autoFocus
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
          disabled={submitting || code.length < 6}
        >
          {submitting ? "Verifying…" : "Verify & sign in"}
        </button>
        <div className="auth-actions">
          <button
            type="button"
            className="auth-linkbtn"
            onClick={() => {
              setStep("email");
              setError(null);
            }}
          >
            Use a different email
          </button>
          <button
            type="button"
            className="auth-linkbtn"
            disabled={submitting || cooldown > 0}
            onClick={() => sendCode()}
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
        </div>
      </form>
    </div>
  );
}

// Map the rawest Supabase auth messages to something a labeler can act on,
// falling back to the original text for anything unrecognized.
function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("signups not allowed") || m.includes("not allowed for otp")) {
    return "That email isn't on the team yet. Ask the admin to add you.";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Too many requests. Wait a minute, then try again.";
  }
  if (m.includes("invalid") || m.includes("expired")) {
    return "That code is invalid or expired. Request a new one.";
  }
  return message;
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
