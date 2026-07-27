import { useCallback, useEffect, useState } from "react";
import {
  listUsers,
  addUser,
  setRole,
  removeUser,
  isValidEmail,
  listMaskToolUsers,
  grantMaskTools,
  revokeMaskTools,
  normalizeEmail,
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
  // Whether the VIEWER holds the mask tools (`has_mask_tools()`), which is what
  // gates the mask-tools section below — not the admin role. Membership is
  // managed by members, so an admin without the tools must not see it at all.
  maskTools: boolean;
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
  const { currentEmail, maskTools, onClose } = props;

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

  // Mask-tool holders, cross-referenced against `users` by normalized email.
  // Deliberately its OWN loading/error state and its own refetch: reusing
  // `refresh` would blank the whole user list behind "Loading users…" after every
  // grant. Only fetched when the viewer holds the tools — the RPC returns an
  // empty set for anyone else anyway, which would read as "nobody has them".
  // `maskLoaded` is a load-ONCE flag, not a per-request spinner: the placeholder
  // shows until the first fetch lands, and a post-grant refetch leaves the rows
  // in place instead of blanking them (`busy` already disables the buttons).
  const [maskEmails, setMaskEmails] = useState<Set<string>>(new Set());
  const [maskLoaded, setMaskLoaded] = useState(false);
  const [maskError, setMaskError] = useState<string | null>(null);

  const refreshMaskUsers = useCallback(async () => {
    setMaskError(null);
    try {
      setMaskEmails(new Set(await listMaskToolUsers()));
    } catch (e) {
      setMaskError(e instanceof Error ? e.message : String(e));
    } finally {
      setMaskLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (maskTools) void refreshMaskUsers();
  }, [maskTools, refreshMaskUsers]);

  const onToggleMaskTools = useCallback(
    async (u: AdminUser, hasTools: boolean) => {
      setBusy(true);
      setMaskError(null);
      try {
        if (hasTools) await revokeMaskTools(u.email);
        else await grantMaskTools(u.email);
        await refreshMaskUsers();
      } catch (e) {
        setMaskError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [refreshMaskUsers],
  );

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
                      last seen {formatLastSeen(u.last_seen_at)}
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

          {maskTools && (
            <div className="admin-section">
              <div className="admin-section-title">Mask tool access</div>
              <p className="admin-hint">
                Who can use the box, mask and polygon tools. Only people who
                already have them can grant or revoke. A newly granted person
                gets the tools the next time they load FlagLabel.
              </p>

              {maskError && (
                <div className="auth-error" role="alert">
                  {maskError}
                </div>
              )}

              {loading || !maskLoaded ? (
                <div className="admin-empty">Loading mask tool access…</div>
              ) : users.length === 0 ? (
                <div className="admin-empty">No users yet.</div>
              ) : (
                <div className="admin-userlist">
                  {users.map((u) => {
                    const isSelf =
                      u.email.toLowerCase() === currentEmail.toLowerCase();
                    const hasTools = maskEmails.has(normalizeEmail(u.email));
                    return (
                      <div className="admin-userrow" key={u.id}>
                        <span className="admin-uemail">
                          {u.email}
                          {isSelf && <span className="admin-self"> (you)</span>}
                        </span>
                        <span className="admin-ulast">
                          {hasTools ? "has mask tools" : "no mask tools"}
                        </span>
                        {/* The server refuses self-revoke ("cannot revoke
                            yourself"), so don't offer it. */}
                        {!(isSelf && hasTools) && (
                          <button
                            type="button"
                            className={hasTools ? "admin-remove" : "admin-grant"}
                            disabled={busy}
                            onClick={() => void onToggleMaskTools(u, hasTools)}
                            title={
                              hasTools
                                ? `Revoke mask tools from ${u.email}`
                                : `Grant mask tools to ${u.email}`
                            }
                          >
                            {hasTools ? "Revoke" : "Grant"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
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
