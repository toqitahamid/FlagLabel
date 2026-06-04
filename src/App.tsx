import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
} from "@tauri-apps/api/menu";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { Store } from "@tauri-apps/plugin-store";
import { check } from "@tauri-apps/plugin-updater";
import "./App.css";
import {
  type Annotation,
  type WireGroundPoint,
  type Transect,
  type Counts,
  type SpanType,
  countsFromAnnotations,
  countsByTransect,
  canonicalizeSpan,
} from "./annotations/model";
import {
  buildAnnotationFile,
  parseAnnotationFile,
  type FileMeta,
} from "./annotations/schema";
import {
  type ActiveType,
  hitTest,
} from "./annotations/hit-test";
import {
  pendingSpanReducer,
  IDLE as PENDING_IDLE,
} from "./annotations/pending-span";
import { findCollision } from "./annotations/collision";
import { TauriStorageBackend } from "./cloud/tauri-backend";
import { SupabaseStorageBackend, fetchIsAdmin } from "./cloud/supabase-backend";
import {
  serializeAnnotationFile,
  canonicalizeAnnotationFile,
  buildZipEntries,
  exportEntryName,
} from "./cloud/export";
import {
  deriveSummary,
  summarizeProgress,
  isAnnotated,
  type ImageProgress,
} from "./cloud/summary";
import { isTauri } from "./cloud/platform";
import type { ImageItem } from "./cloud/storage-backend";
import {
  validateSiteName,
  validateStem,
  renameImageName,
  splitImageName,
} from "./cloud/site-upload";
import { UploadModal } from "./cloud/UploadModal";
import { useImageLock } from "./cloud/useImageLock";

// Active annotation type ↔ annotation kind mapping. "wire_ground" is the
// classic dot; "vertical_span" is the two-click flag vertical span;
// "horizontal_span" is the two-click flag horizontal span;
// "flag_to_ground_span" is the two-click flag-body-top → wire–ground span.
type ActiveAnnoType = ActiveType;
// Annotation kind → SpanType (or null for the non-span wire-ground kind). A
// FULL Record over every kind, so adding a new span kind hard-errors here until
// an entry is added — matching SPAN_KIND_FOR / SPAN_LABEL_SUFFIX /
// canonicalizeSpan. The call site's `if (!spanType) return;` handles the null
// (wire-ground) case unchanged.
const SPAN_TYPE_FOR: Record<ActiveAnnoType, SpanType | null> = {
  wire_ground: null,
  vertical_span: "vertical",
  horizontal_span: "horizontal",
  flag_to_ground_span: "flag_to_ground",
};

// SpanType → annotation kind. Keyed on `SpanType` (a full Record), so adding a
// new span type forces a matching entry here at compile time. The value is
// narrowed to the span kinds so a completed span object typechecks as a member
// of the union without widening `kind` back to all annotation kinds.
const SPAN_KIND_FOR: Record<SpanType, Span["kind"]> = {
  vertical: "vertical_span",
  horizontal: "horizontal_span",
  flag_to_ground: "flag_to_ground_span",
};

// The annotation-type selector, in keyboard order (Q W / E R → a 2×2 grid).
// One entry per kind keeps the rail buttons DRY and in sync with the union.
const ANNOTATION_TOOLS: {
  kind: ActiveAnnoType;
  label: string;
  title: string;
  hint: string;
}[] = [
  {
    kind: "wire_ground",
    label: "Wire–ground",
    title: "Wire–ground point (Q): one click at the wire–ground intersection",
    hint: "One click at the wire–ground intersection.",
  },
  {
    kind: "vertical_span",
    label: "Vertical",
    title: "Vertical span (W): top edge → bottom edge of the flag",
    hint: "Top → bottom edge of the flag · 2 clicks.",
  },
  {
    kind: "horizontal_span",
    label: "Horizontal",
    title: "Horizontal span (E): left edge → right edge of the flag",
    hint: "Left → right edge of the flag · 2 clicks.",
  },
  {
    kind: "flag_to_ground_span",
    label: "Flag→ground",
    title: "Flag-to-ground span (R): flag top → wire base at the ground",
    hint: "Flag top → wire base at the ground · 2 clicks.",
  },
];

// Short label per kind (for the sparkline caption), derived from the tool list
// so it stays in sync.
const KIND_LABEL = ANNOTATION_TOOLS.reduce(
  (m, t) => ((m[t.kind] = t.label), m),
  {} as Record<ActiveAnnoType, string>
);

// Directional placement hint per kind (for the live rail help line), derived
// from the tool list so it stays in sync. Endpoints are canonicalized after
// placement (see canonicalizeSpan), so the arrow is a suggested order for
// consistency, not a requirement.
const KIND_HINT = ANNOTATION_TOOLS.reduce(
  (m, t) => ((m[t.kind] = t.hint), m),
  {} as Record<ActiveAnnoType, string>
);

type LoadedImage = {
  path: string;
  url: string;
  width: number;
  height: number;
};

type Cursor = { u: number; v: number };

const TRANSECTS: Transect[] = ["L", "C", "R"];

const TRANSECT_COLORS: Record<Transect, string> = {
  L: "#FF4D4D",
  C: "#FFD93D",
  R: "#4DA6FF",
};

const CANONICAL_DISTANCES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

const ZOOM_PANEL_PX = 360;
const ZOOM_MIN = 15;
const ZOOM_MAX = 300;
const ZOOM_DEFAULT = 80;
const CROSSHAIR_COLOR = "#84cc16";

const SETTINGS_FILE = "settings.json";
const SETTINGS_KEY_CLICKS_DIR = "clicks_dir";
const SETTINGS_KEY_ONBOARDED = "onboarded";

function pathBasename(p: string): string {
  return p.split("/").pop() ?? p;
}

function pathParent(p: string): string {
  const parts = p.split("/");
  parts.pop();
  return parts.join("/");
}

function siteFromPath(p: string): string {
  return pathBasename(pathParent(p)) || "unknown";
}

function stemFromPath(p: string): string {
  return pathBasename(p).replace(/\.[^.]+$/, "");
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

// ---- Explorer-tree icons (web sidebar). Stroke-based, currentColor. ----
function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}
function FolderPlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );
}
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M12 3v12" />
      <path d="m7 12 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}
function ImageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}
function RenameIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

function clickJsonPathFor(imagePath: string, clicksDir: string): string {
  const name = `${siteFromPath(imagePath)}__${stemFromPath(imagePath)}.json`;
  return joinPath(clicksDir, name);
}

// Ephemeral StorageBackend identity for an image path. Uses App's existing
// site/basename helpers, so no new path coupling — for the Tauri backend `id`
// is the absolute path it was always keyed on.
function itemFromPath(imagePath: string): ImageItem {
  return {
    id: imagePath,
    site: siteFromPath(imagePath),
    name: pathBasename(imagePath),
  };
}

const VIEW_SCALE_MIN = 1;
const VIEW_SCALE_MAX = 10;
const WHEEL_ZOOM_RATE = 0.0015;

function computeViewParams(
  iw: number,
  ih: number,
  viewScale: number,
  viewPanX: number,
  viewPanY: number,
  cw: number,
  ch: number
) {
  const fitScale = Math.min(cw / iw, ch / ih);
  const effScale = fitScale * viewScale;
  const drawW = iw * effScale;
  const drawH = ih * effScale;
  const offsetX = (cw - drawW) / 2 + viewPanX;
  const offsetY = (ch - drawH) / 2 + viewPanY;
  return { fitScale, effScale, drawW, drawH, offsetX, offsetY };
}

function clampPan(pan: number, drawSize: number, canvasSize: number): number {
  const maxPan = Math.max(0, (drawSize - canvasSize) / 2);
  return Math.max(-maxPan, Math.min(maxPan, pan));
}

const HIT_TEST_RADIUS_CSS_PX = 12;

function fmtTimeOfDay(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function fmtDistance(d: number): string {
  return Number.isInteger(d) ? String(d) : d.toFixed(1);
}

const HELP_SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: "File",
    rows: [
      ["Open image", "⌘O"],
      ["Open folder", "⌘⇧O"],
      ["Save", "⌘S"],
    ],
  },
  {
    title: "Navigation",
    rows: [
      ["Previous / next image (folder mode)", "← / →"],
      ["Jump to image", "click sidebar row"],
    ],
  },
  {
    title: "Labels",
    rows: [
      ["Annotation type wire–ground / vert. span / horiz. span / flag→ground", "Q / W / E / R"],
      ["Transect L / C / R", "1 / 2 / 3"],
      ["Distance ± 1 m", "↑ / ↓"],
      ["Distance ± 0.5 m", "⇧↑ / ⇧↓"],
      ["Toggle auto-advance 1→15", "A"],
    ],
  },
  {
    title: "Vertical span (W)",
    rows: [
      ["Place endpoint 1, then endpoint 2", "click ×2"],
      ["Endpoints span canvas + zoom panel", "either surface"],
      ["Cancel a half-placed span", "Esc"],
    ],
  },
  {
    title: "Horizontal span (E)",
    rows: [
      ["Place left endpoint, then right endpoint", "click ×2"],
      ["Endpoints span canvas + zoom panel", "either surface"],
      ["Cancel a half-placed span", "Esc"],
    ],
  },
  {
    title: "Flag-to-ground span (R)",
    rows: [
      ["Place flag-top endpoint, then ground endpoint", "click ×2"],
      ["Endpoints span canvas + zoom panel", "either surface"],
      ["Cancel a half-placed span", "Esc"],
    ],
  },
  {
    title: "Editing",
    rows: [
      ["Undo last annotation", "⌘Z"],
      ["Clear all (current image)", "clear all link"],
      ["Select an annotation", "mouse"],
      ["Remove selected annotation", "Del / ⌫"],
      ["Retag selected annotation L / C / R", "1 / 2 / 3"],
      ["Adjust selected annotation distance", "↑ / ↓"],
      ["Deselect", "Esc"],
    ],
  },
  {
    title: "View",
    rows: [
      ["Zoom main image (at cursor)", "scroll / pinch"],
      ["Zoom main image (centered)", "= / −"],
      ["Reset zoom & pan", "0"],
      ["Pan when zoomed in", "hold Space + drag"],
      ["Zoom panel radius − / +", "[ / ]"],
    ],
  },
  {
    title: "Help",
    rows: [
      ["Open this panel", "? or ⌘/"],
      ["Close panel", "Esc"],
    ],
  },
];

// A small animated schematic of a numbered flag on a wire, showing the four
// annotation types placing themselves in turn: the wire–ground point (Q), the
// vertical (W) and horizontal (E) flag spans, and the full flag-to-ground span
// (R). Pure SVG + CSS; the rolling green highlight is suppressed under
// prefers-reduced-motion, which leaves all four annotations drawn and legible.
function AnnotationGuide() {
  return (
    <svg
      className="annotation-guide"
      viewBox="0 0 260 184"
      role="img"
      aria-label="A flag on a wire. The four annotation types: Q marks the wire–ground point, W spans the flag top to bottom, E spans it left to right, and R spans from the flag top down to the wire base at the ground."
    >
      {/* ground line + texture */}
      <line className="ag-ground" x1="20" y1="150" x2="240" y2="150" />
      {[36, 60, 84, 108, 156, 180, 204, 228].map((x) => (
        <line
          key={x}
          className="ag-ground-tick"
          x1={x}
          y1="150"
          x2={x - 7}
          y2="158"
        />
      ))}
      {/* wire (solid above ground, dashed where buried) */}
      <line className="ag-wire" x1="130" y1="58" x2="130" y2="150" />
      <line
        className="ag-wire ag-wire--buried"
        x1="130"
        y1="150"
        x2="130"
        y2="163"
      />
      {/* flag body */}
      <rect className="ag-flag" x="105" y="24" width="50" height="34" rx="2" />

      {/* R — flag-to-ground span (drawn first so the others read above it) */}
      <g className="ag-anno ag-anno--r">
        <line x1="150" y1="24" x2="150" y2="150" />
        <line x1="145" y1="24" x2="155" y2="24" />
        <line x1="145" y1="150" x2="155" y2="150" />
        <text x="160" y="100">R</text>
      </g>

      {/* W — vertical flag span */}
      <g className="ag-anno ag-anno--w">
        <line x1="113" y1="24" x2="113" y2="58" />
        <line x1="108" y1="24" x2="118" y2="24" />
        <line x1="108" y1="58" x2="118" y2="58" />
        <text x="98" y="44" textAnchor="end">
          W
        </text>
      </g>

      {/* E — horizontal flag span */}
      <g className="ag-anno ag-anno--e">
        <line x1="105" y1="46" x2="155" y2="46" />
        <line x1="105" y1="41" x2="105" y2="51" />
        <line x1="155" y1="41" x2="155" y2="51" />
        <text x="130" y="74" textAnchor="middle">
          E
        </text>
      </g>

      {/* Q — wire–ground point */}
      <g className="ag-anno ag-anno--q">
        <circle cx="130" cy="150" r="4.5" />
        <text x="130" y="178" textAnchor="middle">
          Q
        </text>
      </g>
    </svg>
  );
}

// Three transect sampling lines — Left, Center, Right — fanning out from the
// camera, each in its data color (red / amber / blue). Keys 1 / 2 / 3 select
// them, and the chosen transect's color tags every annotation. Same
// suppress-under-reduced-motion behavior as AnnotationGuide.
function TransectGuide() {
  return (
    <svg
      className="transect-guide"
      viewBox="0 0 220 150"
      role="img"
      aria-label="Three sampling lines fanning out from the camera: Left in red, Center in amber, Right in blue. Keys 1, 2, 3 select them, and the chosen transect's color tags every annotation."
    >
      {/* camera viewpoint */}
      <path className="tg-camera" d="M104 141 L116 141 L110 132 Z" />

      <g className="tg-anno tg-anno--l">
        <line x1="110" y1="135" x2="52" y2="30" />
        <circle cx="84" cy="89" r="2.6" />
        <circle cx="65" cy="54" r="2.6" />
        <text x="47" y="24" textAnchor="middle">
          L
        </text>
      </g>
      <g className="tg-anno tg-anno--c">
        <line x1="110" y1="135" x2="110" y2="26" />
        <circle cx="110" cy="88" r="2.6" />
        <circle cx="110" cy="50" r="2.6" />
        <text x="110" y="18" textAnchor="middle">
          C
        </text>
      </g>
      <g className="tg-anno tg-anno--r">
        <line x1="110" y1="135" x2="168" y2="30" />
        <circle cx="136" cy="89" r="2.6" />
        <circle cx="155" cy="54" r="2.6" />
        <text x="173" y="24" textAnchor="middle">
          R
        </text>
      </g>
    </svg>
  );
}

