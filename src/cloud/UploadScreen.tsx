import { useCallback, useRef, useState } from "react";
import type { SupabaseStorageBackend, UploadResult } from "./supabase-backend";

// Admin-only (web) ingest screen: pick a camera folder in the browser, upload
// its .jpg/.jpeg/.png files to Supabase Storage under `<site>/<name>`, and seed
// the matching `annotations` rows. Rendered only when `fetchIsAdmin()` is true
// (RLS still enforces admin-only server-side as the real gate). On success it
// calls `onDone` so the gallery refreshes.
//
// `webkitdirectory` is not in React's JSX input typings, so the attribute is set
// imperatively via a ref callback (keeps `tsc` clean without an `any` cast).
export function UploadScreen({
  backend,
  onDone,
  onClose,
}: {
  backend: SupabaseStorageBackend;
  onDone: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onPick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0) return;
      const files = Array.from(fileList).map((file) => ({
        file,
        relativePath: file.webkitRelativePath || file.name,
      }));
      setBusy(true);
      setError(null);
      setResult(null);
      setProgress({ done: 0, total: files.length });
      try {
        const r = await backend.uploadFolder(files, (done, total) =>
          setProgress({ done, total }),
        );
        setResult(r);
        if (r.uploaded > 0) onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
        // Reset so picking the same folder again re-fires onChange.
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [backend, onDone],
  );

  return (
    <div className="upload-overlay" role="dialog" aria-modal="true" aria-label="Upload images">
      <div className="upload-card">
        <h2 className="upload-title">Upload a camera folder</h2>
        <p className="upload-note">
          Pick a folder named for the camera (e.g. <code>cam02</code>). Its
          .jpg/.jpeg/.png files upload to the shared dataset; the folder name
          becomes the <b>site</b>.
        </p>

        <input
          ref={(el) => {
            inputRef.current = el;
            if (el) {
              el.setAttribute("webkitdirectory", "");
              el.setAttribute("directory", "");
            }
          }}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,image/jpeg,image/png"
          onChange={onPick}
          disabled={busy}
        />

        {progress && busy && (
          <div className="upload-progress" role="status">
            Uploading {progress.done} / {progress.total}…
          </div>
        )}

        {result && (
          <div className="upload-result" role="status">
            Uploaded {result.uploaded}
            {result.skipped > 0 && <> · skipped {result.skipped} non-image</>}
            {result.failed.length > 0 && (
              <> · <span className="upload-failed">{result.failed.length} failed</span></>
            )}
          </div>
        )}

        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}

        <div className="upload-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
