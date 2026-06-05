# Passwordless email OTP (code, not link) for the web build

## Context

ADR-0003 chose **email + password, invite-only** for the cloud/web build's auth.
In practice the team's accounts are all `@siu.edu` — an institutional Microsoft
365 / Defender for Office 365 mail environment. Defender's **Safe Links**
rewrites and **prefetches** every URL in inbound mail (a scanner "clicks" the
link before the human does). Supabase's authentication links — magic link,
password-recovery, and invite links — all carry a **single-use** token. Safe
Links consumes that token during the prefetch, so by the time the recipient
clicks, they get *"Token has expired or is invalid."* This is a documented
Supabase limitation that names Defender Safe Links explicitly.

The original web `LoginScreen` only implemented `signInWithPassword` — there was
never a set-password or password-recovery screen — so the email + password model
was also never actually completable by a new labeler without the admin handing
over a password out of band. We wanted to remove that manual step.

## Decision

Switch the web build to **passwordless email OTP using the 6-digit code**, not a
link:

- **Login** is a two-step flow in `src/cloud/AuthGate.tsx`: enter email →
  `signInWithOtp({ email, options: { shouldCreateUser: false } })`; enter the
  6-digit code → `verifyOtp({ email, token, type: 'email' })`. The existing
  `onAuthStateChange` in `WebAuthGate` swaps the app in on success.
- **Invite-only is preserved** by `shouldCreateUser: false` (a stranger entering
  any address cannot self-create an account) on top of project-level signup
  being disabled.
- The Supabase **Magic Link** email template is edited to lead with the
  `{{ .Token }}` code and is **link-free** — there is no URL for Safe Links to
  rewrite or burn.
- **No password path at all.** The `signInWithPassword` form is removed; the web
  build is OTP-only.

This **supersedes the "email + password" auth bullet of ADR-0003**. The rest of
ADR-0003 (storage-adapter seam, RLS-as-the-gate, Supabase Storage/Postgres,
Realtime locks) is unchanged.

## Considered options

- **Email + password + self-service recovery (honor ADR-0003 as written).**
  Rejected: the recovery link and the first-time invite link are both consumed
  by Safe Links, so the flow is broken on arrival for SIU mail. Making it work
  needs a custom token-hash landing page that verifies only on an explicit
  button click — *more* engineering than OTP, to rescue a flow OTP sidesteps.
- **Code + a token-bearing link to a custom landing page.** Rejected as
  unnecessary. The landing page exists only to protect a token-bearing link from
  Safe Links, but the code already authenticates link-free, so there is nothing
  to protect. The link path also forces an extra button click and carries
  residual prefetch risk, while adding a route and a redirect-URL allow-list
  entry. If a convenience link is ever wanted, a **tokenless** link to the
  email-prefilled login page (`/?email=…`) adds it with nothing to burn.
- **Keep a password form as an admin break-glass.** Considered (it was free —
  the form already existed). Rejected for OTP purity at the owner's request. The
  trade-off accepted is that an email outage or rate-limit locks everyone out
  until mail recovers, with **no in-app fallback**: recovery means fixing mail
  delivery (or, in a genuine emergency, redeploying a temporary password form),
  *not* a dashboard login — a password row in `auth.users` is useless when the
  app exposes no password path to authenticate against.

## Consequences

- Auth is now **100% email-dependent**. Supabase's built-in mailer is
  rate-limited (a few sends/hour project-wide on the free tier, ~60 s per-user
  cooldown); if the team grows or mail proves unreliable, wire up custom SMTP
  (e.g. Resend) with proper SPF/DKIM/DMARC. The login screen surfaces a resend
  cooldown to avoid tripping the rate limit.
- There are **no passwords to manage, leak, share, or reset** on the daily path,
  so leaked-password protection is moot for normal use, and there is no
  password-recovery flow to build or maintain.
- The Supabase **Magic Link template must stay link-free** (lead with
  `{{ .Token }}`). Editing it to a code affects all magic-link mail, which is
  intended — the web build sends only OTP codes.
- Onboarding a labeler reduces to: admin creates the auth user in the dashboard
  (and seeds `app_roles`), then the labeler signs in with their email + the
  emailed code. No password handoff.
- **Deploy ordering is load-bearing.** Pushing this code to `main` auto-deploys
  the web app (see CLAUDE.md). If the Magic Link template still sends a *link*
  when the OTP-only build goes live, every login is dead and there is no password
  fallback. So the **template must be switched to the code first**, then verified,
  then the code deployed. Changing the template ahead of the deploy is safe — the
  currently-live password build never touches that template.