// The two onboarding schematics side by side: which line (transect) and what to
// mark (tool). Shared by the empty-state intro and the keyboard-help overlay.
function GuideFigures() {
  return (
    <div className="intro-figures">
      <figure className="intro-figure">
        <TransectGuide />
        <figcaption className="intro-figcaption">
          <b>Transect</b> — which line. <kbd>1</kbd>{" "}
          <span className="t-l">L</span> · <kbd>2</kbd>{" "}
          <span className="t-c">C</span> · <kbd>3</kbd>{" "}
          <span className="t-r">R</span>. Its color tags every mark.
        </figcaption>
      </figure>
      <figure className="intro-figure">
        <AnnotationGuide />
        <figcaption className="intro-figcaption">
          <b>Tool</b> — what to mark. <kbd>Q</kbd>
          <kbd>W</kbd>
          <kbd>E</kbd>
          <kbd>R</kbd>
        </figcaption>
      </figure>
    </div>
  );
}

function KeyboardHelp({
  onClose,
  appVersion,
}: {
  onClose: () => void;
  appVersion: string;
}) {
  return (
    <div className="help-backdrop" onClick={onClose}>
      <div
        className="help-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Keyboard reference"
      >
        <div className="help-header">
          <div className="help-title">
            FlagLabel <span className="dim">· Keyboard reference</span>
          </div>
          <button
            className="help-close"
            onClick={onClose}
            aria-label="Close"
            title="Esc"
          >
            ×
          </button>
        </div>

        <p className="help-intro">
          Click on the wire-ground intersection (base) of each flag — not the
          flag head. Pick a transect and distance from the right rail, then
          click in the main image or the magnified zoom panel. Auto-advance
          fills distances 1 through 15 in sequence. Files auto-save 5 seconds
          after the last change once a clicks folder is chosen.
        </p>

        <div className="help-guide">
          <GuideFigures />
        </div>

        <div className="help-grid">
          {HELP_SECTIONS.map((section) => (
            <div key={section.title} className="help-section">
              <div className="help-section-title">{section.title}</div>
              <dl className="help-rows">
                {section.rows.map(([action, keys]) => (
                  <div key={action} className="help-row">
                    <dt>{action}</dt>
                    <dd>
                      <kbd>{keys}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>

        <div className="help-footer">
          <span>v{appVersion || "0.1.0"}</span>
          <span className="dim">Press Esc to close</span>
        </div>
      </div>
    </div>
  );
}

// A pending duplicate-collision decision. `candidate` is the fully-formed,
// canonicalized annotation the labeler just placed; `existingIndex` is the index
// in `clicks` of the colliding annotation (same {transect, distance, kind}).
type PendingCollision = {
  candidate: Annotation;
  existingIndex: number;
} | null;

// Blocking three-way confirm shown when a placement would duplicate an existing
// {transect, distance, kind}. Mirrors the KeyboardHelp backdrop/dialog pattern.
// The choice is replace / keep both / cancel — no native 2-button ask works here.
function CollisionConfirm({
  pending,
  onReplace,
  onKeepBoth,
  onCancel,
}: {
  pending: NonNullable<PendingCollision>;
  onReplace: () => void;
  onKeepBoth: () => void;
  onCancel: () => void;
}) {
  const a = pending.candidate;
  const label = `${a.transect}${fmtDistance(a.distance)}`;
  return (
    <div className="help-backdrop" onClick={onCancel}>
      <div
        className="collision-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Duplicate annotation"
      >
        <div className="help-header">
          <div className="help-title">Duplicate annotation</div>
        </div>
        <p className="help-intro">
          An <strong>{label}</strong> {KIND_NAME[a.kind]} already exists. Replace
          the existing one, keep both, or cancel this placement?
        </p>
        <div className="collision-actions">
          <button className="collision-btn" onClick={onReplace}>
            Replace
          </button>
          <button className="collision-btn" onClick={onKeepBoth}>
            Keep both
          </button>
          <button className="collision-btn collision-btn-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <div className="help-footer">
          <span className="dim">Press Esc to cancel</span>
        </div>
      </div>
    </div>
  );
}

function DistanceSparkline({
  clicks,
  activeType,
}: {
  clicks: Annotation[];
  activeType: ActiveAnnoType;
}) {
  const bins: Counts[] = Array.from({ length: 15 }, () => ({
    L: 0,
    C: 0,
    R: 0,
  }));
  for (const c of clicks) {
    // Summarize the distance distribution of the ACTIVE annotation type, so
    // the sparkline always reflects what the labeler is currently placing.
    if (c.kind !== activeType) continue;
    const i = Math.round(c.distance) - 1;
    if (i >= 0 && i < 15) bins[i][c.transect]++;
  }
  const maxCount = Math.max(1, ...bins.map((b) => b.L + b.C + b.R));
  const W = 240;
  const H = 28;
  const barW = W / 15;
  return (
    <svg
      className="distance-sparkline"
      viewBox={`0 0 ${W} ${H + 10}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <line
        x1="0"
        y1={H + 0.5}
        x2={W}
        y2={H + 0.5}
        stroke="var(--border-subtle)"
        strokeWidth="1"
      />
      {bins.map((b, i) => {
        const x = i * barW + 1;
        const bw = barW - 2;
        const lH = (b.L / maxCount) * H;
        const cH = (b.C / maxCount) * H;
        const rH = (b.R / maxCount) * H;
        const totalH = lH + cH + rH;
        const yBase = H - totalH;
        return (
          <g key={i}>
            <rect
              x={x}
              y={yBase}
              width={bw}
              height={lH}
              fill={TRANSECT_COLORS.L}
            />
            <rect
              x={x}
              y={yBase + lH}
              width={bw}
              height={cH}
              fill={TRANSECT_COLORS.C}
            />
            <rect
              x={x}
              y={yBase + lH + cH}
              width={bw}
              height={rH}
              fill={TRANSECT_COLORS.R}
            />
          </g>
        );
      })}
      <text
        x="0"
        y={H + 9}
        fontSize="8"
        fill="var(--text-tertiary)"
        fontFamily="var(--font-mono)"
      >
        1
      </text>
      <text
        x={W}
        y={H + 9}
        fontSize="8"
        fill="var(--text-tertiary)"
        fontFamily="var(--font-mono)"
        textAnchor="end"
      >
        15
      </text>
    </svg>
  );
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number
) {
  ctx.font = "600 9px 'Geist Mono', ui-monospace, monospace";
  ctx.textBaseline = "alphabetic";
  const w = ctx.measureText(label).width;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(x - 3, y - 9, w + 6, 12);
  ctx.fillStyle = "#fafafa";
  ctx.fillText(label, x, y);
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  c: WireGroundPoint,
  scale: number
) {
  const color = TRANSECT_COLORS[c.transect];
  const r = Math.max(4, Math.min(12, 5 * Math.sqrt(scale)));
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#000";
  ctx.stroke();

  drawLabel(ctx, `${c.transect}${fmtDistance(c.distance)}`, x + r + 3, y - r);
}

const SPAN_TICK_HALF = 7;

// The span members of the Annotation union (everything that has endpoints).
type Span = Extract<Annotation, { u1: number }>;

// Span kind → label suffix. Keyed on the span kinds (a full Record), so a new
// span type must add its suffix here at compile time.
const SPAN_LABEL_SUFFIX: Record<Span["kind"], string> = {
  vertical_span: "V",
  horizontal_span: "H",
  flag_to_ground_span: "G",
};

// Human-readable name for each annotation kind, used in the collision-confirm
// message (e.g. "L3 vertical span already exists"). Keyed on the full kind union
// (a complete Record) so a new kind must declare its phrase here at compile time.
const KIND_NAME: Record<Annotation["kind"], string> = {
  wire_ground: "wire–ground point",
  vertical_span: "vertical span",
  horizontal_span: "horizontal span",
  flag_to_ground_span: "flag-to-ground span",
};

// Dash pattern for each span kind. Empty array = solid line. flag_to_ground
// renders dashed so it reads as distinct from a vertical span that may share
// its top endpoint. Keyed on span kinds (full Record) so new kinds declare
// their style here at compile time.
const SPAN_DASH_PX = 8;
const SPAN_GAP_PX = 5;
const SPAN_DASH: Record<Span["kind"], number[]> = {
  vertical_span: [],
  horizontal_span: [],
  flag_to_ground_span: [SPAN_DASH_PX, SPAN_GAP_PX],
};

// Draw a completed span as a tick-ended line in its transect color, labeled
// e.g. "L3·V". Coordinates x1/y1/x2/y2 are already in canvas (CSS) pixels.
function drawSpan(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  s: Span
) {
  const color = TRANSECT_COLORS[s.transect];
  // Unit vector along the span and its perpendicular (for end ticks).
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;

  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  // Apply kind-specific dash pattern (empty array = solid). Reset after the
  // main line so ticks and labels are always drawn solid.
  ctx.setLineDash(SPAN_DASH[s.kind]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Reset to solid before drawing end ticks and label so they stay crisp.
  ctx.setLineDash([]);

  // End ticks (perpendicular caps, always solid).
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1 - px * SPAN_TICK_HALF, y1 - py * SPAN_TICK_HALF);
  ctx.lineTo(x1 + px * SPAN_TICK_HALF, y1 + py * SPAN_TICK_HALF);
  ctx.moveTo(x2 - px * SPAN_TICK_HALF, y2 - py * SPAN_TICK_HALF);
  ctx.lineTo(x2 + px * SPAN_TICK_HALF, y2 + py * SPAN_TICK_HALF);
  ctx.stroke();

  drawLabel(
    ctx,
    `${s.transect}${fmtDistance(s.distance)}·${SPAN_LABEL_SUFFIX[s.kind]}`,
    x1 + 6,
    y1 - 4
  );
}

// Draw the live ghost line from a pending span's first endpoint to the cursor.
function drawGhostLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  transect: Transect
) {
  ctx.save();
  ctx.strokeStyle = TRANSECT_COLORS[transect];
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.7;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
  // small dot at the anchored first endpoint
  ctx.globalAlpha = 1;
  ctx.fillStyle = TRANSECT_COLORS[transect];
  ctx.beginPath();
  ctx.arc(x1, y1, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function App() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clicks, setClicks] = useState<Annotation[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [zoomRadius, setZoomRadius] = useState<number>(ZOOM_DEFAULT);

  // Main-image view transform: viewScale = multiplier on top of fit scale.
  // viewPanX/Y = pan offset in CSS pixels (independent of zoom level).
  const [viewScale, setViewScale] = useState<number>(1);
  const [viewPanX, setViewPanX] = useState<number>(0);
  const [viewPanY, setViewPanY] = useState<number>(0);
  const [spaceDown, setSpaceDown] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const panStateRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const suppressNextClickRef = useRef<boolean>(false);

  const [currentTransect, setCurrentTransect] = useState<Transect>("L");
  const [currentDistance, setCurrentDistance] = useState<number>(1);
  const [autoAdvance, setAutoAdvance] = useState<boolean>(true);

  // Active annotation type chosen via Q (wire–ground) / W (vertical span).
  const [activeType, setActiveType] = useState<ActiveAnnoType>("wire_ground");
  // Global pending-span state (sequential two-click placement across surfaces).
  const [pending, dispatchPending] = useReducer(pendingSpanReducer, PENDING_IDLE);

  // Pending duplicate-collision decision. Non-null = the confirm modal is open
  // and blocks other interaction until the labeler resolves it.
  const [pendingCollision, setPendingCollision] = useState<PendingCollision>(null);

  // Cancel = discard the candidate entirely: no append, no dirty change, no
  // auto-advance. Declared here (before the keyboard effect that references it)
  // so it's in scope for Escape-to-cancel. Replace / keep-both live further down,
  // alongside the commit helper they share.
  const resolveCollisionCancel = useCallback(() => {
    setPendingCollision(null);
  }, []);

  const [clicksDir, setClicksDir] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState<boolean>(false);

  const [folderDir, setFolderDir] = useState<string | null>(null);
  const [folderImages, setFolderImages] = useState<string[]>([]);
  const [imageCounts, setImageCounts] = useState<Record<string, Counts>>({});

  // Web-only (cloud): team-progress for the shared dataset (#16), keyed by image
  // id (the storage path, same string as `folderImages` entries). Populated from
  // the `annotations` summary columns on gallery (re)load and optimistically on
  // save. Empty on desktop, where progress comes from local `imageCounts` (L/C/R)
  // and there is no shared dataset.
  const [progressById, setProgressById] = useState<Record<string, ImageProgress>>({});

  // Web-only (cloud) state. `isAdmin` gates the upload affordance (RLS is the
  // real server-side gate); `showUpload` toggles the upload screen. Both are
  // inert on desktop (the effect that sets isAdmin early-returns on Tauri).
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  // Web-only (cloud) explorer state. `allSites` is the folder list shown in the
  // sidebar tree = the union of persisted (possibly-empty) sites and the sites
  // that have images, sorted. `collapsedSites` tracks which folders the user has
  // collapsed (default = expanded). The new-folder inline input and the
  // add-images upload status/result drive the create + ingest affordances. All
  // are inert on desktop, which keeps its flat single-folder list.
  const [allSites, setAllSites] = useState<string[]>([]);
  const [collapsedSites, setCollapsedSites] = useState<Set<string>>(new Set());
  const [newFolderOpen, setNewFolderOpen] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>("");
  const [newFolderError, setNewFolderError] = useState<string | null>(null);
  // The folder whose "Add images" modal is open (null = closed). Replaces the old
  // raw hidden-file-input flow with the richer drag-drop UploadModal.
  const [uploadModalSite, setUploadModalSite] = useState<string | null>(null);
  // Right-click context menu + delete-confirm popover + inline rename target, all
  // keyed by the row's {type, site, name}. `busy` flags an in-flight destructive
  // op so the confirm/rename UIs can disable themselves.
  type RowTarget = { type: "folder" | "image"; site: string; name: string };
  const [ctxMenu, setCtxMenu] = useState<(RowTarget & { x: number; y: number }) | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<(RowTarget & { x: number; y: number }) | null>(null);
  const [renameTarget, setRenameTarget] = useState<RowTarget | null>(null);
  const [rowBusy, setRowBusy] = useState<boolean>(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const newFolderInputRef = useRef<HTMLInputElement | null>(null);
  const newFolderSubmittingRef = useRef<boolean>(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // Web-only (cloud) soft edit lock (#17). Keyed on the active image's row
  // (site, image_name); the storage path (== image.path on web) drives the
  // Realtime subscription. The hook is an inert pass-through on desktop —
  // `canEdit` is constant true and no Supabase call ever runs (`isTauri()`
  // short-circuits every effect), so desktop annotation behavior is unchanged.
  // `image.path` on web is the storage_path the gallery rows are keyed on, and
  // siteFromPath/pathBasename mirror exactly how the backend derives the row
  // keys, so the (site, image_name) UPDATE keys round-trip correctly.
  const { status: lockStatusValue, heldBy: lockHeldBy, canEdit, forceUnlock } =
    useImageLock({
      imageId: image ? image.path : null,
      site: image ? siteFromPath(image.path) : null,
      imageName: image ? pathBasename(image.path) : null,
    });

  const [appVersion, setAppVersion] = useState<string>("");
  const [showHelp, setShowHelp] = useState<boolean>(false);

  // First-run onboarding. `firstRun` gates the in-flow placement hint shown over
  // the canvas; it starts false so returning users never flash it, and flips
  // true only once the store confirms this user has never placed an annotation.
  // `onboardedRef` guards the one-time persist (see markOnboarded).
  const [firstRun, setFirstRun] = useState<boolean>(false);
  const onboardedRef = useRef<boolean>(true);

  useEffect(() => {
    if (!isTauri()) return;
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Transparent canvas layered exactly over `canvasRef`, dedicated to the live
  // ghost line during span placement. Keeping the line here means the heavy main
  // canvas (full-res drawImage + every marker) is painted once and is NOT
  // re-stroked on every mousemove — only this lightweight overlay redraws.
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const zoomCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const storeRef = useRef<Store | null>(null);
  // The persistence seam. A stable instance (not in any effect dep array) whose
  // folder + clicks dir are kept in sync via setters wherever App sets that
  // state, so I/O routes through the backend without changing effect timing.
  // Platform-selected: desktop uses the filesystem backend, the web build uses
  // the Supabase backend. Both expose the same StorageBackend surface plus the
  // setFolder/setClicksDir setters App calls (no-ops on the web backend), so the
  // call sites below typecheck and run unchanged on either platform.
  const backendRef = useRef<TauriStorageBackend | SupabaseStorageBackend>(
    isTauri() ? new TauriStorageBackend() : new SupabaseStorageBackend(),
  );
  // Monotonic load token. `loadImage` resolves image URLs asynchronously on the
  // web (signed URLs), so a fast gallery click can start a second load before
  // the first's onload fires. Each call captures the current token; an onload
  // whose token is stale bails, so only the latest selection wins.
  const loadSeqRef = useRef(0);

  // Load persisted settings on mount
  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const s = await Store.load(SETTINGS_FILE);
        storeRef.current = s;
        const dir = await s.get<string>(SETTINGS_KEY_CLICKS_DIR);
        if (typeof dir === "string") setClicksDir(dir);
        // New users (no persisted flag) get the in-flow placement hint until
        // they place their first annotation; see markOnboarded.
        const done = await s.get<boolean>(SETTINGS_KEY_ONBOARDED);
        if (done !== true) {
          onboardedRef.current = false;
          setFirstRun(true);
        }
      } catch (e) {
        console.error("Failed to load settings", e);
      }
    })();
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const update = await check();
        if (!update) return;
        const accept = await ask(
          `FlagLabel ${update.version} is available (you have ${update.currentVersion}).\n\nDownload and install now? The app will restart.`,
          { title: "Update available", kind: "info", okLabel: "Install", cancelLabel: "Later" }
        );
        if (!accept) return;
        await update.downloadAndInstall();
        await relaunch();
      } catch (e) {
        console.log("[updater] check failed:", e);
      }
    })();
  }, []);

  // Web-only: load the shared-dataset gallery from the `annotations` rows.
  // Storage keys flow through `folderImages` exactly like local paths do on
  // desktop, so the existing sidebar + navigateToIndex + loadImage machinery
  // composes unchanged. No-op on desktop (folders come from the native dialog).
  const refreshGallery = useCallback(async () => {
    if (isTauri()) return;
    const backend = backendRef.current;
    if (!(backend instanceof SupabaseStorageBackend)) return;
    try {
      // One read pulls both the image list and the per-row progress summary
      // columns (#16) — recomputed every (re)load so another labeler's saves
      // surface on refresh, with no per-annotation querying.
      const items = await backend.listImagesWithProgress();
      setFolderImages(items.map((it) => it.id));
      const progress: Record<string, ImageProgress> = {};
      for (const it of items) {
        progress[it.id] = {
          site: it.site,
          status: it.status,
          annotation_count: it.annotation_count,
        };
      }
      setProgressById(progress);

      // Folders shown in the explorer tree = persisted (possibly-empty) sites ∪
      // the sites that already have images. A failed `listSites` (e.g. the table
      // not yet present) degrades to "just the sites with images" rather than
      // breaking the gallery.
      let persistedSites: string[] = [];
      try {
        persistedSites = await backend.listSites();
      } catch (e) {
        console.error("listSites failed", e);
      }
      const siteSet = new Set<string>(persistedSites);
      for (const it of items) siteSet.add(it.site);
      setAllSites(
        Array.from(siteSet).sort((a, b) => a.localeCompare(b)),
      );
    } catch (e) {
      console.error("Gallery load failed", e);
    }
  }, []);

  // Web-only: on mount (App only renders post-auth on the web), determine admin
  // status for the upload affordance and load the gallery. Desktop early-returns.
  useEffect(() => {
    if (isTauri()) return;
    fetchIsAdmin().then(setIsAdmin).catch(() => {});
    refreshGallery();
  }, [refreshGallery]);

  const loadImage = useCallback((path: string): Promise<void> => {
    setError(null);
    // URL acquisition is the ONLY platform difference here: the Tauri backend's
    // `resolveImageUrl` is synchronous (`convertFileSrc`), while the web backend
    // returns a Promise<signedUrl>. Resolving the URL via `Promise.resolve(...)`
    // keeps the desktop path effectively synchronous (it resolves in the same
    // microtask, no signed-URL round trip) while letting the web path await.
    // Everything after the URL is identical for both platforms.
    const backend = backendRef.current;
    const seq = ++loadSeqRef.current;
    const item = itemFromPath(path);
    return Promise.resolve(backend.resolveImageUrl(item)).then(
      (url) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            // Stale-load guard: a newer loadImage started while this URL was
            // being fetched/decoded — drop this result so the latest wins.
            if (seq !== loadSeqRef.current) {
              resolve();
              return;
            }
            imgRef.current = img;
            setClicks([]);
            setSelectedIdx(null);
            // Dismiss any open collision modal on EVERY image switch (native ⌘O/⌘⇧O,
            // folder open, in-app navigation all funnel through here). The candidate
            // + existingIndex are tied to the outgoing image's clicks array; leaving
            // the modal open would let Replace/Keep-both write the old image's
            // annotation into the new image. Discarding the candidate is the safe
            // resolution.
            setPendingCollision(null);
            setCursor(null);
            setCurrentDistance(1);
            setDirty(false);
            setLastSavedAt(null);
            setViewScale(1);
            setViewPanX(0);
            setViewPanY(0);
            setImage({
              path,
              url,
              width: img.naturalWidth,
              height: img.naturalHeight,
            });
            resolve();
          };
          img.onerror = () => {
            if (seq !== loadSeqRef.current) {
              resolve();
              return;
            }
            imgRef.current = null;
            setImage(null);
            setError(path);
            resolve();
          };
          img.src = url;
        }),
    ).catch((e) => {
      // A failed signed-URL fetch (web) surfaces as a load error, mirroring an
      // <img> onerror — but only if this is still the latest load.
      if (seq === loadSeqRef.current) {
        imgRef.current = null;
        setImage(null);
        setError(path);
      }
      console.error("loadImage failed", e);
    });
  }, []);

  const handleOpen = useCallback(async () => {
    if (!isTauri()) return; // native file dialog is desktop-only (web gallery: #14)
    if (dirty) {
      const proceed = await ask(
        `You have ${clicks.length} unsaved click${
          clicks.length === 1 ? "" : "s"
        }. Discard them?`,
        { title: "Discard unsaved changes?", kind: "warning" }
      );
      if (!proceed) return;
    }
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png"] }],
    });
    if (!selected || Array.isArray(selected)) return;
    setFolderDir(null);
    setFolderImages([]);
    await loadImage(selected);
  }, [dirty, clicks.length, loadImage]);

  const handleOpenFolder = useCallback(async () => {
    if (!isTauri()) return; // native folder dialog is desktop-only (web gallery: #14)
    if (dirty) {
      const proceed = await ask(
        `You have ${clicks.length} unsaved click${
          clicks.length === 1 ? "" : "s"
        }. Discard them?`,
        { title: "Discard unsaved changes?", kind: "warning" }
      );
      if (!proceed) return;
    }
    const selected = await open({
      multiple: false,
      directory: true,
      title: "Pick a folder of images",
    });
    if (!selected || Array.isArray(selected)) return;
    try {
      backendRef.current.setFolder(selected);
      const items = await backendRef.current.listImages();
      const images = items.map((it) => it.id);
      if (images.length === 0) {
        setError(`No JPG/PNG files in ${selected}`);
        setFolderDir(null);
        setFolderImages([]);
        return;
      }
      setFolderDir(selected);
      setFolderImages(images);
      await loadImage(images[0]);
    } catch (e) {
      console.error("Folder open failed", e);
    }
  }, [dirty, clicks.length, loadImage]);

  // Scan all JSONs in the clicks dir for the current folder's images
  useEffect(() => {
    if (!clicksDir || folderImages.length === 0) {
      setImageCounts({});
      return;
    }
    let cancelled = false;
    backendRef.current.setClicksDir(clicksDir);
    (async () => {
      const result: Record<string, Counts> = {};
      for (const path of folderImages) {
        if (cancelled) return;
        try {
          const file = await backendRef.current.readAnnotationFile(itemFromPath(path));
          if (!file) continue;
          result[path] = countsByTransect(parseAnnotationFile(file));
        } catch (e) {
          console.error("Failed to read", clickJsonPathFor(path, clicksDir), e);
        }
      }
      if (!cancelled) setImageCounts(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [clicksDir, folderImages]);

  // Auto-load matching JSON when image + clicksDir are known
  useEffect(() => {
    if (!image) return;
    // Desktop needs a chosen clicks dir to know where JSONs live; the web
    // backend keys annotations on (site, image_name) and ignores clicksDir, so
    // the gate is desktop-only — on web we load as soon as an image is selected.
    if (isTauri() && !clicksDir) return;
    let cancelled = false;
    backendRef.current.setClicksDir(clicksDir);
    (async () => {
      try {
        const file = await backendRef.current.readAnnotationFile(itemFromPath(image.path));
        if (cancelled || !file) return;
        const anns = parseAnnotationFile(file);
        setClicks(anns);
        setDirty(false);
        setLastSavedAt(Date.now());
      } catch (e) {
        console.error("Auto-load failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [image, clicksDir]);

  const handleSave = useCallback(async () => {
    if (!image) return;
    if (clicks.length === 0 && !dirty) return;
    // Web (cloud) save path: there is no local clicks dir or folder picker —
    // annotations persist to Supabase keyed by (site, image_name). Build the same
    // schema-v2 file the desktop branch builds and write it via the backend, then
    // mirror the desktop bookkeeping (lastSavedAt / dirty / imageCounts). The
    // desktop block below is left byte-identical.
    if (!isTauri()) {
      // Soft-lock guard (#17): never write the blob while another labeler holds
      // a live lock. `canEdit` already blocks the mutations that set `dirty`, so
      // this only matters in the narrow window where the lock was lost (admin
      // force-unlock + reclaim) between an edit and the auto-save firing — last-
      // write-wins makes that write a clobber, so we drop it.
      if (!canEdit) return;
      const meta: FileMeta = {
        site: siteFromPath(image.path),
        image: pathBasename(image.path),
        image_w: image.width,
        image_h: image.height,
      };
      const data = buildAnnotationFile(meta, clicks, appVersion, new Date().toISOString());
      try {
        await backendRef.current.writeAnnotationFile(itemFromPath(image.path), data);
        setLastSavedAt(Date.now());
        setDirty(false);
        setImageCounts((prev) => ({
          ...prev,
          [image.path]: countsByTransect(clicks),
        }));
        // Optimistically reflect this save in the team-progress map so the row's
        // annotated state and the per-site/overall tallies update without a full
        // refresh. Derived the same way the server columns are (deriveSummary),
        // so the optimistic value matches the next refresh exactly.
        const summary = deriveSummary(data, "");
        setProgressById((prev) => ({
          ...prev,
          [image.path]: {
            site: siteFromPath(image.path),
            status: summary.status,
            annotation_count: summary.annotation_count,
          },
        }));
      } catch (e) {
        console.error("Save failed", e);
      }
      return;
    }
    let dir = clicksDir;
    if (!dir) {
      // Picking a save folder uses the native dialog (desktop-only). On web there
      // is no local clicks dir — annotations persist to Supabase via the backend.
      if (!isTauri()) return;
      const selected = await open({
        multiple: false,
        directory: true,
        defaultPath: pathParent(pathParent(image.path)),
        title: "Pick a folder to save click JSONs",
      });
      if (!selected || Array.isArray(selected)) return;
      dir = selected;
      setClicksDir(dir);
      if (storeRef.current) {
        await storeRef.current.set(SETTINGS_KEY_CLICKS_DIR, dir);
        await storeRef.current.save();
      }
    }
    const meta: FileMeta = {
      site: siteFromPath(image.path),
      image: pathBasename(image.path),
      image_w: image.width,
      image_h: image.height,
    };
    const data = buildAnnotationFile(meta, clicks, appVersion, new Date().toISOString());
    backendRef.current.setClicksDir(dir);
    try {
      await backendRef.current.writeAnnotationFile(itemFromPath(image.path), data);
      setLastSavedAt(Date.now());
      setDirty(false);
      setImageCounts((prev) => ({
        ...prev,
        [image.path]: countsByTransect(clicks),
      }));
    } catch (e) {
      console.error("Save failed", e);
    }
  }, [image, clicks, clicksDir, appVersion, dirty, canEdit]);

  // ─── Web-only export (#18) ──────────────────────────────────────────────────
  // The desktop app writes JSON straight to local disk, so export is web-only.
  // Output bytes are byte-identical to desktop via the shared `src/cloud/export`
  // pure builder. Both handlers are no-ops on Tauri (the UI is `!isTauri()`-gated
  // too) and are wrapped in browser-only Blob/anchor IO that desktop never hits.

  // Trigger a browser download of `blob` named `filename` via a temporary anchor.
  const triggerDownload = useCallback((filename: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick so the click has been dispatched.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, []);

  // Download the CURRENT image's annotation JSON as `<site>__<stem>.json`.
  // Prefer the persisted blob (so the download matches exactly what's stored);
  // fall back to building from the in-memory clicks if the row has no data yet.
  const handleDownloadCurrent = useCallback(async () => {
    if (isTauri() || !image) return;
    try {
      const item = itemFromPath(image.path);
      const stored = await backendRef.current.readAnnotationFile(item);
      const file = stored
        ? canonicalizeAnnotationFile(stored)
        : buildAnnotationFile(
            {
              site: siteFromPath(image.path),
              image: pathBasename(image.path),
              image_w: image.width,
              image_h: image.height,
            },
            clicks,
            appVersion,
            new Date().toISOString(),
          );
      triggerDownload(
        exportEntryName(file),
        new Blob([serializeAnnotationFile(file)], { type: "application/json" }),
      );
    } catch (e) {
      console.error("Download failed", e);
    }
  }, [image, clicks, appVersion, triggerDownload]);

  // Admin-only: download the WHOLE dataset's annotations as one ZIP of per-image
  // JSON files. Fetches every row with non-null `data`, builds canonical entries,
  // and zips them. JSZip is imported dynamically so it stays out of the desktop
  // chunk and only loads when an admin actually exports.
  const handleDownloadAll = useCallback(async () => {
    if (isTauri()) return;
    const backend = backendRef.current;
    if (!(backend instanceof SupabaseStorageBackend)) return;
    try {
      const files = await backend.listAnnotationFiles();
      const entries = buildZipEntries(files);
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (const entry of entries) zip.file(entry.name, entry.content);
      const blob = await zip.generateAsync({ type: "blob" });
      triggerDownload("flaglabel-annotations.zip", blob);
    } catch (e) {
      console.error("Bulk export failed", e);
    }
  }, [triggerDownload]);

  const navigateBy = useCallback(
    async (delta: number) => {
      if (folderImages.length === 0 || !image) return;
      const curr = folderImages.indexOf(image.path);
      if (curr < 0) return;
      const target = curr + delta;
      if (target < 0 || target >= folderImages.length) return;
      if (dirty) await handleSave();
      await loadImage(folderImages[target]);
    },
    [folderImages, image, dirty, handleSave, loadImage]
  );

  const navigateToIndex = useCallback(
    async (idx: number) => {
      if (idx < 0 || idx >= folderImages.length) return;
      if (image && folderImages[idx] === image.path) return;
      if (dirty) await handleSave();
      await loadImage(folderImages[idx]);
    },
    [folderImages, image, dirty, handleSave, loadImage]
  );

  // ---- Web explorer: folder grouping + create + add-images ----

  // Images grouped under their site, each carrying its index into the flat
  // `folderImages` spine so a tree row still drives `navigateToIndex` (which
  // keeps arrow-key nav, save-on-navigate, and active tracking working). Web
  // only; desktop renders the flat list and never reads this.
  const imagesBySite = useMemo(() => {
    const m = new Map<string, { path: string; idx: number }[]>();
    folderImages.forEach((path, idx) => {
      const s = siteFromPath(path);
      const arr = m.get(s);
      if (arr) arr.push({ path, idx });
      else m.set(s, [{ path, idx }]);
    });
    return m;
  }, [folderImages]);

  const toggleSite = useCallback((site: string) => {
    setCollapsedSites((prev) => {
      const next = new Set(prev);
      if (next.has(site)) next.delete(site);
      else next.add(site);
      return next;
    });
  }, []);

  const expandSite = useCallback((site: string) => {
    setCollapsedSites((prev) => {
      if (!prev.has(site)) return prev;
      const next = new Set(prev);
      next.delete(site);
      return next;
    });
  }, []);

  // Keep the active image's folder open so arrow-key navigation never lands on a
  // hidden image. Web-only; desktop has a single flat folder.
  useEffect(() => {
    if (isTauri() || !image) return;
    expandSite(siteFromPath(image.path));
  }, [image, expandSite]);

  // Dismiss the context menu on any outside click, Esc, or scroll.
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  // Focus + preselect the inline rename input when it opens.
  useEffect(() => {
    if (!renameTarget) return;
    requestAnimationFrame(() => {
      const el = renameInputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    });
  }, [renameTarget]);

  const openNewFolder = useCallback(() => {
    setNewFolderError(null);
    setNewFolderName("");
    setNewFolderOpen(true);
    // Focus after the input mounts.
    requestAnimationFrame(() => newFolderInputRef.current?.focus());
  }, []);

  const closeNewFolder = useCallback(() => {
    setNewFolderOpen(false);
    setNewFolderName("");
    setNewFolderError(null);
  }, []);

  // VS Code-style inline create: Enter (or blur with a name) commits, Esc/blur-
  // while-empty cancels. The ref guards against the success path's unmount→blur
  // firing a second submit mid-await.
  const submitNewFolder = useCallback(async () => {
    if (newFolderSubmittingRef.current) return;
    const backend = backendRef.current;
    if (!(backend instanceof SupabaseStorageBackend)) return;
    const res = validateSiteName(newFolderName);
    if (!res.ok) {
      setNewFolderError(res.reason);
      return;
    }
    if (allSites.includes(res.name)) {
      setNewFolderError("A folder with that name already exists.");
      return;
    }
    newFolderSubmittingRef.current = true;
    try {
      await backend.createSite(res.name);
      closeNewFolder();
      await refreshGallery();
      expandSite(res.name);
    } catch (e) {
      setNewFolderError(e instanceof Error ? e.message : String(e));
    } finally {
      newFolderSubmittingRef.current = false;
    }
  }, [newFolderName, allSites, refreshGallery, expandSite, closeNewFolder]);

  const onNewFolderBlur = useCallback(() => {
    if (newFolderSubmittingRef.current) return;
    if (newFolderName.trim()) submitNewFolder();
    else closeNewFolder();
  }, [newFolderName, submitNewFolder, closeNewFolder]);

  // The "+" / "Add images" affordance opens the drag-drop UploadModal for a site.
  // Kick a gallery refresh so the modal's duplicate detection reflects current DB
  // state, not a possibly-stale folderImages (e.g. right after a delete+recreate
  // of the same folder name). The modal opens instantly; `existingNames` updates
  // reactively when the refresh resolves.
  const triggerAddImages = useCallback(
    (site: string) => {
      setUploadModalSite(site);
      void refreshGallery();
    },
    [refreshGallery],
  );

  // Tear down the active image without saving: nulls it (which releases the edit
  // lock via the useImageLock cleanup keyed on imageId) and clears the dirty flag
  // (which cancels the pending 5s autosave). Used when the active image — or the
  // folder containing it — is about to be deleted or renamed out from under us.
  const clearActiveImage = useCallback(() => {
    setImage(null);
    setClicks([]);
    setSelectedIdx(null);
    setDirty(false);
    dispatchPending({ type: "cancel" });
  }, []);

  // Right-click a folder/image row → context menu at the cursor.
  const openRowMenu = useCallback(
    (e: React.MouseEvent, target: RowTarget) => {
      e.preventDefault();
      e.stopPropagation();
      setRowError(null);
      setDeleteTarget(null);
      setCtxMenu({ ...target, x: e.clientX, y: e.clientY });
    },
    [],
  );

  const handleDeleteConfirmed = useCallback(async () => {
    const t = deleteTarget;
    const backend = backendRef.current;
    if (!t || !(backend instanceof SupabaseStorageBackend)) return;
    setRowBusy(true);
    setRowError(null);
    try {
      // If the active image is being removed (directly, or via its folder), tear
      // it down first so no autosave fires against a row that's about to vanish.
      const activeSite = image ? siteFromPath(image.path) : null;
      const activeAffected =
        t.type === "image"
          ? image?.path === `${t.site}/${t.name}`
          : activeSite === t.site;
      if (activeAffected) clearActiveImage();
      if (t.type === "image") await backend.deleteImage(t.site, t.name);
      else await backend.deleteSite(t.site);
      setDeleteTarget(null);
      await refreshGallery();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : String(err));
    } finally {
      setRowBusy(false);
    }
  }, [deleteTarget, image, clearActiveImage, refreshGallery]);

  // Inline rename (folder or image). The visible text becomes an input; Enter
  // commits, Esc cancels. For an image only the stem is editable (extension is
  // preserved); for a folder the whole name. If the active image is involved we
  // save it first (so edits land on the OLD key) then tear it down, since its
  // storage path / row key changes underneath.
  const submitRename = useCallback(
    async (rawValue: string) => {
      const t = renameTarget;
      const backend = backendRef.current;
      if (!t || !(backend instanceof SupabaseStorageBackend)) return;

      let newName: string;
      if (t.type === "folder") {
        const res = validateSiteName(rawValue);
        if (!res.ok) {
          setRowError(res.reason);
          return;
        }
        if (res.name === t.name) {
          setRenameTarget(null);
          return;
        }
        if (allSites.includes(res.name)) {
          setRowError("A folder with that name already exists.");
          return;
        }
        newName = res.name;
      } else {
        const res = validateStem(rawValue);
        if (!res.ok) {
          setRowError(res.reason);
          return;
        }
        newName = renameImageName(t.name, res.stem);
        if (newName === t.name) {
          setRenameTarget(null);
          return;
        }
        const siblings = (imagesBySite.get(t.site) ?? []).map((x) =>
          pathBasename(x.path),
        );
        if (siblings.includes(newName)) {
          setRowError("An image with that name already exists in this folder.");
          return;
        }
      }

      setRowBusy(true);
      setRowError(null);
      try {
        const activeSite = image ? siteFromPath(image.path) : null;
        const activeAffected =
          t.type === "image"
            ? image?.path === `${t.site}/${t.name}`
            : activeSite === t.site;
        // Persist any in-flight edits on the OLD key before the move, then drop
        // the active image (its path/key is changing).
        if (activeAffected) {
          if (dirty) await handleSave();
          clearActiveImage();
        }
        if (t.type === "folder") await backend.renameSite(t.name, newName);
        else await backend.renameImage(t.site, t.name, newName);
        setRenameTarget(null);
        await refreshGallery();
        if (t.type === "folder") expandSite(newName);
      } catch (err) {
        setRowError(err instanceof Error ? err.message : String(err));
      } finally {
        setRowBusy(false);
      }
    },
    [
      renameTarget,
      allSites,
      imagesBySite,
      image,
      dirty,
      handleSave,
      clearActiveImage,
      refreshGallery,
      expandSite,
    ],
  );

  const menuHandlersRef = useRef({
    handleOpen,
    handleOpenFolder,
    handleSave,
    showHelpModal: () => setShowHelp(true),
  });
  useEffect(() => {
    menuHandlersRef.current = {
      handleOpen,
      handleOpenFolder,
      handleSave,
      showHelpModal: () => setShowHelp(true),
    };
  }, [handleOpen, handleOpenFolder, handleSave]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      try {
        const sep = await PredefinedMenuItem.new({ item: "Separator" });
        const aboutItem = await PredefinedMenuItem.new({
          item: { About: { name: "FlagLabel" } },
        });
        const hideItem = await PredefinedMenuItem.new({ item: "Hide" });
        const hideOthersItem = await PredefinedMenuItem.new({
          item: "HideOthers",
        });
        const showAllItem = await PredefinedMenuItem.new({ item: "ShowAll" });
        const quitItem = await PredefinedMenuItem.new({ item: "Quit" });
        const cutItem = await PredefinedMenuItem.new({ item: "Cut" });
        const copyItem = await PredefinedMenuItem.new({ item: "Copy" });
        const pasteItem = await PredefinedMenuItem.new({ item: "Paste" });
        const selectAllItem = await PredefinedMenuItem.new({
          item: "SelectAll",
        });
        const minimizeItem = await PredefinedMenuItem.new({ item: "Minimize" });
        const closeWindowItem = await PredefinedMenuItem.new({
          item: "CloseWindow",
        });

        const openImageItem = await MenuItem.new({
          id: "open-image",
          text: "Open Image…",
          accelerator: "CmdOrCtrl+O",
          action: () => menuHandlersRef.current.handleOpen(),
        });
        const openFolderItem = await MenuItem.new({
          id: "open-folder",
          text: "Open Folder…",
          accelerator: "CmdOrCtrl+Shift+O",
          action: () => menuHandlersRef.current.handleOpenFolder(),
        });
        const saveItem = await MenuItem.new({
          id: "save",
          text: "Save",
          accelerator: "CmdOrCtrl+S",
          action: () => menuHandlersRef.current.handleSave(),
        });
        const helpItem = await MenuItem.new({
          id: "help-shortcuts",
          text: "Keyboard Shortcuts",
          accelerator: "CmdOrCtrl+/",
          action: () => menuHandlersRef.current.showHelpModal(),
        });

        const appSubmenu = await Submenu.new({
          text: "FlagLabel",
          items: [
            aboutItem,
            sep,
            hideItem,
            hideOthersItem,
            showAllItem,
            sep,
            quitItem,
          ],
        });
        const fileSubmenu = await Submenu.new({
          text: "File",
          items: [openImageItem, openFolderItem, sep, saveItem],
        });
        const editSubmenu = await Submenu.new({
          text: "Edit",
          items: [cutItem, copyItem, pasteItem, selectAllItem],
        });
        const windowSubmenu = await Submenu.new({
          text: "Window",
          items: [minimizeItem, closeWindowItem],
        });
        const helpSubmenu = await Submenu.new({
          text: "Help",
          items: [helpItem],
        });

        const menu = await Menu.new({
          items: [
            appSubmenu,
            fileSubmenu,
            editSubmenu,
            windowSubmenu,
            helpSubmenu,
          ],
        });
        if (cancelled) return;
        await menu.setAsAppMenu();
      } catch (e) {
        console.error("Menu setup failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Cancel a half-placed span when the user switches image, active type,
  // transect, or distance. Deliberately NOT keyed on viewScale/pan/cursor so
  // panning or zooming mid-placement leaves the pending span intact.
  useEffect(() => {
    dispatchPending({ type: "cancel" });
  }, [activeType, currentTransect, currentDistance, image]);

  // F4: auto-save 5s after the last change. The dirty flag is the trigger (never
  // gate on clicks.length — clearing a previously-saved image is a legitimate
  // save). Desktop needs a chosen clicks dir to know where to write; the web
  // backend keys on (site, image_name) and ignores clicksDir, so the dir gate is
  // desktop-only — mirroring the auto-load effect.
  useEffect(() => {
    if (!dirty || !image) return;
    if (isTauri() && !clicksDir) return;
    const id = setTimeout(() => {
      handleSave();
    }, 5000);
    return () => clearTimeout(id);
  }, [dirty, clicks, image, clicksDir, handleSave]);

  const handleUndo = useCallback(() => {
    if (!canEdit) return; // web: blocked while another labeler holds the lock
    setClicks((prev) => {
      if (prev.length === 0) return prev;
      return prev.slice(0, -1);
    });
    setSelectedIdx(null);
    setDirty(true);
  }, [canEdit]);

  const handleClear = useCallback(async () => {
    if (!canEdit) return; // web: blocked while another labeler holds the lock
    if (clicks.length === 0) return;
    const message = `Clear all ${clicks.length} click${
      clicks.length === 1 ? "" : "s"
    } for this image?`;
    const ok = isTauri()
      ? await ask(message, { title: "Clear clicks", kind: "warning" })
      : window.confirm(message);
    if (ok) {
      setClicks([]);
      setSelectedIdx(null);
      setDirty(true);
    }
  }, [clicks.length, canEdit]);

  const deleteSelected = useCallback(() => {
    if (!canEdit) return; // web: blocked while another labeler holds the lock
    if (selectedIdx === null) return;
    setClicks((prev) => prev.filter((_, i) => i !== selectedIdx));
    setSelectedIdx(null);
    setDirty(true);
  }, [selectedIdx, canEdit]);

  const retagSelected = useCallback(
    (t: Transect) => {
      if (!canEdit) return; // web: blocked while another labeler holds the lock
      if (selectedIdx === null) return;
      setClicks((prev) =>
        prev.map((c, i) => (i === selectedIdx ? { ...c, transect: t } : c))
      );
      setDirty(true);
    },
    [selectedIdx, canEdit]
  );

  const adjustSelectedDistance = useCallback(
    (delta: number) => {
      if (!canEdit) return; // web: blocked while another labeler holds the lock
      if (selectedIdx === null) return;
      setClicks((prev) =>
        prev.map((c, i) => {
          if (i !== selectedIdx) return c;
          const nd = Math.max(
            0,
            Math.min(99.9, +(c.distance + delta).toFixed(1))
          );
          return { ...c, distance: nd };
        })
      );
      setDirty(true);
    },
    [selectedIdx, canEdit]
  );

  const resetView = useCallback(() => {
    setViewScale(1);
    setViewPanX(0);
    setViewPanY(0);
  }, []);

  const zoomByFactor = useCallback(
    (factor: number) => {
      if (!image || !containerRef.current) return;
      const cw = containerRef.current.clientWidth;
      const ch = containerRef.current.clientHeight;
      const newScale = Math.max(
        VIEW_SCALE_MIN,
        Math.min(VIEW_SCALE_MAX, viewScale * factor)
      );
      if (newScale === viewScale) return;

      const before = computeViewParams(
        image.width,
        image.height,
        viewScale,
        viewPanX,
        viewPanY,
        cw,
        ch
      );
      const after = computeViewParams(
        image.width,
        image.height,
        newScale,
        0,
        0,
        cw,
        ch
      );

      // Anchor zoom at the last known cursor position, fall back to center.
      let cssX: number;
      let cssY: number;
      let imgU: number;
      let imgV: number;
      if (cursor) {
        imgU = cursor.u;
        imgV = cursor.v;
        cssX = before.offsetX + imgU * before.effScale;
        cssY = before.offsetY + imgV * before.effScale;
      } else {
        cssX = cw / 2;
        cssY = ch / 2;
        imgU = (cssX - before.offsetX) / before.effScale;
        imgV = (cssY - before.offsetY) / before.effScale;
      }

      const newPanX = cssX - (cw - after.drawW) / 2 - imgU * after.effScale;
      const newPanY = cssY - (ch - after.drawH) / 2 - imgV * after.effScale;

      setViewScale(newScale);
      setViewPanX(clampPan(newPanX, after.drawW, cw));
      setViewPanY(clampPan(newPanY, after.drawH, ch));
    },
    [image, viewScale, viewPanX, viewPanY, cursor]
  );

  useEffect(() => {
    function endPanState() {
      setSpaceDown(false);
      setIsDragging(false);
      panStateRef.current = null;
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === "Space") {
        // Ending pan on Space release: keep suppressNextClickRef as-is so an
        // in-flight mouseup still suppresses the click.
        endPanState();
      }
    }
    function onBlur() {
      // Window lost focus (alt-tab, system dialog) — clear everything,
      // including the click-suppress flag.
      endPanState();
      suppressNextClickRef.current = false;
    }
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const inInput = e.target instanceof HTMLInputElement;
      const cmd = e.metaKey || e.ctrlKey;

      // The collision-confirm modal is fully modal: swallow ALL keys (including
      // Space-pan, type switches, distance steps, undo, delete) while it's open.
      // Escape resolves it as Cancel.
      if (pendingCollision) {
        if (e.key === "Escape") {
          e.preventDefault();
          resolveCollisionCancel();
        }
        return;
      }

      // Track Space for pan-mode (when not in an input). Prevent default so
      // browser doesn't scroll the page on space.
      if (e.code === "Space" && !inInput) {
        e.preventDefault();
        setSpaceDown(true);
        return;
      }

      // ⌘O / ⌘⇧O / ⌘S are bound by the native menu accelerators.
      // ⌘Z stays here because it must skip text inputs (browser undo).
      if (e.key === "Escape") {
        if (showHelp) {
          e.preventDefault();
          setShowHelp(false);
          return;
        }
        // An in-progress span placement is the most "active" thing — cancel it
        // before falling through to deselect.
        if (pending.kind !== "idle") {
          e.preventDefault();
          dispatchPending({ type: "cancel" });
          return;
        }
        if (selectedIdx !== null) {
          e.preventDefault();
          setSelectedIdx(null);
          return;
        }
      }

      if (inInput) return;

      if (e.key === "?") {
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }
      if (cmd && e.key === "/") {
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }

      if (
        selectedIdx !== null &&
        (e.key === "Delete" || e.key === "Backspace")
      ) {
        e.preventDefault();
        deleteSelected();
        return;
      }

      if (cmd && e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleUndo();
      } else if (e.key === "ArrowLeft" && folderImages.length > 0) {
        e.preventDefault();
        navigateBy(-1);
      } else if (e.key === "ArrowRight" && folderImages.length > 0) {
        e.preventDefault();
        navigateBy(1);
      } else if (e.key === "1") {
        e.preventDefault();
        if (selectedIdx !== null) retagSelected("L");
        else setCurrentTransect("L");
      } else if (e.key === "2") {
        e.preventDefault();
        if (selectedIdx !== null) retagSelected("C");
        else setCurrentTransect("C");
      } else if (e.key === "3") {
        e.preventDefault();
        if (selectedIdx !== null) retagSelected("R");
        else setCurrentTransect("R");
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.shiftKey ? 0.5 : 1;
        if (selectedIdx !== null) adjustSelectedDistance(step);
        else setCurrentDistance((d) => Math.min(99.9, +(d + step).toFixed(1)));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const step = e.shiftKey ? 0.5 : 1;
        if (selectedIdx !== null) adjustSelectedDistance(-step);
        else setCurrentDistance((d) => Math.max(0, +(d - step).toFixed(1)));
      } else if (e.key.toLowerCase() === "a" && !cmd) {
        e.preventDefault();
        setAutoAdvance((a) => !a);
      } else if (e.key.toLowerCase() === "q" && !cmd) {
        e.preventDefault();
        setActiveType("wire_ground");
      } else if (e.key.toLowerCase() === "w" && !cmd) {
        e.preventDefault();
        setActiveType("vertical_span");
      } else if (e.key.toLowerCase() === "e" && !cmd) {
        e.preventDefault();
        setActiveType("horizontal_span");
      } else if (e.key.toLowerCase() === "r" && !cmd) {
        e.preventDefault();
        setActiveType("flag_to_ground_span");
      } else if (e.key === "[") {
        e.preventDefault();
        setZoomRadius((r) => Math.max(ZOOM_MIN, r - 5));
      } else if (e.key === "]") {
        e.preventDefault();
        setZoomRadius((r) => Math.min(ZOOM_MAX, r + 5));
      } else if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomByFactor(1.25);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomByFactor(1 / 1.25);
      } else if (e.key === "0") {
        e.preventDefault();
        resetView();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    handleUndo,
    navigateBy,
    folderImages.length,
    showHelp,
    selectedIdx,
    pending,
    deleteSelected,
    retagSelected,
    adjustSelectedDistance,
    zoomByFactor,
    resetView,
    pendingCollision,
    resolveCollisionCancel,
  ]);

  // Main canvas
  useEffect(() => {
    if (!image || !imgRef.current || !canvasRef.current || !containerRef.current) {
      return;
    }
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const img = imgRef.current;

    function draw() {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (cw === 0 || ch === 0) return;
      const dpr = window.devicePixelRatio || 1;

      const { effScale, drawW, drawH, offsetX, offsetY } = computeViewParams(
        image!.width,
        image!.height,
        viewScale,
        viewPanX,
        viewPanY,
        cw,
        ch
      );

      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

      for (const c of clicks) {
        if (c.kind === "wire_ground") {
          drawMarker(ctx, offsetX + c.u * effScale, offsetY + c.v * effScale, c, viewScale);
        } else {
          drawSpan(
            ctx,
            offsetX + c.u1 * effScale,
            offsetY + c.v1 * effScale,
            offsetX + c.u2 * effScale,
            offsetY + c.v2 * effScale,
            c
          );
        }
      }

      const sc = selectedIdx !== null ? clicks[selectedIdx] : undefined;
      if (sc) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        if (sc.kind === "wire_ground") {
          ctx.beginPath();
          ctx.arc(offsetX + sc.u * effScale, offsetY + sc.v * effScale, 10 + 2 * viewScale, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          const ring = 8 + 2 * viewScale;
          for (const [pu, pv] of [
            [sc.u1, sc.v1],
            [sc.u2, sc.v2],
          ]) {
            ctx.beginPath();
            ctx.arc(offsetX + pu * effScale, offsetY + pv * effScale, ring, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
    }

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
    // The live ghost line lives on a separate overlay canvas (effect below), so
    // this heavy draw is deliberately NOT keyed on the cursor/pending — it only
    // re-runs when the image, committed annotations, selection, or view changes.
  }, [image, clicks, selectedIdx, viewScale, viewPanX, viewPanY]);

  // Ghost-line overlay. Transparent canvas stacked exactly over the main one,
  // redrawn on every mousemove while a span awaits its second click. Uses the
  // identical dpr / transform / computeViewParams as the main canvas so the line
  // lands in the same coordinate space. Keyed on `pending` (not just `cursor`)
  // so cancelling (Esc) or committing with a stationary mouse still clears it.
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    const container = containerRef.current;
    if (!image || !canvas || !container) return;

    function draw() {
      const cw = container!.clientWidth;
      const ch = container!.clientHeight;
      if (cw === 0 || ch === 0) return;
      const dpr = window.devicePixelRatio || 1;

      const w = Math.round(cw * dpr);
      const h = Math.round(ch * dpr);
      // Setting width/height reallocates + clears the backing store; only do it
      // when the size actually changed, otherwise just clear.
      if (canvas!.width !== w || canvas!.height !== h) {
        canvas!.width = w;
        canvas!.height = h;
        canvas!.style.width = `${cw}px`;
        canvas!.style.height = `${ch}px`;
      }
      const ctx = canvas!.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      if (pending.kind !== "awaitingSecond" || !cursor) return;
      const { effScale, offsetX, offsetY } = computeViewParams(
        image!.width,
        image!.height,
        viewScale,
        viewPanX,
        viewPanY,
        cw,
        ch
      );
      drawGhostLine(
        ctx,
        offsetX + pending.first.u * effScale,
        offsetY + pending.first.v * effScale,
        offsetX + cursor.u * effScale,
        offsetY + cursor.v * effScale,
        pending.transect
      );
    }

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
  }, [image, pending, cursor, viewScale, viewPanX, viewPanY]);

  // Zoom panel
  useEffect(() => {
    if (!image || !imgRef.current || !zoomCanvasRef.current || !cursor) return;
    const canvas = zoomCanvasRef.current;
    const img = imgRef.current;
    const dpr = window.devicePixelRatio || 1;
    const cssW = ZOOM_PANEL_PX;
    const cssH = ZOOM_PANEL_PX;

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const r = zoomRadius;
    // No clamp on cursor: when near an edge, the panel pans past the image
    // so the crosshair always tracks the actual cursor position. We render
    // the in-bounds portion of the source at correct scale and leave the
    // off-image area black (so the user can see which area is non-clickable).
    const sx = cursor.u - r;
    const sy = cursor.v - r;
    const sw = 2 * r;
    const sh = 2 * r;
    const zoomScale = cssW / sw;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cssW, cssH);

    // Clip source to image bounds; compute the proportional destination
    // rect so the image draws at the correct zoom (WebKit's drawImage
    // would otherwise stretch the clipped source across the full panel).
    const clippedSx = Math.max(0, sx);
    const clippedSy = Math.max(0, sy);
    const clippedSw = Math.min(image.width, sx + sw) - clippedSx;
    const clippedSh = Math.min(image.height, sy + sh) - clippedSy;
    if (clippedSw > 0 && clippedSh > 0) {
      const dx = (clippedSx - sx) * zoomScale;
      const dy = (clippedSy - sy) * zoomScale;
      const dw = clippedSw * zoomScale;
      const dh = clippedSh * zoomScale;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(
        img,
        clippedSx,
        clippedSy,
        clippedSw,
        clippedSh,
        dx,
        dy,
        dw,
        dh
      );
    }

    const inWindow = (u: number, v: number) =>
      u >= sx && u <= sx + sw && v >= sy && v <= sy + sh;
    const toX = (u: number) => (u - sx) * zoomScale;
    const toY = (v: number) => (v - sy) * zoomScale;

    for (const c of clicks) {
      if (c.kind === "wire_ground") {
        if (!inWindow(c.u, c.v)) continue;
        drawMarker(ctx, toX(c.u), toY(c.v), c, zoomScale);
      } else {
        // Draw the span if its bounding box intersects the panel window — not
        // just if an endpoint is inside it. A long span (e.g. flag-to-ground)
        // can pass straight through the window with BOTH endpoints outside;
        // the canvas clips the off-panel portion of the line.
        const minU = Math.min(c.u1, c.u2);
        const maxU = Math.max(c.u1, c.u2);
        const minV = Math.min(c.v1, c.v2);
        const maxV = Math.max(c.v1, c.v2);
        if (maxU < sx || minU > sx + sw || maxV < sy || minV > sy + sh) continue;
        drawSpan(ctx, toX(c.u1), toY(c.v1), toX(c.u2), toY(c.v2), c);
      }
    }

    const sc = selectedIdx !== null ? clicks[selectedIdx] : undefined;
    if (sc) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      if (sc.kind === "wire_ground") {
        if (inWindow(sc.u, sc.v)) {
          ctx.beginPath();
          ctx.arc(toX(sc.u), toY(sc.v), 14, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        for (const [pu, pv] of [
          [sc.u1, sc.v1],
          [sc.u2, sc.v2],
        ]) {
          if (!inWindow(pu, pv)) continue;
          ctx.beginPath();
          ctx.arc(toX(pu), toY(pv), 12, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // Live ghost line in the zoom panel (anchored endpoint may be off-window;
    // canvas clips it). Cursor maps to the panel center.
    if (pending.kind === "awaitingSecond") {
      drawGhostLine(
        ctx,
        toX(pending.first.u),
        toY(pending.first.v),
        toX(cursor.u),
        toY(cursor.v),
        pending.transect
      );
    }

    ctx.strokeStyle = CROSSHAIR_COLOR;
    ctx.lineWidth = 0.6;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(0, cssH / 2);
    ctx.lineTo(cssW, cssH / 2);
    ctx.moveTo(cssW / 2, 0);
    ctx.lineTo(cssW / 2, cssH);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }, [image, clicks, cursor, zoomRadius, selectedIdx, pending]);

  const mainCanvasEventToImageCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): Cursor | null => {
      if (!image || !containerRef.current || !canvasRef.current) return null;
      const canvas = canvasRef.current;
      const container = containerRef.current;
      const rect = canvas.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const { effScale, drawW, drawH, offsetX, offsetY } = computeViewParams(
        image.width,
        image.height,
        viewScale,
        viewPanX,
        viewPanY,
        cw,
        ch
      );
      if (
        cssX < offsetX ||
        cssX > offsetX + drawW ||
        cssY < offsetY ||
        cssY > offsetY + drawH
      ) {
        return null;
      }
      return {
        u: (cssX - offsetX) / effScale,
        v: (cssY - offsetY) / effScale,
      };
    },
    [image, viewScale, viewPanX, viewPanY]
  );

  // Wire-ground-only distance auto-advance (1→2→…→15). Pulled out so both the
  // no-collision commit and the post-confirm replace/keep-both paths apply it
  // identically. No-op for spans.
  const applyAutoAdvance = useCallback(
    (committed: Annotation) => {
      if (committed.kind !== "wire_ground") return;
      if (!autoAdvance) return;
      const intDist = Math.round(committed.distance);
      const idx = CANONICAL_DISTANCES.indexOf(intDist);
      if (idx >= 0 && idx + 1 < CANONICAL_DISTANCES.length) {
        setCurrentDistance(CANONICAL_DISTANCES[idx + 1]);
      }
    },
    [autoAdvance]
  );

  // Single commit path for a fully-formed annotation. Checks for a duplicate
  // {transect, distance, kind}: if none, append + dirty + (wire-ground) auto-
  // advance; if one exists, divert to the blocking confirm modal (no append, no
  // dirty) and let the labeler choose replace / keep both / cancel. Reads `clicks`
  // fresh (it's in this callback's deps) so the collision check never runs against
  // a stale snapshot.
  // Placing the first annotation is the aha moment: persist that this user is
  // onboarded and drop the in-flow hint. Guarded via the ref so the store write
  // happens exactly once, even though this fires on every successful placement.
  const markOnboarded = useCallback(() => {
    if (onboardedRef.current) return;
    onboardedRef.current = true;
    setFirstRun(false);
    (async () => {
      try {
        await storeRef.current?.set(SETTINGS_KEY_ONBOARDED, true);
        await storeRef.current?.save();
      } catch (e) {
        console.error("Failed to persist onboarding flag", e);
      }
    })();
  }, []);

  const commitAnnotation = useCallback(
    (candidate: Annotation) => {
      const existingIndex = findCollision(clicks, {
        transect: candidate.transect,
        distance: candidate.distance,
        kind: candidate.kind,
      });
      if (existingIndex === null) {
        setClicks((prev) => [...prev, candidate]);
        setDirty(true);
        applyAutoAdvance(candidate);
        markOnboarded();
        return;
      }
      setPendingCollision({ candidate, existingIndex });
    },
    [clicks, applyAutoAdvance, markOnboarded]
  );

  const addClickAt = useCallback(
    (u: number, v: number) => {
      commitAnnotation({
        kind: "wire_ground",
        u,
        v,
        transect: currentTransect,
        distance: currentDistance,
      });
    },
    [commitAnnotation, currentTransect, currentDistance]
  );

  // Place an annotation of the active type at image coords (u,v). Wire-ground
  // adds a dot immediately (with auto-advance); a span places sequentially:
  // first click pins endpoint 1, second click completes + canonicalizes it.
  const placeAt = useCallback(
    (u: number, v: number) => {
      if (!canEdit) return; // web: blocked while another labeler holds the lock
      if (activeType === "wire_ground") {
        addClickAt(u, v);
        return;
      }
      const spanType = SPAN_TYPE_FOR[activeType];
      if (!spanType) return;
      if (pending.kind === "awaitingSecond") {
        const ep = canonicalizeSpan(spanType, pending.first, { u, v });
        const candidate: Annotation = {
          kind: SPAN_KIND_FOR[spanType],
          u1: ep.u1,
          v1: ep.v1,
          u2: ep.u2,
          v2: ep.v2,
          transect: pending.transect,
          distance: pending.distance,
        };
        // Reset pending → idle FIRST (clears the ghost line; the span is now
        // fully captured in `candidate`), then commit. commitAnnotation handles
        // the dirty flag and any collision divert — so on a cancelled collision
        // the pending state is still cleared and `dirty` stays untouched.
        dispatchPending({ type: "secondClick", point: { u, v } });
        commitAnnotation(candidate);
      } else {
        dispatchPending({
          type: "firstClick",
          point: { u, v },
          spanType,
          transect: currentTransect,
          distance: currentDistance,
        });
      }
    },
    [activeType, pending, currentTransect, currentDistance, addClickAt, commitAnnotation, canEdit]
  );

  // Collision-confirm resolvers. The modal is guarded so `clicks` cannot be
  // reordered while open, keeping `existingIndex` valid.
  const resolveCollisionReplace = useCallback(() => {
    if (!canEdit) return; // web: blocked while another labeler holds the lock
    if (!pendingCollision) return;
    const { candidate, existingIndex } = pendingCollision;
    setClicks((prev) => [
      ...prev.filter((_, i) => i !== existingIndex),
      candidate,
    ]);
    setDirty(true);
    applyAutoAdvance(candidate);
    setPendingCollision(null);
  }, [pendingCollision, applyAutoAdvance, canEdit]);

  const resolveCollisionKeepBoth = useCallback(() => {
    if (!canEdit) return; // web: blocked while another labeler holds the lock
    if (!pendingCollision) return;
    const { candidate } = pendingCollision;
    setClicks((prev) => [...prev, candidate]);
    setDirty(true);
    applyAutoAdvance(candidate);
    setPendingCollision(null);
  }, [pendingCollision, applyAutoAdvance, canEdit]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const p = mainCanvasEventToImageCoords(e);
      if (!p || !image || !containerRef.current) return;
      const cw = containerRef.current.clientWidth;
      const ch = containerRef.current.clientHeight;
      const { effScale } = computeViewParams(
        image.width,
        image.height,
        viewScale,
        viewPanX,
        viewPanY,
        cw,
        ch
      );
      const radiusImg = HIT_TEST_RADIUS_CSS_PX / effScale;
      const hit = hitTest(clicks, p, activeType, radiusImg);
      if (hit !== null) {
        setSelectedIdx(hit);
        return;
      }
      // A non-placement click (clearing a selection) only short-circuits when
      // no span is mid-placement; otherwise the click is the span's endpoint.
      if (selectedIdx !== null && pending.kind === "idle") {
        setSelectedIdx(null);
        return;
      }
      placeAt(p.u, p.v);
    },
    [
      mainCanvasEventToImageCoords,
      placeAt,
      clicks,
      selectedIdx,
      activeType,
      pending,
      image,
      viewScale,
      viewPanX,
      viewPanY,
    ]
  );

  const handleCanvasMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (panStateRef.current) {
        const dx = e.clientX - panStateRef.current.x;
        const dy = e.clientY - panStateRef.current.y;
        const cw = containerRef.current?.clientWidth ?? 0;
        const ch = containerRef.current?.clientHeight ?? 0;
        if (image) {
          const { drawW, drawH } = computeViewParams(
            image.width,
            image.height,
            viewScale,
            0,
            0,
            cw,
            ch
          );
          setViewPanX(clampPan(panStateRef.current.panX + dx, drawW, cw));
          setViewPanY(clampPan(panStateRef.current.panY + dy, drawH, ch));
        }
        return;
      }
      const p = mainCanvasEventToImageCoords(e);
      if (!p) return;
      setCursor(p);
    },
    [mainCanvasEventToImageCoords, image, viewScale]
  );

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // If space is held, suppress the subsequent click (the user is panning,
      // not marking). Pan only starts when zoomed in, but we still want to
      // eat the click at 1× so an aborted pan doesn't drop a marker.
      if (spaceDown) {
        suppressNextClickRef.current = true;
      }
      if (spaceDown && viewScale > 1) {
        e.preventDefault();
        panStateRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: viewPanX,
          panY: viewPanY,
        };
        setIsDragging(true);
      }
    },
    [spaceDown, viewScale, viewPanX, viewPanY]
  );

  const endPan = useCallback(() => {
    panStateRef.current = null;
    setIsDragging(false);
  }, []);

  const handleCanvasWheel = useCallback(
    (e: WheelEvent) => {
      if (!image || !containerRef.current || !canvasRef.current) return;
      e.preventDefault();
      const canvas = canvasRef.current;
      const container = containerRef.current;
      const rect = canvas.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      const cw = container.clientWidth;
      const ch = container.clientHeight;

      // Trackpad pinch gives ctrlKey=true with a larger deltaY; mouse wheel
      // gives plain deltaY. Same formula works for both — rate just tunes feel.
      const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_RATE);
      const newScale = Math.max(
        VIEW_SCALE_MIN,
        Math.min(VIEW_SCALE_MAX, viewScale * factor)
      );
      if (newScale === viewScale) return;

      // Zoom-at-cursor: keep the image-pixel under the cursor stationary.
      const before = computeViewParams(
        image.width,
        image.height,
        viewScale,
        viewPanX,
        viewPanY,
        cw,
        ch
      );
      const imgU = (cssX - before.offsetX) / before.effScale;
      const imgV = (cssY - before.offsetY) / before.effScale;

      const after = computeViewParams(
        image.width,
        image.height,
        newScale,
        0,
        0,
        cw,
        ch
      );
      // We want: cssX = after.offsetX + viewPanX_new + imgU * after.effScale
      // after.offsetX above is computed with pan=0, so:
      //   cssX = (cw - after.drawW)/2 + newPanX + imgU * after.effScale
      const newPanX = cssX - (cw - after.drawW) / 2 - imgU * after.effScale;
      const newPanY = cssY - (ch - after.drawH) / 2 - imgV * after.effScale;

      setViewScale(newScale);
      setViewPanX(clampPan(newPanX, after.drawW, cw));
      setViewPanY(clampPan(newPanY, after.drawH, ch));
    },
    [image, viewScale, viewPanX, viewPanY]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel", handleCanvasWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleCanvasWheel);
  }, [handleCanvasWheel, image]);

  const handleZoomClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!image || !cursor || !zoomCanvasRef.current) return;
      const canvas = zoomCanvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const zx = e.clientX - rect.left;
      const zy = e.clientY - rect.top;
      const r = zoomRadius;
      const sx = cursor.u - r;
      const sy = cursor.v - r;
      const sw = 2 * r;
      const sh = 2 * r;
      const u = sx + (zx / ZOOM_PANEL_PX) * sw;
      const v = sy + (zy / ZOOM_PANEL_PX) * sh;
      // Ignore clicks in the off-image black band at edges (sx/sy unclamped).
      if (u < 0 || v < 0 || u >= image.width || v >= image.height) return;
      // Zoom-panel effective scale: ZOOM_PANEL_PX CSS-px maps to (2*r) image-px.
      const effScale = ZOOM_PANEL_PX / (2 * r);
      const radiusImg = HIT_TEST_RADIUS_CSS_PX / effScale;
      const hit = hitTest(clicks, { u, v }, activeType, radiusImg);
      if (hit !== null) {
        setSelectedIdx(hit);
        return;
      }
      if (selectedIdx !== null && pending.kind === "idle") {
        setSelectedIdx(null);
        return;
      }
      placeAt(u, v);
    },
    [image, cursor, zoomRadius, placeAt, clicks, selectedIdx, activeType, pending]
  );

  // Wire-ground L/C/R breakdown (countsFromAnnotations already filters to
  // wire-ground, so spans never inflate these counts).
  const counts = countsFromAnnotations(clicks);
  const wireGroundCount = counts.L + counts.C + counts.R;
  // Per-span-kind tally in a single pass. Adding a new span kind extends the
  // initial Record (compiler-enforced via Span["kind"]) without a second loop.
  const spanCounts = clicks.reduce<Record<Span["kind"], number>>(
    (acc, c) => {
      if (c.kind !== "wire_ground") acc[c.kind]++;
      return acc;
    },
    { vertical_span: 0, horizontal_span: 0, flag_to_ground_span: 0 }
  );
  const verticalSpanCount = spanCounts.vertical_span;
  const horizontalSpanCount = spanCounts.horizontal_span;
  const flagToGroundSpanCount = spanCounts.flag_to_ground_span;

  // Web-only (cloud): team-progress tallies (#16), per-site ("cam02 — 8/12") and
  // dataset-wide, rolled up from the `annotations` summary columns in
  // `progressById`. Recomputed on gallery (re)load and after a local save (both
  // mutate `progressById`); not tied to `clicks`, so no per-keystroke churn.
  // Inert on desktop, which has no shared dataset (`progressById` stays empty).
  const progressSummary = useMemo(
    () =>
      summarizeProgress(
        folderImages
          .map((p) => progressById[p])
          .filter((p): p is ImageProgress => p !== undefined),
      ),
    [folderImages, progressById],
  );

  const filename = image ? pathBasename(image.path) : null;
  const saveStateText = dirty
    ? "unsaved"
    : lastSavedAt
    ? `saved ${fmtTimeOfDay(lastSavedAt)}`
    : null;

  return (
    <main className="app">
      <header className="titlebar">
        {image && (
          <span className="title-info">
            <span>{filename}</span>
            <span className="dim">
              {image.width}×{image.height}
            </span>
            {saveStateText && (
              <>
                <span className="sep">·</span>
                <span
                  className={`save-state ${dirty ? "is-dirty" : "is-saved"}`}
                >
                  {saveStateText}
                </span>
              </>
            )}
            {/* Web-only (#17) soft edit-lock badge. Held-by-other blocks editing
                (read-only); 'mine' is a subtle reassurance you hold it. */}
            {!isTauri() && lockStatusValue === "held-by-other" && (
              <>
                <span className="sep">·</span>
                <span className="lock-badge lock-badge-other" title="This image is being edited by another labeler. You can view it, but editing is blocked.">
                  🔒 in use by {lockHeldBy ?? "another labeler"}
                </span>
                {isAdmin && (
                  <button
                    type="button"
                    className="lock-force-unlock"
                    onClick={forceUnlock}
                    title="Admin: clear this lock so it can be claimed"
                  >
                    Force unlock
                  </button>
                )}
              </>
            )}
            {!isTauri() && lockStatusValue === "mine" && (
              <>
                <span className="sep">·</span>
                <span className="lock-badge lock-badge-mine" title="You hold the edit lock for this image.">
                  editing
                </span>
              </>
            )}
          </span>
        )}
        {image && (
          <div className="title-actions">
            <button
              className="title-btn"
              onClick={handleUndo}
              disabled={clicks.length === 0 || !canEdit}
              title="Undo last click (⌘Z)"
            >
              Undo
            </button>
            <button
              className="title-btn primary"
              onClick={handleSave}
              disabled={!dirty || !canEdit}
              title="Save (⌘S)"
            >
              Save
            </button>
            {!isTauri() && (
              <>
                <span className="title-divider" aria-hidden />
                <button
                  className="title-btn"
                  onClick={handleDownloadCurrent}
                  title="Download this image's annotation JSON"
                >
                  Download JSON
                </button>
              </>
            )}
            <span className="title-divider" aria-hidden />
            <button
              className="title-btn"
              onClick={handleOpen}
              title="Open image (⌘O)"
            >
              Open file
            </button>
            <button
              className="title-btn"
              onClick={handleOpenFolder}
              title="Open folder (⌘⇧O)"
            >
              Open folder
            </button>
          </div>
        )}
      </header>

      <section
        className={`workarea ${
          (isTauri() ? folderImages.length > 0 : true) ? "with-folder" : ""
        } ${image ? "with-rail" : ""}`}
      >
        {(isTauri() ? folderImages.length > 0 : true) && (
          <aside className="folder-sidebar">
            <div className="folder-header">
              {isTauri() ? (
                // Desktop: the open folder's name (no actions — those are web-only).
                <div className="folder-head-top">
                  <span className="folder-title" title={folderDir ?? ""}>
                    {folderDir ? pathBasename(folderDir) : ""}
                  </span>
                </div>
              ) : (
                isAdmin && (
                  // Web admin: a legible text-button action bar. The redundant
                  // "Shared dataset" label is dropped — it's always the shared
                  // dataset, so naming it was noise.
                  <div className="folder-head-actions">
                    <button
                      type="button"
                      className="folder-action-btn"
                      onClick={openNewFolder}
                      title="New folder"
                    >
                      <FolderPlusIcon />
                      New folder
                    </button>
                    <button
                      type="button"
                      className="folder-action-btn"
                      onClick={handleDownloadAll}
                      title="Download all annotations as a ZIP of per-image JSON files"
                    >
                      <DownloadIcon />
                      ZIP
                    </button>
                  </div>
                )
              )}
              {(() => {
                // Completion readout: a thin meter + tabular count. Desktop counts
                // locally-labeled images; web reads the shared-dataset summary.
                const annotated = isTauri()
                  ? folderImages.filter((p) => {
                      const c =
                        image?.path === p
                          ? countsByTransect(clicks)
                          : imageCounts[p];
                      return c && c.L + c.C + c.R > 0;
                    }).length
                  : progressSummary.overall.annotated;
                const total = isTauri()
                  ? folderImages.length
                  : progressSummary.overall.total;
                const pct = total > 0 ? (annotated / total) * 100 : 0;
                return (
                  <div className="folder-progress">
                    <div
                      className="folder-progress-bar"
                      role="progressbar"
                      aria-valuenow={annotated}
                      aria-valuemin={0}
                      aria-valuemax={total}
                      aria-label={`${annotated} of ${total} ${
                        isTauri() ? "labeled" : "annotated"
                      }`}
                    >
                      <div
                        className="folder-progress-fill"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span
                      className="folder-progress-count"
                      title={isTauri() ? "labeled / total" : "annotated / total"}
                    >
                      <span className="mono">{annotated}</span>/
                      <span className="mono">{total}</span>
                    </span>
                  </div>
                );
              })()}
            </div>

            {!isTauri() && newFolderOpen && (
              <div className="new-folder-row">
                <span className="chev-spacer" aria-hidden />
                <FolderIcon className="folder-icon" />
                <input
                  ref={newFolderInputRef}
                  className="new-folder-input"
                  placeholder="folder name"
                  value={newFolderName}
                  onChange={(e) => {
                    setNewFolderName(e.target.value);
                    setNewFolderError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitNewFolder();
                    else if (e.key === "Escape") closeNewFolder();
                  }}
                  onBlur={onNewFolderBlur}
                />
              </div>
            )}
            {!isTauri() && (newFolderError || rowError) && (
              <div className="folder-inline-error" role="alert">
                {newFolderError ?? rowError}
              </div>
            )}

            {isTauri() ? (
              <ul className="image-list">
                {folderImages.map((path, idx) => {
                  const isActive = image?.path === path;
                  const liveCounts = isActive ? countsByTransect(clicks) : null;
                  const persisted = imageCounts[path];
                  const rowCounts = liveCounts ?? persisted ?? null;
                  const total = rowCounts
                    ? rowCounts.L + rowCounts.C + rowCounts.R
                    : 0;
                  const untouched = total === 0;
                  return (
                    <li
                      key={path}
                      className={`image-item ${isActive ? "active" : ""} ${
                        untouched ? "untouched" : ""
                      }`}
                      onClick={() => navigateToIndex(idx)}
                      title={path}
                    >
                      <span className="image-item-name">{pathBasename(path)}</span>
                      {rowCounts && total > 0 && (
                        <span className="image-item-counts">
                          <span style={{ color: TRANSECT_COLORS.L }}>{rowCounts.L}</span>
                          <span className="dot">·</span>
                          <span style={{ color: TRANSECT_COLORS.C }}>{rowCounts.C}</span>
                          <span className="dot">·</span>
                          <span style={{ color: TRANSECT_COLORS.R }}>{rowCounts.R}</span>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : allSites.length === 0 ? (
              <div className="sb-empty">
                {isAdmin
                  ? "No folders yet. Click New folder to create a site (camera), then add its images."
                  : "No images in the shared dataset yet. Ask the project admin to add a camera folder."}
              </div>
            ) : (
              <div className="tree">
                {allSites.map((site) => {
                  const imgs = imagesBySite.get(site) ?? [];
                  const collapsed = collapsedSites.has(site);
                  const prog = progressSummary.perSite[site];
                  const folderRenaming =
                    renameTarget?.type === "folder" && renameTarget.name === site;
                  return (
                    <div className={`folder ${collapsed ? "" : "open"}`} key={site}>
                      <div
                        className="folder-row"
                        onClick={() => !folderRenaming && toggleSite(site)}
                        onContextMenu={
                          isAdmin
                            ? (e) =>
                                openRowMenu(e, { type: "folder", site, name: site })
                            : undefined
                        }
                        title={site}
                      >
                        <ChevronIcon className="chev" />
                        <FolderIcon className="folder-icon" />
                        {folderRenaming ? (
                          <input
                            ref={renameInputRef}
                            className="rename-input"
                            defaultValue={site}
                            disabled={rowBusy}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") submitRename(e.currentTarget.value);
                              else if (e.key === "Escape") {
                                setRenameTarget(null);
                                setRowError(null);
                              }
                            }}
                            onBlur={(e) => {
                              if (!rowBusy) submitRename(e.currentTarget.value);
                            }}
                          />
                        ) : (
                          <>
                            <span className="folder-name">{site}</span>
                            {prog ? (
                              <span className="folder-badge mono">
                                {prog.annotated}/{prog.total}
                              </span>
                            ) : (
                              <span className="folder-badge empty">empty</span>
                            )}
                            {isAdmin && (
                              <button
                                type="button"
                                className="folder-add"
                                title={`Add images to ${site}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  triggerAddImages(site);
                                }}
                              >
                                <PlusIcon />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      {!collapsed && (
                        <div className="folder-children">
                          {imgs.length === 0 ? (
                            <div className="folder-empty-note">
                              No images yet
                              {isAdmin ? " — click + to add some." : "."}
                            </div>
                          ) : (
                            imgs.map(({ path, idx }) => {
                              const isActive = image?.path === path;
                              const name = pathBasename(path);
                              const liveCounts = isActive
                                ? countsByTransect(clicks)
                                : null;
                              const total = liveCounts
                                ? liveCounts.L + liveCounts.C + liveCounts.R
                                : 0;
                              const untouched = !(
                                progressById[path] && isAnnotated(progressById[path])
                              );
                              const imgRenaming =
                                renameTarget?.type === "image" &&
                                renameTarget.site === site &&
                                renameTarget.name === name;
                              return (
                                <div
                                  key={path}
                                  className={`image-item ${isActive ? "active" : ""} ${
                                    untouched && !isActive ? "untouched" : ""
                                  }`}
                                  onClick={() => !imgRenaming && navigateToIndex(idx)}
                                  onContextMenu={
                                    isAdmin
                                      ? (e) =>
                                          openRowMenu(e, {
                                            type: "image",
                                            site,
                                            name,
                                          })
                                      : undefined
                                  }
                                  title={path}
                                >
                                  <ImageIcon className="img-icon" />
                                  {imgRenaming ? (
                                    <input
                                      ref={renameInputRef}
                                      className="rename-input"
                                      defaultValue={splitImageName(name).stem}
                                      disabled={rowBusy}
                                      onClick={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter")
                                          submitRename(e.currentTarget.value);
                                        else if (e.key === "Escape") {
                                          setRenameTarget(null);
                                          setRowError(null);
                                        }
                                      }}
                                      onBlur={(e) => {
                                        if (!rowBusy) submitRename(e.currentTarget.value);
                                      }}
                                    />
                                  ) : (
                                    <>
                                      <span className="image-item-name">{name}</span>
                                      {liveCounts && total > 0 && (
                                        <span className="image-item-counts">
                                          <span style={{ color: TRANSECT_COLORS.L }}>
                                            {liveCounts.L}
                                          </span>
                                          <span className="dot">·</span>
                                          <span style={{ color: TRANSECT_COLORS.C }}>
                                            {liveCounts.C}
                                          </span>
                                          <span className="dot">·</span>
                                          <span style={{ color: TRANSECT_COLORS.R }}>
                                            {liveCounts.R}
                                          </span>
                                        </span>
                                      )}
                                    </>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
        )}

        <div className="canvas-container" ref={containerRef}>
          {image ? (
            <canvas
              ref={canvasRef}
              style={{
                cursor:
                  spaceDown && viewScale > 1
                    ? isDragging
                      ? "grabbing"
                      : "grab"
                    : "crosshair",
              }}
              onClick={(e) => {
                // Suppress the click if space was held during mousedown
                // (user was panning, even if pan didn't actually start).
                if (suppressNextClickRef.current || panStateRef.current) {
                  suppressNextClickRef.current = false;
                  return;
                }
                handleCanvasClick(e);
              }}
              onMouseMove={handleCanvasMove}
              onMouseDown={handleCanvasMouseDown}
              onMouseUp={endPan}
              onMouseLeave={endPan}
            />
          ) : error ? (
            <div className="state-center">
              <div className="state-error">Could not read {error}</div>
              <button className="btn" onClick={handleOpen}>
                Try another image
              </button>
            </div>
          ) : (
            <div className="state-center">
              <div className="intro">
                <p className="state-tagline">
                  Mark wire–ground points and flag spans to calibrate distance.
                </p>
                <GuideFigures />
                <ul className="intro-tools" aria-label="Annotation tools">
                  <li className="intro-tool">
                    <kbd>Q</kbd>
                    <span>
                      <b>Wire–ground</b> · one click at the wire–ground point
                    </span>
                  </li>
                  <li className="intro-tool">
                    <kbd>W</kbd>
                    <span>
                      <b>Vertical</b> · two clicks, top → bottom of the flag
                    </span>
                  </li>
                  <li className="intro-tool">
                    <kbd>E</kbd>
                    <span>
                      <b>Horizontal</b> · two clicks, left → right of the flag
                    </span>
                  </li>
                  <li className="intro-tool">
                    <kbd>R</kbd>
                    <span>
                      <b>Flag → ground</b> · two clicks, flag top → wire base
                    </span>
                  </li>
                </ul>
                <p className="intro-flow">
                  Set the distance <kbd>↑</kbd>
                  <kbd>↓</kbd>, then click to place.
                </p>
                {isTauri() ? (
                  <>
                    <div className="state-buttons">
                      <button className="btn primary" onClick={handleOpen}>
                        Open image
                      </button>
                      <button className="btn" onClick={handleOpenFolder}>
                        Open folder
                      </button>
                    </div>
                    <span className="hint">
                      <kbd>⌘O</kbd> file · <kbd>⌘⇧O</kbd> folder ·{" "}
                      <button
                        className="link"
                        onClick={() => setShowHelp(true)}
                        type="button"
                      >
                        <kbd>?</kbd> all shortcuts
                      </button>
                    </span>
                  </>
                ) : (
                  <>
                    {folderImages.length === 0 && (
                      <span className="hint">
                        {isAdmin
                          ? "No images in the shared dataset yet — create a folder (camera) and add its images to begin."
                          : "No images in the shared dataset yet. Ask the project admin to add a camera folder."}
                      </span>
                    )}
                    {folderImages.length > 0 && (
                      <span className="hint">
                        Pick an image from the explorer on the left to begin.
                      </span>
                    )}
                    {isAdmin && (
                      <div className="state-buttons">
                        <button className="btn primary" onClick={openNewFolder}>
                          New folder
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Transparent overlay for the live span-placement ghost line. Stacked
              over the main canvas; pointer-events:none so it never intercepts
              clicks. Only mounted with an image, alongside the main canvas. */}
          {image && (
            <canvas ref={overlayCanvasRef} className="canvas-overlay" />
          )}

          {/* First-run guidance, shown over the image until the user places
              their first annotation. Complements the rail's per-tool hint
              (which covers what to click) with the setup step it omits. */}
          {image &&
            firstRun &&
            clicks.length === 0 &&
            pending.kind !== "awaitingSecond" && (
              <div className="canvas-hint" role="status">
                <span>
                  Set the transect (<kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd>) and
                  distance (<kbd>↑</kbd>/<kbd>↓</kbd>) on the right, then place
                  your annotation. The zoom panel gives sub-pixel precision.
                </span>
                <button
                  type="button"
                  className="canvas-hint-dismiss"
                  onClick={markOnboarded}
                >
                  Got it
                </button>
              </div>
            )}
        </div>

        {image && (
          <aside className="right-rail">
            <div className="zoom-panel">
              <canvas ref={zoomCanvasRef} onClick={handleZoomClick} />
              {!cursor && <div className="zoom-empty">hover the image</div>}
            </div>

            <div className="rail-section rail-pinned">
              <div className="rail-label">
                <span>Zoom radius</span>
                <span className="key-hint">[ · ]</span>
              </div>
              <div className="slider-row">
                <input
                  type="range"
                  min={ZOOM_MIN}
                  max={ZOOM_MAX}
                  step={5}
                  value={zoomRadius}
                  onChange={(e) =>
                    setZoomRadius(Number(e.currentTarget.value))
                  }
                  className="slider"
                />
                <span className="slider-value mono">{zoomRadius}px</span>
              </div>
            </div>

            <div className="rail-middle">
              <div className="rail-section">
                <div className="rail-label">
                  <span>Annotation</span>
                  <span className="key-hint">Q · W · E · R</span>
                </div>
                <div className="segmented tool-grid">
                  {ANNOTATION_TOOLS.map((tool) => (
                    <button
                      key={tool.kind}
                      className={`segmented-btn ${
                        activeType === tool.kind ? "tool-active" : ""
                      }`}
                      onClick={() => setActiveType(tool.kind)}
                      title={tool.title}
                      aria-pressed={activeType === tool.kind}
                    >
                      {tool.label}
                    </button>
                  ))}
                </div>
                <p className="tool-help" aria-live="polite">
                  {pending.kind === "awaitingSecond"
                    ? "Click the second point to finish · Esc to cancel"
                    : KIND_HINT[activeType]}
                </p>
              </div>

              <div className="rail-section">
                <div className="rail-label">
                  <span>Transect</span>
                  <span className="key-hint">1 · 2 · 3</span>
                </div>
                <div className="segmented">
                  {TRANSECTS.map((t) => {
                    const active = currentTransect === t;
                    return (
                      <button
                        key={t}
                        className={`segmented-btn ${active ? "active" : ""}`}
                        style={
                          active
                            ? {
                                background: TRANSECT_COLORS[t],
                                color: "var(--bg-app)",
                                borderColor: TRANSECT_COLORS[t],
                              }
                            : undefined
                        }
                        onClick={() => setCurrentTransect(t)}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rail-section">
                <div className="rail-label">
                  <span>Distance</span>
                  <span className="key-hint">↑ · ↓</span>
                </div>
                <div className="distance-row">
                  <input
                    type="number"
                    value={currentDistance}
                    step={0.5}
                    min={0}
                    max={99.9}
                    onChange={(e) => {
                      const v = Number(e.currentTarget.value);
                      if (Number.isFinite(v)) setCurrentDistance(v);
                    }}
                    className="distance-input"
                  />
                  <span className="unit">m</span>
                </div>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={autoAdvance}
                    onChange={(e) => setAutoAdvance(e.currentTarget.checked)}
                  />
                  <span>Auto-advance 1→15</span>
                  <span className="key-hint">A</span>
                </label>
                <div className="sparkline-block">
                  <span className="sparkline-caption">
                    {KIND_LABEL[activeType]} · by distance
                  </span>
                  <DistanceSparkline clicks={clicks} activeType={activeType} />
                </div>
              </div>
            </div>

            <div className="rail-bottom">
              <div className="rail-section counts">
                <div className="counts-line">
                  <span className="lbl">WG</span>
                  <span className="mono total">{wireGroundCount}</span>
                  <span className="sep">·</span>
                  <span className="lbl">V</span>
                  <span className="mono total">{verticalSpanCount}</span>
                  <span className="sep">·</span>
                  <span className="lbl">H</span>
                  <span className="mono total">{horizontalSpanCount}</span>
                  <span className="sep">·</span>
                  <span className="lbl">G</span>
                  <span className="mono total">{flagToGroundSpanCount}</span>
                </div>
              </div>

              {clicks.length > 0 && (
                <button className="clear-link" onClick={handleClear} disabled={!canEdit}>
                  clear all
                </button>
              )}
            </div>
          </aside>
        )}
      </section>

      {showHelp && (
        <KeyboardHelp
          onClose={() => setShowHelp(false)}
          appVersion={appVersion}
        />
      )}

      {pendingCollision && (
        <CollisionConfirm
          pending={pendingCollision}
          onReplace={resolveCollisionReplace}
          onKeepBoth={resolveCollisionKeepBoth}
          onCancel={resolveCollisionCancel}
        />
      )}

      <footer className="statusbar">
        {image ? (
          <>
            <span className="path-full">{image.path}</span>
            <span className="sep">·</span>
            <span>
              {clicks.length} click{clicks.length === 1 ? "" : "s"}
            </span>
            {saveStateText && (
              <>
                <span className="sep">·</span>
                <span>{saveStateText}</span>
              </>
            )}
            {viewScale > 1 && (
              <>
                <span className="sep">·</span>
                <span>
                  {viewScale.toFixed(1)}× zoom{" "}
                  <button className="link" onClick={resetView} type="button">
                    reset
                  </button>
                </span>
              </>
            )}
            {selectedIdx !== null && clicks[selectedIdx] && (
              <>
                <span className="sep">·</span>
                <span className="selection-info">
                  selected #{selectedIdx + 1}:{" "}
                  <span
                    style={{
                      color: TRANSECT_COLORS[clicks[selectedIdx].transect],
                    }}
                  >
                    {clicks[selectedIdx].transect}
                    {fmtDistance(clicks[selectedIdx].distance)}m
                  </span>{" "}
                  — <kbd>Del</kbd> remove, <kbd>1/2/3</kbd> retag,{" "}
                  <kbd>↑↓</kbd> distance, <kbd>Esc</kbd> deselect
                </span>
              </>
            )}
          </>
        ) : (
          <span>no image</span>
        )}
      </footer>

      {/* Web admin: right-click context menu for a folder/image row. */}
      {!isTauri() && isAdmin && ctxMenu && (
        <div
          className="row-ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="row-ctx-label">
            {ctxMenu.type === "folder" ? "Folder" : "Image"} · {ctxMenu.name}
          </div>
          {ctxMenu.type === "folder" && (
            <button
              type="button"
              onClick={() => {
                triggerAddImages(ctxMenu.site);
                setCtxMenu(null);
              }}
            >
              <PlusIcon /> Add images…
            </button>
          )}
          {ctxMenu.type === "image" && (
            <button
              type="button"
              onClick={() => {
                const idx = folderImages.indexOf(`${ctxMenu.site}/${ctxMenu.name}`);
                if (idx >= 0) navigateToIndex(idx);
                setCtxMenu(null);
              }}
            >
              <ImageIcon /> Open
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setRenameTarget({
                type: ctxMenu.type,
                site: ctxMenu.site,
                name: ctxMenu.name,
              });
              if (ctxMenu.type === "folder") expandSite(ctxMenu.site);
              setRowError(null);
              setCtxMenu(null);
            }}
          >
            <RenameIcon /> Rename
          </button>
          <div className="row-ctx-sep" />
          <button
            type="button"
            className="danger"
            onClick={() => {
              setDeleteTarget({ ...ctxMenu });
              setCtxMenu(null);
            }}
          >
            <TrashIcon /> Delete {ctxMenu.type}
          </button>
        </div>
      )}

      {/* Delete confirmation popover (no native dialog). */}
      {!isTauri() && isAdmin && deleteTarget && (
        <>
          <div
            className="row-confirm-backdrop"
            onClick={() => !rowBusy && setDeleteTarget(null)}
          />
          <div
            className="row-confirm"
            style={{
              left: Math.min(deleteTarget.x, window.innerWidth - 270),
              top: Math.min(deleteTarget.y, window.innerHeight - 150),
            }}
          >
            <p className="row-confirm-title">
              Delete {deleteTarget.type} “{deleteTarget.name}”?
            </p>
            <p className="row-confirm-sub">
              {deleteTarget.type === "folder"
                ? "Removes the folder and all its images & annotations. This can’t be undone."
                : "Removes this image and its annotations. This can’t be undone."}
            </p>
            {rowError && (
              <p className="row-confirm-error" role="alert">
                {rowError}
              </p>
            )}
            <div className="row-confirm-actions">
              <button
                type="button"
                className="btn"
                disabled={rowBusy}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={rowBusy}
                onClick={handleDeleteConfirmed}
              >
                {rowBusy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Add-images upload modal (drag-drop). */}
      {!isTauri() &&
        isAdmin &&
        uploadModalSite !== null &&
        backendRef.current instanceof SupabaseStorageBackend && (
          <UploadModal
            backend={backendRef.current}
            site={uploadModalSite}
            existingNames={(imagesBySite.get(uploadModalSite) ?? []).map((x) =>
              pathBasename(x.path),
            )}
            onClose={() => setUploadModalSite(null)}
            onUploaded={() => {
              const s = uploadModalSite;
              refreshGallery();
              if (s) expandSite(s);
            }}
          />
        )}
    </main>
  );
}

export default App;
