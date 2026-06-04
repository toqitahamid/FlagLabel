import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseStorageBackend, UploadResult } from "./supabase-backend";

// Polished "Add images" modal for the web build. Lets an admin pick (drag-and-drop
// or browse) image files for one already-named folder/site, previews the
// selection with per-file duplicate detection, and runs the upload via
// `backend.uploadImagesToSite`, showing live progress and a final summary.
//
// Self-contained on purpose: the only cross-file dependency is the backend it
// calls and its `UploadResult` type. Styling is owned by the integrator — this
// file only assigns the agreed className vocabulary.

type UploadModalProps = {
  backend: SupabaseStorageBackend;
  site: string;
  existingNames: string[];
  onClose: () => void;
  onUploaded: () => void;
};

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png"];

// Keep a file only if it's a real image we accept AND not macOS AppleDouble
// junk (the `._Foo.jpg` sidecar files a Mac sprays into copied folders). Matches
// on the filename extension, lowercased, rather than trusting the MIME type
// (which is empty for some dragged files).
function isAcceptedImage(file: File): boolean {
  const name = file.name;
  if (name.startsWith("._")) return false;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = name.slice(dot + 1).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

// Human-readable byte size, e.g. 3_010_000 → "2.9 MB". Plain decimal-ish
// (binary 1024) scaling; good enough for a file-row hint.
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function UploadModal(props: UploadModalProps) {
  const { backend, site, existingNames, onClose, onUploaded } = props;

  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [result, setResult] = useState<UploadResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  // Read the latest `busy` from a ref inside the document-level Escape handler so
  // the listener never closes over a stale value (and we don't re-bind it on
  // every busy flip).
  const busyRef = useRef(busy);
  busyRef.current = busy;

  // Merge new picks into the existing selection, filtering to accepted images and
  // de-duplicating by filename so a re-pick of the same name REPLACES the prior
  // entry (insertion order preserved by Map).
  const addFiles = useCallback((incoming: File[]) => {
    const accepted = incoming.filter(isAcceptedImage);
    if (accepted.length === 0) return;
    setFiles((prev) => {
      const byName = new Map<string, File>();
      for (const f of prev) byName.set(f.name, f);
      for (const f of accepted) byName.set(f.name, f);
      return Array.from(byName.values());
    });
  }, []);

  const removeFile = useCallback((name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const picked = e.target.files;
      if (picked) addFiles(Array.from(picked));
      // Reset so picking the same filename again (or after removing it) still
      // fires onChange — otherwise an unchanged value is a silent no-op.
      e.target.value = "";
    },
    [addFiles],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer.files;
      if (dropped) addFiles(Array.from(dropped));
    },
    [addFiles],
  );

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  // Escape closes the modal when not mid-upload.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const onBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      // Only a click on the overlay itself (not bubbled from the modal body)
      // closes, and never while uploading.
      if (e.target === e.currentTarget && !busy) {
        onClose();
      }
    },
    [busy, onClose],
  );

  const runUpload = useCallback(async () => {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setResult(null);
    setProgress({ done: 0, total: files.length });
    try {
      const res = await backend.uploadImagesToSite(site, files, (done, total) =>
        setProgress({ done, total }),
      );
      setResult(res);
      // Refresh the gallery even on partial failure — anything that uploaded
      // should show up.
      onUploaded();
    } catch (err) {
      setResult({
        uploaded: 0,
        skipped: 0,
        failed: [
          {
            name: "(upload)",
            error: err instanceof Error ? err.message : String(err),
          },
        ],
      });
    } finally {
      setBusy(false);
    }
  }, [backend, busy, files, onUploaded, site]);

  const existingSet = new Set(existingNames);
  const duplicateCount = files.reduce(
    (n, f) => (existingSet.has(f.name) ? n + 1 : n),
    0,
  );
  const totalBytes = files.reduce((n, f) => n + f.size, 0);

  return (
    <div
      className="upload-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Add images"
      onClick={onBackdropClick}
    >
      <div className="upload-modal">
        <div className="upload-modal-head">
          <div className="upload-modal-title">Add images</div>
          <div className="upload-modal-sub">
            to <b>{site}</b>
          </div>
        </div>

        <div className="upload-modal-body">
          <div
            className={dragOver ? "upload-dropzone drag" : "upload-dropzone"}
            onClick={openPicker}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <DropIcon />
            <div>
              Drag &amp; drop images here, or{" "}
              <span
                className="upload-browse"
                onClick={(e) => {
                  e.stopPropagation();
                  openPicker();
                }}
              >
                browse files
              </span>
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              style={{ display: "none" }}
              onChange={onInputChange}
            />
          </div>

          {files.length > 0 && (
            <div className="upload-filelist">
              <div className="upload-filelist-head">
                {files.length} file{files.length === 1 ? "" : "s"} selected ·{" "}
                {formatBytes(totalBytes)}
              </div>
              {!result && duplicateCount > 0 && (
                <div className="upload-dup-note">
                  ⚠ {duplicateCount} file{duplicateCount === 1 ? "" : "s"} already
                  exist{duplicateCount === 1 ? "s" : ""} in this folder and will be
                  replaced.
                </div>
              )}
              {files.map((file) => {
                // Only flag duplicates BEFORE uploading. After a successful
                // upload the gallery has refreshed, so the just-added file now
                // "exists" — re-flagging it would make a clean upload look like a
                // conflict.
                const isDup = !result && existingSet.has(file.name);
                return (
                  <div className="upload-filerow" key={file.name}>
                    <span className="upload-thumb">
                      <ImageIcon />
                    </span>
                    <span className="upload-fmeta">
                      <span className="upload-fname">{file.name}</span>
                      <span className="upload-fsize">
                        {formatBytes(file.size)}
                        {isDup && (
                          <span className="upload-fdup">
                            {" "}
                            · already in folder, will replace
                          </span>
                        )}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="upload-fremove"
                      aria-label={`Remove ${file.name}`}
                      disabled={busy}
                      onClick={() => removeFile(file.name)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {busy && progress && (
            <div className="upload-status">
              Uploading… {progress.done}/{progress.total}
            </div>
          )}
          {!busy && result && (
            <div className="upload-status">
              Added {result.uploaded} · skipped {result.skipped} ·{" "}
              {result.failed.length} failed
            </div>
          )}
        </div>

        <div className="upload-modal-foot">
          <span className="upload-count">
            {result
              ? "Upload complete"
              : `${files.length} to upload`}
          </span>
          <span className="upload-actions">
            {result ? (
              <button type="button" className="btn primary" onClick={onClose}>
                Done
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={files.length === 0 || busy}
                  onClick={runUpload}
                >
                  Upload {files.length} image{files.length === 1 ? "" : "s"}
                </button>
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

function ImageIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

function DropIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}
