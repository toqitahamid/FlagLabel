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
import "./onboarding/onboarding.css";
import { GuideFigures } from "./onboarding/schematics";
import {
  WelcomeModal,
  GettingStartedChecklist,
  ProductTour,
  obWelcomeSeen,
  markObWelcomeSeen,
  obChecklistDismissed as readObChecklistDismissed,
  markObChecklistDismissed,
  resetObWelcome,
  resetObChecklist,
} from "./onboarding";
import {
  type Annotation,
  type WireGroundPoint,
  type Transect,
  type Counts,
  type FlagBox,
  type FlagMask,
  type MaskRing,
  type PlacementType,
  type SpanEndpoints,
  countsFromAnnotations,
  countsByTransect,
  canonicalizeSpan,
  canonicalizeBox,
  maskBounds,
  roundRings,
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
import {
  pendingPolygonReducer,
  canClose,
  polygonRings,
  POLYGON_IDLE,
  POLYGON_MIN_VERTICES,
} from "./annotations/pending-polygon";
import { findCollision } from "./annotations/collision";
import {
  type Candidate,
  type Sam3Client,
  createSam3Client,
  segmentWithReencode,
  Sam3UnreachableError,
  SAM3_DEFAULT_BASE_URL,
} from "./sam3/client";
import {
  pendingPromptReducer,
  promptPoints,
  PROMPT_IDLE,
} from "./sam3/pending-prompt";
import { TauriStorageBackend } from "./cloud/tauri-backend";
import {
  SupabaseStorageBackend,
  fetchIsAdmin,
  fetchHasMaskTools,
} from "./cloud/supabase-backend";
import {
  serializeAnnotationFile,
  canonicalizeAnnotationFile,
  buildZipEntries,
  zipEntryPath,
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
import { AdminPanel } from "./cloud/AdminPanel";
import { useImageLock } from "./cloud/useImageLock";
import { useAccount } from "./cloud/AuthGate";

// Active annotation type ↔ annotation kind mapping. "wire_ground" is the
// classic dot; "vertical_span" is the two-click flag vertical span;
// "horizontal_span" is the two-click flag horizontal span;
// "flag_to_ground_span" is the two-click flag-body-top → wire–ground span;
// "flag_box" is the two-click hand-drawn box around one flag; "flag_mask" is the
// SAM3 segmentation accepted from a box (not click-placed at all — its tool slot
// exists so a committed mask can be selected and deleted, since hitTest is
// active-type-gated).
// Tool identity in the rail: every annotation kind gets a slot, PLUS "polygon" —
// the hand-drawn mask tool. It is a distinct TOOL but NOT a distinct kind: closing
// its outline commits a `flag_mask`, exactly like accepting a SAM3 candidate does.
// So it can't come from `ActiveType` (= Annotation["kind"]) and is added here.
// Everywhere a real kind is required (hitTest above all) the call sites narrow it
// away first — see handleCanvasClick / handleZoomClick.
type ActiveAnnoType = ActiveType | "polygon";
// Annotation kind → PlacementType (or null for kinds that aren't placed by two
// clicks). A FULL Record over every kind, so adding a new two-click kind
// hard-errors here until an entry is added — matching SPAN_KIND_FOR /
// SPAN_LABEL_SUFFIX. The call site's `if (!spanType) return;` handles the null
// case unchanged (wire-ground, which is one click, and flag_mask, which is
// produced by the model rather than clicked).
const SPAN_TYPE_FOR: Record<ActiveAnnoType, PlacementType | null> = {
  wire_ground: null,
  vertical_span: "vertical",
  horizontal_span: "horizontal",
  flag_to_ground_span: "flag_to_ground",
  flag_box: "box",
  flag_mask: null,
  // The polygon tool places an UNBOUNDED number of vertices, so it does not ride
  // the two-click pending-span reducer at all — see annotations/pending-polygon.
  polygon: null,
};

// PlacementType → annotation kind. Keyed on `PlacementType` (a full Record), so
// adding a new two-click geometry forces a matching entry here at compile time.
// The value is narrowed to the two-endpoint kinds so a completed span/box object
// typechecks as a member of the union without widening `kind` back to all kinds.
const SPAN_KIND_FOR: Record<PlacementType, Span["kind"]> = {
  vertical: "vertical_span",
  horizontal: "horizontal_span",
  flag_to_ground: "flag_to_ground_span",
  box: "flag_box",
};

// The annotation-type selector, in keyboard order (Q W / E R / T Y / P → a
// 2-column grid; an ODD last entry spans both columns, see .tool-grid in App.css —
// which is why the 7th tool, Polygon, renders full-width on its own row).
// One entry per tool keeps the rail buttons DRY and in sync with the union.
const ANNOTATION_TOOLS: {
  kind: ActiveAnnoType;
  key: string;
  label: string;
  title: string;
  hint: string;
}[] = [
  {
    kind: "wire_ground",
    key: "Q",
    label: "Wire–ground",
    title: "Wire–ground point (Q): one click at the wire–ground intersection",
    hint: "One click at the wire–ground intersection.",
  },
  {
    kind: "vertical_span",
    key: "W",
    label: "Vertical",
    title: "Vertical span (W): the flag's top and bottom edges · click either first",
    hint: "Top and bottom edge of the flag · 2 clicks, either order.",
  },
  {
    kind: "horizontal_span",
    key: "E",
    label: "Horizontal",
    title: "Horizontal span (E): the flag's left and right edges · click either first",
    hint: "Left and right edge of the flag · 2 clicks, either order.",
  },
  {
    kind: "flag_to_ground_span",
    key: "R",
    label: "Flag→ground",
    title: "Flag-to-ground span (R): the flag top and the wire base at the ground · click either first",
    hint: "Flag top and wire base at the ground · 2 clicks, either order.",
  },
  {
    kind: "flag_box",
    key: "T",
    label: "Box",
    title: "Flag box (T): a box around the whole flag · click two opposite corners",
    hint: "Two opposite corners of a box around the flag · 2 clicks, any corner first.",
  },
  {
    kind: "flag_mask",
    key: "Y",
    label: "Mask",
    title:
      "Flag mask (Y): select/delete accepted masks. To create one, select a box and press M",
    hint: "Select an existing mask. To make one: pick a box (T), select it, press M.",
  },
  {
    kind: "polygon",
    key: "P",
    label: "Polygon",
    title:
      "Hand-drawn polygon (P): click the flag outline vertex by vertex, ↵ to close · the manual fallback when SAM3 can't segment a small or distant flag",
    hint: "Click the outline vertex by vertex · ↵ closes it (3+ points) · Del undoes one · Esc cancels.",
  },
];

// Placement hint per kind (for the live rail help line), derived from the tool
// list so it stays in sync. Endpoints are canonicalized after placement (see
// canonicalizeSpan), so either click order yields the same stored span — the
// hints name the two edges to connect, not a required order.
const KIND_HINT = ANNOTATION_TOOLS.reduce(
  (m, t) => ((m[t.kind] = t.hint), m),
  {} as Record<ActiveAnnoType, string>
);

// Tools still restricted to an admin on the web build: box (T), mask (Y) and the
// hand-drawn polygon (P). The original four (Q / W / E / R) are open to every
// labeler. Restricted means CREATION only — existing boxes and masks placed by an
// admin still render, round-trip through save, and are never dropped for anyone;
// see the load/save paths, which never filter by kind.
const ADMIN_ONLY_TOOLS: ReadonlySet<ActiveAnnoType> = new Set<ActiveAnnoType>([
  "flag_box",
  "flag_mask",
  "polygon",
]);

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

// Platform modifier glyph for the titlebar keycaps (⌘ on macOS, Ctrl elsewhere),
// so Undo/Save read correctly on both the macOS and Windows builds and on web.
const MOD_KEY =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
    ? "⌘"
    : "Ctrl";

const ZOOM_PANEL_PX = 360;
const ZOOM_MIN = 15;
const ZOOM_MAX = 300;
const ZOOM_DEFAULT = 80;
// Zoom-panel center reticle. A single thin tinted line was invisible over pale
// subjects (a white flag, snow, light leaves), so the reticle is drawn in two
// passes — a dark halo under a bright core — to read on ANY background.
const CROSSHAIR_CORE_COLOR = "rgba(255, 255, 255, 0.95)";
const CROSSHAIR_HALO_COLOR = "rgba(0, 0, 0, 0.55)";
const CROSSHAIR_GAP = 7;

const SETTINGS_FILE = "settings.json";
const SETTINGS_KEY_CLICKS_DIR = "clicks_dir";
const SETTINGS_KEY_ONBOARDED = "onboarded";
// Base URL of the SAM3 segmentation service (the local end of an SSH tunnel to
// the GPU box). Persisted so a lab with a different tunnel port sets it once.
const SETTINGS_KEY_SAM3_URL = "sam3_url";

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

// FlagLabel brand mark: a survey flag on a wire stake, with the wire–ground
// intersection (the point the app exists to mark) called out as a dot at the
// base. Inherits `currentColor`; the titlebar tints it with the accent green.
function FlagLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 3.5V20.5" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
      <path d="M7.2 4 17.5 7 7.2 10Z" fill="currentColor" />
      <circle cx="7" cy="20.5" r="1.7" fill="currentColor" />
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

// `adminOnly` sections document the restricted tools (see ADMIN_ONLY_TOOLS) and are
// dropped for everyone else — the overlay must never advertise a key that does
// nothing.
const HELP_SECTIONS: {
  title: string;
  rows: [string, string][];
  adminOnly?: true;
  // Replacement for `rows[0]` when the restricted tools are unavailable, for a
  // section that is otherwise shared by both roles.
  firstRowWithoutAdminTools?: [string, string];
}[] = [
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
    firstRowWithoutAdminTools: [
      "Annotation type wire–ground / vert. span / horiz. span / flag→ground",
      "Q / W / E / R",
    ],
    rows: [
      ["Annotation type wire–ground / vert. span / horiz. span / flag→ground / box / mask / polygon", "Q / W / E / R / T / Y / P"],
      ["Transect L / C / R", "1 / 2 / 3"],
      ["Distance ± 1 m", "↑ / ↓"],
      ["Distance ± 0.5 m", "⇧↑ / ⇧↓"],
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
    title: "Flag box (T)",
    adminOnly: true,
    rows: [
      ["Click two opposite corners", "click ×2"],
      ["Live rubber-band preview between clicks", "move mouse"],
      ["Cancel a half-drawn box", "Esc"],
    ],
  },
  {
    title: "Flag mask (Y · SAM3)",
    adminOnly: true,
    rows: [
      ["Segment the selected flag box", "M"],
      ["Add a positive point (refine)", "click"],
      ["Add a negative point (refine)", "⇧click"],
      ["Undo the last refinement point", "Del / ⌫"],
      ["Cycle candidate masks", "C"],
      ["Accept the shown candidate", "↵"],
      ["Discard without accepting", "Esc"],
      ["Select / delete an accepted mask", "Y, then click"],
    ],
  },
  {
    title: "Hand-drawn polygon (P)",
    adminOnly: true,
    rows: [
      ["Add a vertex (canvas or zoom panel)", "click"],
      ["Close the outline as a mask (3+ vertices)", "↵"],
      ["Remove the last vertex", "Del / ⌫"],
      ["Discard the whole outline", "Esc"],
      ["Select / delete it afterwards", "Y, then click"],
    ],
  },
  {
    title: "Editing",
    rows: [
      ["Undo last annotation", "⌘Z"],
      ["Redo", "⌘⇧Z"],
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


function KeyboardHelp({
  onClose,
  appVersion,
  adminTools,
  onReplayWelcome,
  onStartTour,
  onResetChecklist,
}: {
  onClose: () => void;
  appVersion: string;
  // Whether the viewer has the restricted tools (see ADMIN_ONLY_TOOLS); when they
  // don't, their sections and keys are left out entirely.
  adminTools: boolean;
  onReplayWelcome?: () => void;
  onStartTour?: () => void;
  onResetChecklist?: () => void;
}) {
  const sections = adminTools
    ? HELP_SECTIONS
    : HELP_SECTIONS.filter((s) => !s.adminOnly).map((s) =>
        s.firstRowWithoutAdminTools
          ? { ...s, rows: [s.firstRowWithoutAdminTools, ...s.rows.slice(1)] }
          : s
      );
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
          The flags stand along three transect lines (L / C / R), 15 to a line
          and 1 m apart. For each flag, pick its transect and distance from the
          right rail, then choose a tool and click in the main image or the
          magnified zoom panel. Files auto-save 5 seconds after the last change
          once a clicks folder is chosen.
        </p>

        {onReplayWelcome && onStartTour && onResetChecklist && (
          <div className="ob-replay">
            <button onClick={onReplayWelcome}>Replay welcome</button>
            <button onClick={onStartTour}>Take the tour</button>
            <button onClick={onResetChecklist}>Reset checklist</button>
          </div>
        )}

        <div className="help-guide">
          <GuideFigures />
        </div>

        <div className="help-grid">
          {sections.map((section) => (
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
  // Set by mask-accept: the prompt flag_box to auto-delete IF the mask commits
  // (Replace or Keep both). On Cancel nothing commits, so the box survives.
  alsoRemoveIdx?: number;
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

// The two-endpoint members of the Annotation union: the three spans plus the box.
type Span = Extract<Annotation, { u1: number }>;

// The two-endpoint kinds that draw as a LINE — i.e. every Span except the box,
// which draws as a rectangle. drawSpan and SPAN_DASH are keyed on this on
// purpose: it makes every render loop fail to compile until it branches the box
// out to drawBox, instead of silently drawing a box as its diagonal.
type LineSpan = Exclude<Span, FlagBox>;

// Span/box kind → label suffix. Keyed on all two-endpoint kinds (a full Record),
// so a new one must add its suffix here at compile time.
const SPAN_LABEL_SUFFIX: Record<Span["kind"], string> = {
  vertical_span: "V",
  horizontal_span: "H",
  flag_to_ground_span: "G",
  flag_box: "B",
};

// Label suffix for a mask. Not in SPAN_LABEL_SUFFIX because that Record is keyed
// on the two-endpoint kinds (`Span["kind"]`), which excludes flag_mask by
// construction — see the `Span` alias above.
const MASK_LABEL_SUFFIX = "M";

// The `score` a HAND-DRAWN mask carries. 1 by convention, and reserved for hand
// drawing: a SAM3 candidate's score is model-produced and < 1 in practice, so
// `score === 1` is how a downstream consumer tells a traced outline from a
// segmented one. Documented in README's output-format section too.
const HAND_DRAWN_MASK_SCORE = 1;

// Human-readable name for each annotation kind, used in the collision-confirm
// message (e.g. "L3 vertical span already exists"). Keyed on the full kind union
// (a complete Record) so a new kind must declare its phrase here at compile time.
const KIND_NAME: Record<Annotation["kind"], string> = {
  wire_ground: "wire–ground point",
  vertical_span: "vertical span",
  horizontal_span: "horizontal span",
  flag_to_ground_span: "flag-to-ground span",
  flag_box: "flag box",
  flag_mask: "flag mask",
};

// Dash pattern for each line-span kind. Empty array = solid line. flag_to_ground
// renders dashed so it reads as distinct from a vertical span that may share
// its top endpoint. Keyed on LineSpan kinds (full Record) so new line kinds
// declare their style here at compile time.
const SPAN_DASH_PX = 8;
const SPAN_GAP_PX = 5;
const SPAN_DASH: Record<LineSpan["kind"], number[]> = {
  vertical_span: [],
  horizontal_span: [],
  flag_to_ground_span: [SPAN_DASH_PX, SPAN_GAP_PX],
};

// The corner/endpoint points drawn as selection rings, in image pixels. A line
// span has two (its endpoints); a box has four — both stored corners plus the two
// implied by the axis-aligned rect — matching what hitTest treats as grabbable.
function selectionHandles(s: Span): [number, number][] {
  if (s.kind === "flag_box") {
    return [
      [s.u1, s.v1],
      [s.u2, s.v1],
      [s.u2, s.v2],
      [s.u1, s.v2],
    ];
  }
  return [
    [s.u1, s.v1],
    [s.u2, s.v2],
  ];
}

// Draw a completed span as a tick-ended line in its transect color, labeled
// e.g. "L3·V". Coordinates x1/y1/x2/y2 are already in canvas (CSS) pixels.
function drawSpan(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  s: LineSpan
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

// Draw a completed flag box as a rectangle in its transect color, labeled e.g.
// "L3·B". x1/y1/x2/y2 are the canonical top-left / bottom-right corners already
// converted to canvas (CSS) pixels — the caller may hand them over in any order
// once view flips are involved, so the rect is built from the min/max.
function drawBox(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  b: FlagBox
) {
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);

  ctx.lineWidth = 2;
  ctx.strokeStyle = TRANSECT_COLORS[b.transect];
  ctx.setLineDash([]);
  ctx.strokeRect(left, top, w, h);

  drawLabel(
    ctx,
    `${b.transect}${fmtDistance(b.distance)}·${SPAN_LABEL_SUFFIX[b.kind]}`,
    left + 6,
    top - 4
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

// Live rubber-band rectangle from a pending box's first corner to the cursor.
// The box counterpart of drawGhostLine, same dash/alpha/anchor-dot treatment.
function drawGhostRect(
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
  ctx.strokeRect(
    Math.min(x1, x2),
    Math.min(y1, y2),
    Math.abs(x2 - x1),
    Math.abs(y2 - y1)
  );
  ctx.setLineDash([]);
  // small dot at the anchored first corner
  ctx.globalAlpha = 1;
  ctx.fillStyle = TRANSECT_COLORS[transect];
  ctx.beginPath();
  ctx.arc(x1, y1, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Radius of a placed polygon vertex dot, in canvas (CSS) pixels. Small on
// purpose: the whole point of the hand-drawn tool is tracing flags a few pixels
// across, and a fat dot would hide the very edge being traced.
const POLYGON_VERTEX_R = 3.5;

// Live ghost for the in-progress hand-drawn polygon. `pts` are the placed vertices
// and (cursorX, cursorY) the cursor, all already in canvas (CSS) pixels — the
// caller supplies whichever surface's transform it is drawing on, so the same
// helper serves the main overlay and the zoom panel.
//
// Placed edges draw SOLID; the segment to the cursor and the closing hint back to
// vertex 0 draw dashed, so "already committed" reads differently from "what Enter
// would add". With one vertex the dashed pair collapses onto itself and with two it
// overlaps the placed edge — both harmless, so neither is special-cased.
function drawGhostPolygon(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  cursorX: number,
  cursorY: number,
  transect: Transect
) {
  if (pts.length === 0) return;
  const color = TRANSECT_COLORS[transect];
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();

  ctx.globalAlpha = 0.7;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  const last = pts[pts.length - 1];
  ctx.moveTo(last[0], last[1]);
  ctx.lineTo(cursorX, cursorY);
  ctx.lineTo(pts[0][0], pts[0][1]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  ctx.fillStyle = color;
  for (const [x, y] of pts) {
    ctx.beginPath();
    ctx.arc(x, y, POLYGON_VERTEX_R, 0, Math.PI * 2);
    ctx.fill();
  }
  // Ring vertex 0 in white: that is the vertex Enter closes onto, and on a
  // 40-vertex outline it is otherwise impossible to tell which one it was.
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(pts[0][0], pts[0][1], POLYGON_VERTEX_R + 2.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// Mask overlay opacities. The fill has to be translucent enough that the labeler
// can still judge the flag edge THROUGH it — that judgement is the whole point of
// reviewing a mask — so the outline carries the shape and the fill only tints.
const MASK_FILL_ALPHA = 0.3;
const MASK_PREVIEW_FILL_ALPHA = 0.38;
// The un-accepted candidate is drawn white rather than in the transect color, so
// "proposed by the model" is never mistaken for "committed by me" at a glance.
const MASK_PREVIEW_COLOR = "#ffffff";

// Trace a mask's rings into the current path. `toX`/`toY` map image pixels to
// canvas (CSS) pixels — the caller supplies whichever surface's transform it is
// drawing on, so the same tracer serves the main canvas and the zoom panel (whose
// magnifications are independent; see ZOOM_* vs VIEW_SCALE_*).
function traceRings(
  ctx: CanvasRenderingContext2D,
  rings: MaskRing[],
  toX: (u: number) => number,
  toY: (v: number) => number
) {
  ctx.beginPath();
  for (const ring of rings) {
    if (ring.length === 0) continue;
    ctx.moveTo(toX(ring[0][0]), toY(ring[0][1]));
    for (let i = 1; i < ring.length; i++) {
      ctx.lineTo(toX(ring[i][0]), toY(ring[i][1]));
    }
    ctx.closePath();
  }
}

// Draw a committed mask: translucent transect-colored fill plus a solid outline,
// labeled e.g. "L3·M". "evenodd" so a ring nested inside another reads as a hole
// rather than painting over it.
function drawMask(
  ctx: CanvasRenderingContext2D,
  m: FlagMask,
  toX: (u: number) => number,
  toY: (v: number) => number
) {
  const color = TRANSECT_COLORS[m.transect];
  ctx.save();
  traceRings(ctx, m.rings, toX, toY);
  ctx.globalAlpha = MASK_FILL_ALPHA;
  ctx.fillStyle = color;
  ctx.fill("evenodd");
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();

  const b = maskBounds(m.rings);
  if (b) {
    drawLabel(
      ctx,
      `${m.transect}${fmtDistance(m.distance)}·${MASK_LABEL_SUFFIX}`,
      toX(b.u1) + 6,
      toY(b.v1) - 4
    );
  }
}

// Draw the live, un-accepted candidate: white dashed outline over a translucent
// white fill, so it reads as a proposal awaiting Enter.
function drawMaskPreview(
  ctx: CanvasRenderingContext2D,
  rings: MaskRing[],
  toX: (u: number) => number,
  toY: (v: number) => number
) {
  ctx.save();
  traceRings(ctx, rings, toX, toY);
  ctx.globalAlpha = MASK_PREVIEW_FILL_ALPHA;
  ctx.fillStyle = MASK_PREVIEW_COLOR;
  ctx.fill("evenodd");
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.strokeStyle = MASK_PREVIEW_COLOR;
  ctx.setLineDash([5, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// Draw the refinement clicks of an active prompt: green + for positive, red − for
// negative. These are transient prompt state, never annotations.
function drawPromptClicks(
  ctx: CanvasRenderingContext2D,
  clicks: { u: number; v: number; label: 0 | 1 }[],
  toX: (u: number) => number,
  toY: (v: number) => number
) {
  ctx.save();
  for (const c of clicks) {
    const x = toX(c.u);
    const y = toY(c.v);
    const r = 6;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = c.label === 1 ? "#3ddc84" : "#ff4d4d";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#000";
    ctx.stroke();
    // Glyph: a full plus for positive, just the bar for negative.
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 3, y);
    ctx.lineTo(x + 3, y);
    if (c.label === 1) {
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x, y + 3);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function App() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clicks, setClicks] = useState<Annotation[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  // Redo: annotations popped by Undo, newest last. Any edit that ISN'T an
  // undo/redo clears this (standard redo semantics) — see the effect below.
  const [redoStack, setRedoStack] = useState<Annotation[]>([]);
  // Set true right before an undo/redo mutates `clicks` so the invalidation
  // effect knows to KEEP the redo stack for that one change.
  const historyAction = useRef(false);
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

  // Active annotation type chosen via Q (wire–ground) / W (vertical span).
  const [activeType, setActiveType] = useState<ActiveAnnoType>("wire_ground");
  // Global pending-span state (sequential two-click placement across surfaces).
  const [pending, dispatchPending] = useReducer(pendingSpanReducer, PENDING_IDLE);
  // In-progress hand-drawn polygon (P). Unbounded vertex clicks across both
  // surfaces; commits as a flag_mask on Enter. Mutually exclusive with the SAM3
  // session below — both own the canvas, so starting either ends the other.
  const [polygon, dispatchPolygon] = useReducer(pendingPolygonReducer, POLYGON_IDLE);

  // Pending duplicate-collision decision. Non-null = the confirm modal is open
  // and blocks other interaction until the labeler resolves it.
  const [pendingCollision, setPendingCollision] = useState<PendingCollision>(null);

  // ─── SAM3 segmentation session ───────────────────────────────────────────────
  // An active session targets ONE selected flag_box and holds the refinement
  // clicks made so far. Everything here is transient: only the accepted mask ever
  // becomes an annotation.
  const [prompt, dispatchPrompt] = useReducer(pendingPromptReducer, PROMPT_IDLE);
  // The ranked candidates from the last /segment call and which one is showing.
  // Up to 3 come back because granularity is genuinely ambiguous at distance —
  // the labeler cycles, the app never silently picks.
  const [maskCandidates, setMaskCandidates] = useState<Candidate[]>([]);
  const [maskCandidateIdx, setMaskCandidateIdx] = useState<number>(0);
  const [maskBusy, setMaskBusy] = useState<boolean>(false);
  const [maskError, setMaskError] = useState<string | null>(null);
  const [sam3Url, setSam3Url] = useState<string>(SAM3_DEFAULT_BASE_URL);
  // Per-image encode cache: the image bytes we POSTed and the embed_id the server
  // gave back. Keyed on the image PATH so switching images invalidates it — a
  // stale embed_id would segment the wrong photo. The blob is retained because a
  // 409 (server restart / cache eviction) has to re-POST the same bytes.
  const sam3EmbedRef = useRef<{
    path: string;
    blob: Blob;
    embedId: string;
  } | null>(null);
  // Guards against overlapping /segment calls: each request captures the token,
  // and a response whose token is stale is dropped (same pattern as loadSeqRef).
  const segmentSeqRef = useRef(0);

  // The candidate currently on show, or null. Drives both canvases — so it is
  // declared HERE, above the draw effects, because their dependency arrays are
  // evaluated during render and a later `const` would be in its TDZ.
  const activeCandidate: Candidate | null =
    prompt.kind === "active" ? maskCandidates[maskCandidateIdx] ?? null : null;

  // Tear down the whole session. `prompt.targetIdx` is an INDEX into `clicks`, and
  // any mutation that removes or reorders an element invalidates it — so every
  // such path calls this. (Pure appends can't shift a lower index, so those don't
  // need it.) Same hazard, and same discipline, as `setPendingCollision(null)`.
  const endMaskSession = useCallback(() => {
    segmentSeqRef.current++;
    dispatchPrompt({ type: "cancel" });
    setMaskCandidates([]);
    setMaskCandidateIdx(0);
    setMaskBusy(false);
    setMaskError(null);
  }, []);

  // Tear down BOTH canvas-owning sessions. Every mutation that can invalidate an
  // index or swap the image goes through THIS, not endMaskSession: on top of the
  // stale-targetIdx hazard above, an in-progress polygon still holding vertices
  // would carry them onto the next photo and write a mask onto the wrong image.
  // (endMaskSession stays separate for the two callers that must NOT drop a
  // polygon: mask-accept and selecting the polygon tool.)
  const endSessions = useCallback(() => {
    endMaskSession();
    dispatchPolygon({ type: "cancel" });
  }, [endMaskSession]);

  // Cancel = discard the candidate entirely: no append, no dirty change.
  // Declared here (before the keyboard effect that references it)
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

  // Web-only (cloud) state. `isAdmin` gates the privileged force-unlock affordance
  // (clearing another labeler's lock) and the admin panel. Dataset management
  // (upload, add/rename/delete) is open to every authenticated team member via
  // `canManageDataset` below. Inert on desktop (the effect that sets isAdmin
  // early-returns on Tauri).
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  // Whether the box / mask / polygon tools are available (see ADMIN_ONLY_TOOLS).
  // Deliberately NOT the admin role — there is more than one admin, and this is a
  // per-user server-side flag (`has_mask_tools()`, membership table RLS-locked with
  // no policies, so it isn't even readable through the API). Arrives async on the
  // web — false until the RPC answers, so everything reading it must be
  // render/handler state, not a mount-time snapshot. Permanently false on desktop,
  // where there is no auth at all: this labeling happens on the web build.
  const [maskTools, setMaskTools] = useState<boolean>(false);
  const adminTools = maskTools;

  // The rail's tool buttons, minus the restricted ones. Derived at render, so the
  // grid grows the moment `isAdmin` resolves true — and the section's key hint is
  // built from the same list, never listing a key that isn't shown.
  const visibleTools = adminTools
    ? ANNOTATION_TOOLS
    : ANNOTATION_TOOLS.filter((t) => !ADMIN_ONLY_TOOLS.has(t.kind));

  // Signed-in account (web only; null on desktop). Surfaced into the merged
  // titlebar's far-right cluster as the email + Sign out.
  const account = useAccount();

  // Dataset management (upload, add/rename/delete folders & images) is available
  // to every authenticated team member; the RLS policies enforce the same.
  // Always false on desktop, which uses the local-filesystem paths instead.
  const canManageDataset = !isTauri();

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
  // Web-only admin user-management panel (gated on isAdmin in the titlebar).
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
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

  // Web-only coordinated onboarding: the welcome walkthrough → optional tour, and
  // the dockable getting-started checklist. `obStage` drives which full-screen
  // surface (if any) is up; the checklist shows in the "none" stage until done or
  // dismissed. Everything is gated on `!isTauri()` at the mount sites below.
  const [obStage, setObStage] = useState<"welcome" | "tour" | "none">("none");
  const [obChecklistDismissed, setObChecklistDismissedState] =
    useState<boolean>(() => !isTauri() && readObChecklistDismissed());

  useEffect(() => {
    if (!isTauri() && !obWelcomeSeen()) setObStage("welcome");
  }, []);

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
        const sam3 = await s.get<string>(SETTINGS_KEY_SAM3_URL);
        if (typeof sam3 === "string" && sam3.trim() !== "") setSam3Url(sam3);
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
    fetchHasMaskTools().then(setMaskTools).catch(() => {});
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
            // Same reasoning for the SAM3 session: `prompt.targetIdx` indexes the
            // OUTGOING image's clicks array, and the cached embed_id belongs to
            // the outgoing image's pixels. Accepting either after a switch would
            // write a mask from one photo onto another. Drop both — along with any
            // half-drawn polygon, whose vertices are the outgoing image's pixels.
            endSessions();
            sam3EmbedRef.current = null;
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
  }, [endSessions]);

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

  // Download the CURRENT image's annotation JSON as `<stem>.json` (just the
  // original image name — no site prefix). Prefer the persisted blob (so the
  // download matches what's stored); fall back to building from the in-memory
  // clicks if the row has no data yet.
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

  // Dataset export: one ZIP with every annotated image AND its JSON, foldered by
  // site (`site/IMG_0001.JPG` + `site/IMG_0001.json`). Image bytes are downloaded
  // from Storage with a small concurrency cap; the image is added to the ZIP
  // BEFORE its JSON so a failed download never leaves an orphan .json.
  // ponytail: builds the whole ZIP in memory (fine at ~100s of images / <1GB).
  // If the dataset grows to thousands, switch to a streaming zip +
  // showSaveFilePicker so blobs are consumed one at a time instead of all held.
  const [datasetExporting, setDatasetExporting] = useState(false);
  const handleDownloadDataset = useCallback(async () => {
    if (isTauri()) return;
    const backend = backendRef.current;
    if (!(backend instanceof SupabaseStorageBackend)) return;
    setDatasetExporting(true);
    try {
      const entries = await backend.listAnnotatedImageEntries();
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      let cursor = 0;
      const CONCURRENCY = 5;
      const worker = async (): Promise<void> => {
        while (true) {
          const i = cursor++;
          if (i >= entries.length) return;
          const entry = entries[i];
          try {
            const imageBlob = await backend.downloadImageBlob(entry.storagePath);
            zip.file(`${entry.site}/${entry.name}`, imageBlob);
            const canonical = canonicalizeAnnotationFile(entry.data);
            zip.file(zipEntryPath(canonical), serializeAnnotationFile(canonical));
          } catch (err) {
            console.error(`Dataset export: skipped ${entry.storagePath}`, err);
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, entries.length) }, () =>
          worker(),
        ),
      );
      // STORE, not DEFLATE: JPEG/PNG are already compressed, so deflating them
      // burns CPU (can hang the tab) for ~0 size gain.
      const blob = await zip.generateAsync({
        type: "blob",
        compression: "STORE",
      });
      triggerDownload("flaglabel-dataset.zip", blob);
    } catch (e) {
      console.error("Dataset export failed", e);
    } finally {
      setDatasetExporting(false);
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

  // Whether Undo would actually do something — the titlebar button reads this so it
  // doesn't look live while handleUndo refuses (see the guard below).
  const canUndo =
    canEdit &&
    clicks.length > 0 &&
    (adminTools || !ADMIN_ONLY_TOOLS.has(clicks[clicks.length - 1].kind));

  const handleUndo = useCallback(() => {
    if (!canEdit) return; // web: blocked while another labeler holds the lock
    if (clicks.length === 0) return;
    // Undo has no floor at the loaded state — it just pops the last annotation — so
    // on an admin-labeled image it is the one path that could delete a box or mask
    // without selecting it (which the restricted tools already prevent). Refuse
    // instead: undo may only remove what this user could have placed. Redo needs no
    // guard, since it can only re-add what undo popped.
    const last = clicks[clicks.length - 1];
    if (!adminTools && ADMIN_ONLY_TOOLS.has(last.kind)) return;
    historyAction.current = true; // keep the redo stack across this change
    setRedoStack((r) => [...r, clicks[clicks.length - 1]]);
    setClicks((prev) => prev.slice(0, -1));
    setSelectedIdx(null);
    // Undo can pop the very box a SAM3 session is targeting (or anything after
    // it), so the session's index is no longer trustworthy — drop it.
    endSessions();
    setDirty(true);
  }, [canEdit, clicks, endSessions, adminTools]);

  const handleRedo = useCallback(() => {
    if (!canEdit) return; // web: blocked while another labeler holds the lock
    if (redoStack.length === 0) return;
    const item = redoStack[redoStack.length - 1];
    historyAction.current = true; // keep the redo stack across this change
    setRedoStack((r) => r.slice(0, -1));
    setClicks((prev) => [...prev, item]);
    setSelectedIdx(null);
    endSessions();
    setDirty(true);
  }, [canEdit, redoStack, endSessions]);

  // Invalidate the redo stack on any `clicks` change that ISN'T an undo/redo
  // (a new placement, delete, clear, retag, or loading another image). This
  // centralizes redo invalidation so the many setClicks call sites don't each
  // have to remember to clear it.
  useEffect(() => {
    if (historyAction.current) {
      historyAction.current = false;
      return;
    }
    setRedoStack((prev) => (prev.length ? [] : prev));
  }, [clicks]);

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
      endSessions();
      setDirty(true);
    }
  }, [clicks.length, canEdit, endSessions]);

  const deleteSelected = useCallback(() => {
    if (!canEdit) return; // web: blocked while another labeler holds the lock
    if (selectedIdx === null) return;
    setClicks((prev) => prev.filter((_, i) => i !== selectedIdx));
    setSelectedIdx(null);
    // A filter shifts every index above the removed one, so any live SAM3
    // session's targetIdx is now wrong (possibly pointing at a different flag).
    endSessions();
    setDirty(true);
  }, [selectedIdx, canEdit, endSessions]);

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
        markOnboarded();
        return;
      }
      setPendingCollision({ candidate, existingIndex });
    },
    [clicks, markOnboarded]
  );

  // ─── SAM3 segmentation ───────────────────────────────────────────────────────

  // One client per configured URL. Cheap to rebuild; memoized only so effects and
  // callbacks that depend on it don't churn on every render.
  const sam3 = useMemo<Sam3Client>(
    () => createSam3Client({ baseUrl: sam3Url }),
    [sam3Url]
  );

  // Change the service URL and persist it. Any cached embed_id belongs to the OLD
  // service, so it is dropped — a different host has never seen that id.
  const updateSam3Url = useCallback((next: string) => {
    setSam3Url(next);
    sam3EmbedRef.current = null;
    (async () => {
      try {
        await storeRef.current?.set(SETTINGS_KEY_SAM3_URL, next);
        await storeRef.current?.save();
      } catch (e) {
        console.error("Failed to persist SAM3 URL", e);
      }
    })();
  }, []);

  // Acquire the current image's bytes as a Blob for /encode.
  //
  // THE ONE RUNTIME-RISKY LINE in this feature, and deliberately the only place
  // it appears. `image.url` is a signed https URL on web (plainly fetchable) but
  // an `asset://` URL from Tauri's convertFileSrc on desktop; whether the webview
  // will `fetch` that scheme is runtime behavior neither `tsc` nor vitest can
  // check. If desktop encode fails here, the fix is local to this function — the
  // known good fallback is a Rust command returning the file bytes (rather than an
  // offscreen-canvas re-encode, which risks canvas tainting).
  const fetchImageBlob = useCallback(async (url: string): Promise<Blob> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`image fetch failed (${res.status})`);
    return res.blob();
  }, []);

  // Return a valid {blob, embedId} for the current image, encoding if we don't
  // already hold one for THIS path. The cache is keyed on path so an image switch
  // (which also nulls it in loadImage) can never reuse another photo's embedding.
  const ensureEncoded = useCallback(
    async (img: LoadedImage): Promise<{ blob: Blob; embedId: string }> => {
      const cached = sam3EmbedRef.current;
      if (cached && cached.path === img.path) {
        return { blob: cached.blob, embedId: cached.embedId };
      }
      const blob = await fetchImageBlob(img.url);
      const { embed_id } = await sam3.encode(blob);
      sam3EmbedRef.current = { path: img.path, blob, embedId: embed_id };
      return { blob, embedId: embed_id };
    },
    [sam3, fetchImageBlob]
  );

  // Run /segment for `box` with `points`, and show the ranked candidates.
  // The box AND the full click list go on every call — the service is stateless
  // per request, so this is never a delta against the previous call.
  const runSegment = useCallback(
    async (box: FlagBox, points: ReturnType<typeof promptPoints>) => {
      if (!image) return;
      const seq = ++segmentSeqRef.current;
      setMaskBusy(true);
      setMaskError(null);
      try {
        const { blob, embedId } = await ensureEncoded(image);
        const res = await segmentWithReencode(
          sam3,
          embedId,
          blob,
          [box.u1, box.v1, box.u2, box.v2],
          points
        );
        // segmentWithReencode may have transparently re-encoded after a 409; the
        // id it returns is the one the result was actually produced with, so write
        // it back or the next call repeats the recovery.
        if (res.embedId !== embedId) {
          sam3EmbedRef.current = { path: image.path, blob, embedId: res.embedId };
        }
        if (seq !== segmentSeqRef.current) return; // superseded (or session ended)
        setMaskCandidates(res.candidates);
        setMaskCandidateIdx(0);
        if (res.candidates.length === 0) {
          setMaskError("No mask returned for this box.");
        }
      } catch (e) {
        if (seq !== segmentSeqRef.current) return;
        setMaskCandidates([]);
        // Unreachable vs. failed are different problems with different fixes, so
        // they get different messages — see the client's error classes.
        setMaskError(
          e instanceof Sam3UnreachableError
            ? `Can't reach the SAM3 service at ${sam3.baseUrl}. Is the SSH tunnel up?`
            : `Segmentation failed: ${e instanceof Error ? e.message : String(e)}`
        );
        console.error("SAM3 segment failed", e);
      } finally {
        if (seq === segmentSeqRef.current) setMaskBusy(false);
      }
    },
    [image, sam3, ensureEncoded]
  );

  // Start (or restart) a segmentation session on the selected flag_box: box-only
  // prompt, no refinement clicks yet. Bound to M.
  const startSegmentSelected = useCallback(() => {
    if (!adminTools) return; // mask tooling is admin-only on the web build
    if (!canEdit) return; // web: blocked while another labeler holds the lock
    if (!image) return;
    // A SAM3 session and a hand-drawn polygon both own the canvas, so only one may
    // be live. This direction refuses rather than cancels: a traced outline can be
    // thirty deliberate clicks, so M says what to do instead of silently binning it.
    // (The other direction — selecting the polygon tool — DOES discard a live
    // candidate, because re-requesting one is a single keypress.)
    if (polygon.kind === "active") {
      setMaskError(
        "Finish the hand-drawn polygon first: ↵ to close it, or Esc to discard it."
      );
      return;
    }
    // A mask is always derived from a box, so the box has to be picked explicitly —
    // guessing "the most recent box" would silently mask the wrong flag on an image
    // with fifteen of them.
    const targetIdx = selectedIdx;
    const target = targetIdx === null ? undefined : clicks[targetIdx];
    if (targetIdx === null || !target || target.kind !== "flag_box") {
      setMaskError(
        "Pick the box first: press T, click one of its corners to select it, then M."
      );
      return;
    }
    segmentSeqRef.current++;
    dispatchPrompt({ type: "start", targetIdx });
    setMaskCandidates([]);
    setMaskCandidateIdx(0);
    setMaskError(null);
    void runSegment(target, []);
  }, [adminTools, canEdit, image, selectedIdx, clicks, runSegment, polygon.kind]);

  // Add one refinement click and re-segment with the full list. Points are
  // transient prompt state — they are never annotations and never persisted.
  const addPromptClick = useCallback(
    (u: number, v: number, label: 0 | 1) => {
      if (prompt.kind !== "active") return;
      const target = clicks[prompt.targetIdx];
      if (!target || target.kind !== "flag_box") {
        endMaskSession();
        return;
      }
      const next = pendingPromptReducer(prompt, {
        type: "addClick",
        point: { u, v },
        label,
      });
      dispatchPrompt({ type: "addClick", point: { u, v }, label });
      void runSegment(target, promptPoints(next));
    },
    [prompt, clicks, runSegment, endMaskSession]
  );

  // Drop the last refinement click and re-segment with what's left. Re-running is
  // the point: leaving the previous candidate on screen after removing the click
  // that produced it would show a mask the current prompt no longer implies.
  const undoPromptClick = useCallback(() => {
    if (prompt.kind !== "active" || prompt.clicks.length === 0) return;
    const target = clicks[prompt.targetIdx];
    if (!target || target.kind !== "flag_box") {
      endMaskSession();
      return;
    }
    const next = pendingPromptReducer(prompt, { type: "undoClick" });
    dispatchPrompt({ type: "undoClick" });
    void runSegment(target, promptPoints(next));
  }, [prompt, clicks, runSegment, endMaskSession]);

  const cycleMaskCandidate = useCallback(() => {
    if (maskCandidates.length === 0) return;
    setMaskCandidateIdx((i) => (i + 1) % maskCandidates.length);
  }, [maskCandidates.length]);

  // Commit the showing candidate as a flag_mask on the target box's
  // {transect, distance}, then end the session. Rounds the rings once, here —
  // the schema layer stays a passthrough (see roundRings).
  const acceptMaskCandidate = useCallback(() => {
    if (!canEdit) return; // web: blocked while another labeler holds the lock
    if (prompt.kind !== "active") return;
    // Fail safe if a mutation slipped past endMaskSession: the index must still
    // point at a flag_box or we do not know which flag this mask belongs to.
    const target = clicks[prompt.targetIdx];
    if (!target || target.kind !== "flag_box") {
      endMaskSession();
      return;
    }
    const candidate = maskCandidates[maskCandidateIdx];
    if (!candidate || candidate.rings.length === 0) return;
    const mask: FlagMask = {
      kind: "flag_mask",
      rings: roundRings(candidate.rings),
      score: candidate.score,
      transect: target.transect,
      distance: target.distance,
    };
    const boxIdx = prompt.targetIdx;
    endMaskSession();
    // Inlined commit (not commitAnnotation) because accepting a mask also
    // auto-deletes its prompt box, and both must land in ONE setClicks — a
    // separate delete would shift indices under the collision modal's feet.
    const existingIndex = findCollision(clicks, {
      transect: mask.transect,
      distance: mask.distance,
      kind: mask.kind,
    });
    if (existingIndex === null) {
      setClicks((prev) => [...prev.filter((_, i) => i !== boxIdx), mask]);
      setDirty(true);
      markOnboarded();
      return;
    }
    // Duplicate mask -> divert to the modal; the box is deleted only if the
    // user actually commits (Replace / Keep both), never on Cancel.
    setPendingCollision({ candidate: mask, existingIndex, alsoRemoveIdx: boxIdx });
  }, [
    canEdit,
    prompt,
    clicks,
    maskCandidates,
    maskCandidateIdx,
    markOnboarded,
    endMaskSession,
  ]);

  // ─── Hand-drawn polygon (P) ──────────────────────────────────────────────────

  // Switch tools. Goes through here rather than a bare setActiveType so the
  // session/tool coupling lives in one place: a polygon belongs to the polygon
  // tool, and leaving that tool abandons the outline instead of stranding an
  // invisible one still armed for Enter. Picking the polygon tool discards any live
  // SAM3 candidate for the mirror-image reason — see startSegmentSelected, which
  // refuses in the other direction instead of discarding traced work.
  // This is also the ONLY writer of `activeType`, which makes it the single gate for
  // the restricted tools: the rail buttons and the T / Y / P keys both come through
  // here, and hitTest is active-type-gated, so a tool that can't be selected can't
  // place, select or delete its kind either.
  const selectTool = useCallback(
    (kind: ActiveAnnoType) => {
      if (!adminTools && ADMIN_ONLY_TOOLS.has(kind)) return;
      if (kind === activeType) return; // re-pressing the active tool changes nothing
      if (kind === "polygon") endMaskSession();
      else dispatchPolygon({ type: "cancel" });
      setActiveType(kind);
    },
    [activeType, endMaskSession, adminTools]
  );

  // Belt-and-braces: `activeType` is never restored from the store (only clicks_dir /
  // onboarded / sam3_url are persisted), so this only guards the async direction — a
  // restricted tool armed at the moment `isAdmin` resolves to false. Fall back to the
  // default tool and tear down either canvas-owning session rather than leaving a
  // hidden tool live.
  useEffect(() => {
    if (adminTools || !ADMIN_ONLY_TOOLS.has(activeType)) return;
    endSessions();
    selectTool("wire_ground");
  }, [adminTools, activeType, endSessions, selectTool]);

  // Add one vertex at image coords (u,v), starting a session on the first click —
  // which is where the transect/distance are captured, exactly as pending-span
  // does. The two dispatches are applied in order by the reducer, so a first click
  // never leaves a vertex-less active polygon behind.
  const addPolygonVertex = useCallback(
    (u: number, v: number) => {
      if (!canEdit) return; // web: blocked while another labeler holds the lock
      if (polygon.kind !== "active") {
        dispatchPolygon({
          type: "start",
          transect: currentTransect,
          distance: currentDistance,
        });
      }
      dispatchPolygon({ type: "addVertex", point: { u, v } });
    },
    [canEdit, polygon.kind, currentTransect, currentDistance]
  );

  // Close the outline and commit it as a flag_mask on the transect/distance the
  // FIRST click captured. Unlike mask-accept there is no prompt box to delete, so
  // this takes the standard commitAnnotation path (dirty flag + collision divert).
  // Reset to idle FIRST — clearing the ghost — so a cancelled collision still ends
  // the session instead of leaving the outline re-committable.
  const closePolygon = useCallback(() => {
    if (!canEdit) return; // web: blocked while another labeler holds the lock
    if (!canClose(polygon) || polygon.kind !== "active") return;
    const candidate: FlagMask = {
      kind: "flag_mask",
      rings: roundRings(polygonRings(polygon)),
      score: HAND_DRAWN_MASK_SCORE,
      transect: polygon.transect,
      distance: polygon.distance,
    };
    dispatchPolygon({ type: "cancel" });
    commitAnnotation(candidate);
  }, [canEdit, polygon, commitAnnotation]);

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
        // A hand-drawn polygon owns the canvas exactly like a SAM3 session does
        // (clicks become vertices), so it cancels at the same priority — discarding
        // the whole outline. The two are mutually exclusive, so their order here is
        // immaterial.
        if (polygon.kind === "active") {
          e.preventDefault();
          dispatchPolygon({ type: "cancel" });
          return;
        }
        // A live SAM3 session owns the canvas (clicks become prompts), so it is
        // the most "active" thing of all — cancel it first, discarding the
        // candidate without committing anything.
        if (prompt.kind === "active") {
          e.preventDefault();
          endMaskSession();
          return;
        }
        // An in-progress span placement is the next most "active" thing — cancel
        // it before falling through to deselect.
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

      // SAM3 segmentation. All three are plain keys (`!cmd`), matching the
      // existing tool keys, so ⌘M (minimize) and ⌘C (copy) are untouched. They sit
      // below the pendingCollision early-return above, so the collision modal
      // stays fully modal. Both drive the mask tooling, so both are gated with it —
      // without `adminTools` they fall through and do nothing at all, rather than
      // being swallowed by a preventDefault for a feature the user doesn't have.
      if (adminTools && e.key.toLowerCase() === "m" && !cmd) {
        e.preventDefault();
        startSegmentSelected();
        return;
      }
      if (adminTools && e.key.toLowerCase() === "c" && !cmd) {
        e.preventDefault();
        // Explicitly inert while drawing: a polygon and a SAM3 session are mutually
        // exclusive, so there is no candidate to cycle and C must not read as
        // "something happened" mid-outline.
        if (polygon.kind === "active") return;
        cycleMaskCandidate();
        return;
      }
      // Enter closes a polygon OR accepts a mask candidate — never both, since the
      // two sessions are mutually exclusive. preventDefault fires even when the
      // outline is too short to close, so Enter is consistently swallowed here.
      if (e.key === "Enter" && polygon.kind === "active") {
        e.preventDefault();
        closePolygon();
        return;
      }
      if (e.key === "Enter" && prompt.kind === "active") {
        e.preventDefault();
        acceptMaskCandidate();
        return;
      }

      // While drawing, Del is "undo my last vertex" — and unlike the block below it
      // must fire with nothing selected, which is the normal state mid-outline.
      if (
        polygon.kind === "active" &&
        (e.key === "Delete" || e.key === "Backspace")
      ) {
        e.preventDefault();
        dispatchPolygon({ type: "undoVertex" });
        return;
      }

      if (
        selectedIdx !== null &&
        (e.key === "Delete" || e.key === "Backspace")
      ) {
        e.preventDefault();
        // While a session is live, Delete is the "undo my last refinement click"
        // affordance, not "delete the annotation" — the box being segmented must
        // survive its own session.
        if (prompt.kind === "active") {
          undoPromptClick();
          return;
        }
        deleteSelected();
        return;
      }

      if (cmd && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
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
      } else if (e.key.toLowerCase() === "q" && !cmd) {
        e.preventDefault();
        selectTool("wire_ground");
      } else if (e.key.toLowerCase() === "w" && !cmd) {
        e.preventDefault();
        selectTool("vertical_span");
      } else if (e.key.toLowerCase() === "e" && !cmd) {
        e.preventDefault();
        selectTool("horizontal_span");
      } else if (e.key.toLowerCase() === "r" && !cmd) {
        e.preventDefault();
        selectTool("flag_to_ground_span");
      } else if (e.key.toLowerCase() === "t" && !cmd) {
        e.preventDefault();
        selectTool("flag_box");
      } else if (e.key.toLowerCase() === "y" && !cmd) {
        e.preventDefault();
        selectTool("flag_mask");
      } else if (e.key.toLowerCase() === "p" && !cmd) {
        e.preventDefault();
        selectTool("polygon");
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
    handleRedo,
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
    prompt,
    endMaskSession,
    startSegmentSelected,
    cycleMaskCandidate,
    acceptMaskCandidate,
    undoPromptClick,
    polygon,
    closePolygon,
    selectTool,
    adminTools,
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

      // Image-pixel → canvas-pixel mappers for this surface, shared with the mask
      // tracers (the zoom panel has its own pair; the two magnifications are
      // independent — see ZOOM_* vs VIEW_SCALE_*).
      const toX = (u: number) => offsetX + u * effScale;
      const toY = (v: number) => offsetY + v * effScale;

      for (const c of clicks) {
        if (c.kind === "wire_ground") {
          drawMarker(ctx, toX(c.u), toY(c.v), c, viewScale);
        } else if (c.kind === "flag_mask") {
          // Masks carry `rings`, not endpoints, so they can't ride the
          // two-endpoint branch below — the `Span` alias excludes them by design.
          drawMask(ctx, c, toX, toY);
        } else {
          const x1 = toX(c.u1);
          const y1 = toY(c.v1);
          const x2 = toX(c.u2);
          const y2 = toY(c.v2);
          if (c.kind === "flag_box") drawBox(ctx, x1, y1, x2, y2, c);
          else drawSpan(ctx, x1, y1, x2, y2, c);
        }
      }

      // Live, un-accepted candidate + its refinement clicks, drawn on top of the
      // committed annotations so the proposal is never hidden behind them.
      if (activeCandidate) drawMaskPreview(ctx, activeCandidate.rings, toX, toY);
      if (prompt.kind === "active") {
        drawPromptClicks(ctx, prompt.clicks, toX, toY);
      }

      const sc = selectedIdx !== null ? clicks[selectedIdx] : undefined;
      if (sc) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        if (sc.kind === "wire_ground") {
          ctx.beginPath();
          ctx.arc(toX(sc.u), toY(sc.v), 10 + 2 * viewScale, 0, Math.PI * 2);
          ctx.stroke();
        } else if (sc.kind === "flag_mask") {
          // A mask has no corner handles, so selection is an inflated outline of
          // its bounding box — visible even when the mask is a few pixels across.
          const b = maskBounds(sc.rings);
          if (b) {
            ctx.strokeRect(
              toX(b.u1) - 4,
              toY(b.v1) - 4,
              toX(b.u2) - toX(b.u1) + 8,
              toY(b.v2) - toY(b.v1) + 8
            );
          }
        } else {
          // Outline a selected box as well as ringing its corners: zoomed in far
          // enough, every corner sits off-canvas and the rings alone would leave
          // no visible selection (same reason as in the zoom panel below).
          if (sc.kind === "flag_box") {
            const bx1 = offsetX + sc.u1 * effScale;
            const by1 = offsetY + sc.v1 * effScale;
            const bx2 = offsetX + sc.u2 * effScale;
            const by2 = offsetY + sc.v2 * effScale;
            ctx.strokeRect(bx1 - 3, by1 - 3, bx2 - bx1 + 6, by2 - by1 + 6);
          }
          const ring = 8 + 2 * viewScale;
          for (const [pu, pv] of selectionHandles(sc)) {
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
    // The mask preview IS keyed here (not on the overlay): it changes only per
    // /segment round-trip or per candidate cycle, not per mousemove.
  }, [
    image,
    clicks,
    selectedIdx,
    viewScale,
    viewPanX,
    viewPanY,
    activeCandidate,
    prompt,
  ]);

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

      // No cursor = nothing to rubber-band toward. Not a lost polygon: the only
      // place that nulls the cursor is loadImage, which cancels the polygon in the
      // same breath (endSessions), so "polygon active with no cursor" is unreachable.
      if (!cursor) return;
      const polygonActive = polygon.kind === "active";
      if (pending.kind !== "awaitingSecond" && !polygonActive) return;
      const { effScale, offsetX, offsetY } = computeViewParams(
        image!.width,
        image!.height,
        viewScale,
        viewPanX,
        viewPanY,
        cw,
        ch
      );
      const toX = (u: number) => offsetX + u * effScale;
      const toY = (v: number) => offsetY + v * effScale;
      if (polygon.kind === "active") {
        drawGhostPolygon(
          ctx,
          polygon.vertices.map((p) => [toX(p.u), toY(p.v)] as [number, number]),
          toX(cursor.u),
          toY(cursor.v),
          polygon.transect
        );
      }
      if (pending.kind === "awaitingSecond") {
        const ghost = pending.type === "box" ? drawGhostRect : drawGhostLine;
        ghost(
          ctx,
          toX(pending.first.u),
          toY(pending.first.v),
          toX(cursor.u),
          toY(cursor.v),
          pending.transect
        );
      }
    }

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
  }, [image, pending, polygon, cursor, viewScale, viewPanX, viewPanY]);

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
    // AABB overlap between an annotation's bounding box and the panel window.
    // Used instead of a per-endpoint test wherever a shape can straddle or fully
    // enclose the window (see the v0.2.0 long-span fix). Typed on the bare
    // {u1,v1,u2,v2} shape rather than `Span` so a mask's `maskBounds` result feeds
    // the same test — a mask is at least as prone to enclosing the window as a box.
    const bboxInWindow = (a: SpanEndpoints) =>
      !(
        Math.max(a.u1, a.u2) < sx ||
        Math.min(a.u1, a.u2) > sx + sw ||
        Math.max(a.v1, a.v2) < sy ||
        Math.min(a.v1, a.v2) > sy + sh
      );
    const toX = (u: number) => (u - sx) * zoomScale;
    const toY = (v: number) => (v - sy) * zoomScale;

    for (const c of clicks) {
      if (c.kind === "wire_ground") {
        if (!inWindow(c.u, c.v)) continue;
        drawMarker(ctx, toX(c.u), toY(c.v), c, zoomScale);
      } else if (c.kind === "flag_mask") {
        // Same AABB rule as spans and boxes: a mask can straddle or fully enclose
        // the window with no vertex inside it, so gate on its bounding box and let
        // the canvas clip the rest.
        const b = maskBounds(c.rings);
        if (!b || !bboxInWindow(b)) continue;
        drawMask(ctx, c, toX, toY);
      } else {
        // Draw the span/box if its bounding box intersects the panel window — not
        // just if an endpoint is inside it. A long span (e.g. flag-to-ground) can
        // pass straight through the window with BOTH endpoints outside, and a box
        // drawn partly outside must still render its visible portion; the canvas
        // clips whatever falls off-panel. For a box the min/max of its two stored
        // corners IS its bounding box, so the same AABB test covers both.
        if (!bboxInWindow(c)) continue;
        const x1 = toX(c.u1);
        const y1 = toY(c.v1);
        const x2 = toX(c.u2);
        const y2 = toY(c.v2);
        if (c.kind === "flag_box") drawBox(ctx, x1, y1, x2, y2, c);
        else drawSpan(ctx, x1, y1, x2, y2, c);
      }
    }

    // Live candidate + refinement clicks in the magnified panel — this is the
    // surface a distant flag is actually judged on, so the preview has to appear
    // here too. AABB-gated for the same reason as the committed masks above.
    if (activeCandidate) {
      const b = maskBounds(activeCandidate.rings);
      if (b && bboxInWindow(b)) {
        drawMaskPreview(ctx, activeCandidate.rings, toX, toY);
      }
    }
    if (prompt.kind === "active") {
      drawPromptClicks(
        ctx,
        prompt.clicks.filter((c) => inWindow(c.u, c.v)),
        toX,
        toY
      );
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
      } else if (sc.kind === "flag_mask") {
        const b = maskBounds(sc.rings);
        if (b && bboxInWindow(b)) {
          ctx.strokeRect(
            toX(b.u1) - 3,
            toY(b.v1) - 3,
            toX(b.u2) - toX(b.u1) + 6,
            toY(b.v2) - toY(b.v1) + 6
          );
        }
      } else {
        // A flag box is routinely WIDER than the zoom window (default radius 80
        // → a 160 px window), which puts all four corners off-panel and would
        // leave a selected box with no visible selection at all. So outline the
        // box itself as well, AABB-gated and clipped by the canvas — same
        // reasoning as the draw loop above.
        if (sc.kind === "flag_box" && bboxInWindow(sc)) {
          const left = Math.min(toX(sc.u1), toX(sc.u2));
          const top = Math.min(toY(sc.v1), toY(sc.v2));
          const w = Math.abs(toX(sc.u2) - toX(sc.u1));
          const h = Math.abs(toY(sc.v2) - toY(sc.v1));
          ctx.strokeRect(left - 3, top - 3, w + 6, h + 6);
        }
        for (const [pu, pv] of selectionHandles(sc)) {
          if (!inWindow(pu, pv)) continue;
          ctx.beginPath();
          ctx.arc(toX(pu), toY(pv), 12, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // Live polygon ghost in the magnified panel — a small flag is traced HERE, so
    // the outline has to be visible here. AABB-gated on the placed vertices for the
    // same reason as committed masks: a big outline can enclose the window with no
    // vertex inside it. Vertices outside are clipped by the canvas.
    if (polygon.kind === "active") {
      const b = maskBounds(polygonRings(polygon));
      if (b && bboxInWindow(b)) {
        drawGhostPolygon(
          ctx,
          polygon.vertices.map((p) => [toX(p.u), toY(p.v)] as [number, number]),
          toX(cursor.u),
          toY(cursor.v),
          polygon.transect
        );
      }
    }

    // Live ghost line / rubber-band rect in the zoom panel (the anchored corner
    // may be off-window; canvas clips it). Cursor maps to the panel center.
    if (pending.kind === "awaitingSecond") {
      const ghost = pending.type === "box" ? drawGhostRect : drawGhostLine;
      ghost(
        ctx,
        toX(pending.first.u),
        toY(pending.first.v),
        toX(cursor.u),
        toY(cursor.v),
        pending.transect
      );
    }

    // Center reticle: dark halo under a bright core, with a small gap at the
    // exact center so the targeted pixel stays visible.
    const rcx = cssW / 2;
    const rcy = cssH / 2;
    const gap = CROSSHAIR_GAP;
    const strokeReticle = () => {
      ctx.beginPath();
      ctx.moveTo(0, rcy);
      ctx.lineTo(rcx - gap, rcy);
      ctx.moveTo(rcx + gap, rcy);
      ctx.lineTo(cssW, rcy);
      ctx.moveTo(rcx, 0);
      ctx.lineTo(rcx, rcy - gap);
      ctx.moveTo(rcx, rcy + gap);
      ctx.lineTo(rcx, cssH);
      ctx.stroke();
    };
    ctx.lineCap = "round";
    ctx.strokeStyle = CROSSHAIR_HALO_COLOR;
    ctx.lineWidth = 3;
    strokeReticle();
    ctx.strokeStyle = CROSSHAIR_CORE_COLOR;
    ctx.lineWidth = 1;
    strokeReticle();
  }, [
    image,
    clicks,
    cursor,
    zoomRadius,
    selectedIdx,
    pending,
    polygon,
    activeCandidate,
    prompt,
  ]);

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
  // adds a dot immediately; a span places sequentially:
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
        // A box canonicalizes to top-left/bottom-right (min/max per axis); the
        // spans only reorder their two points. Different operations, so the
        // branch picks the matching helper — see canonicalizeBox.
        const ep =
          spanType === "box"
            ? canonicalizeBox(pending.first, { u, v })
            : canonicalizeSpan(spanType, pending.first, { u, v });
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
    const { candidate, existingIndex, alsoRemoveIdx } = pendingCollision;
    setClicks((prev) => [
      ...prev.filter((_, i) => i !== existingIndex && i !== alsoRemoveIdx),
      candidate,
    ]);
    // Replace = filter + append, which shifts every index above existingIndex —
    // so a live SAM3 session's targetIdx would silently point at a different
    // annotation and Accept would write the mask onto the wrong flag.
    endSessions();
    setDirty(true);
    setPendingCollision(null);
  }, [pendingCollision, canEdit, endSessions]);

  const resolveCollisionKeepBoth = useCallback(() => {
    if (!canEdit) return; // web: blocked while another labeler holds the lock
    if (!pendingCollision) return;
    const { candidate, alsoRemoveIdx } = pendingCollision;
    setClicks((prev) => [
      ...prev.filter((_, i) => i !== alsoRemoveIdx),
      candidate,
    ]);
    setDirty(true);
    setPendingCollision(null);
  }, [pendingCollision, canEdit]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const p = mainCanvasEventToImageCoords(e);
      if (!p || !image || !containerRef.current) return;
      // While a SAM3 session is live, a click is a REFINEMENT PROMPT, not a
      // placement or a selection: plain = positive, ⇧ = negative. Intercepted
      // before hit-testing so the session owns the canvas until Enter or Esc.
      if (prompt.kind === "active") {
        addPromptClick(p.u, p.v, e.shiftKey ? 0 : 1);
        return;
      }
      // With the polygon tool up, every click is a vertex — no hit-testing, no
      // deselect. Selecting or deleting a finished mask is the Y tool's job.
      // Returning here also narrows `activeType` back to a real annotation kind for
      // the hitTest call below, which cannot accept the "polygon" tool value.
      if (activeType === "polygon") {
        addPolygonVertex(p.u, p.v);
        return;
      }
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
      prompt,
      addPromptClick,
      addPolygonVertex,
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
      // Refinement prompts can be placed in the magnified panel too — that's where
      // a distant flag is actually visible. Same polarity rule (⇧ = negative).
      if (prompt.kind === "active") {
        addPromptClick(u, v, e.shiftKey ? 0 : 1);
        return;
      }
      // Polygon vertices can be placed in the magnified panel too — that is where a
      // distant flag's outline is actually visible. Below the in-image bounds check
      // above on purpose, so a click in the off-image black band adds nothing.
      if (activeType === "polygon") {
        addPolygonVertex(u, v);
        return;
      }
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
    [
      image,
      cursor,
      zoomRadius,
      placeAt,
      clicks,
      selectedIdx,
      activeType,
      pending,
      prompt,
      addPromptClick,
      addPolygonVertex,
    ]
  );

  // Wire-ground L/C/R breakdown (countsFromAnnotations already filters to
  // wire-ground, so spans never inflate these counts).
  const counts = countsFromAnnotations(clicks);
  const wireGroundCount = counts.L + counts.C + counts.R;
  // Per-non-wire-ground-kind tally in a single pass (the three spans, the box, and
  // the mask). Keyed on Exclude<…, "wire_ground"> rather than Span["kind"] because
  // a mask is not a two-endpoint kind — that keeps the Record compiler-enforced
  // over exactly the kinds this loop can see, so a new kind hard-errors here.
  const spanCounts = clicks.reduce<
    Record<Exclude<Annotation["kind"], "wire_ground">, number>
  >(
    (acc, c) => {
      if (c.kind !== "wire_ground") acc[c.kind]++;
      return acc;
    },
    {
      vertical_span: 0,
      horizontal_span: 0,
      flag_to_ground_span: 0,
      flag_box: 0,
      flag_mask: 0,
    }
  );
  const verticalSpanCount = spanCounts.vertical_span;
  const horizontalSpanCount = spanCounts.horizontal_span;
  const flagToGroundSpanCount = spanCounts.flag_to_ground_span;
  const boxCount = spanCounts.flag_box;
  const maskCount = spanCounts.flag_mask;

  // Getting-started checklist progress, tracked from live app state (web only).
  const obChecklistItems = [
    { label: "Open an image", done: !!image },
    {
      label: (
        <>
          Place your first wire-ground point <kbd>Q</kbd>
        </>
      ),
      done: wireGroundCount > 0,
    },
    {
      label: (
        <>
          Add a flag span <kbd>W</kbd>
          <kbd>E</kbd>
          <kbd>R</kbd>
        </>
      ),
      done:
        verticalSpanCount + horizontalSpanCount + flagToGroundSpanCount > 0,
    },
  ];

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
        {/* Single merged header. The brand lockup (logo + wordmark) anchors the
            left on both web and desktop; on web the account email + Sign out are
            bookended at the far right (they used to be a separate bar). */}
        <div className="brand">
          <FlagLogo className="brand-mark" />
          <span className="brand-name">FlagLabel</span>
        </div>
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
        {(image || account) && (
          <div className="title-actions">
            {image && (
              <>
                <button
                  className="title-btn"
                  onClick={handleUndo}
                  disabled={!canUndo}
                  title="Undo last click (⌘Z)"
                >
                  <kbd>{MOD_KEY}Z</kbd>Undo
                </button>
                <button
                  className="title-btn"
                  onClick={handleRedo}
                  disabled={redoStack.length === 0 || !canEdit}
                  title="Redo (⌘⇧Z)"
                >
                  <kbd>{MOD_KEY}⇧Z</kbd>Redo
                </button>
                <button
                  className="title-btn primary"
                  onClick={handleSave}
                  disabled={!dirty || !canEdit}
                  title="Save (⌘S)"
                >
                  <kbd>{MOD_KEY}S</kbd>Save
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
                {/* Open file / Open folder fire native OS dialogs — desktop only.
                    On web, images come from the explorer + upload modal instead. */}
                {isTauri() && (
                  <>
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
                  </>
                )}
                {/* Web has no native menu bar, so the keyboard-help overlay would
                    be unreachable except via the (undiscoverable) ? key. */}
                {!isTauri() && (
                  <>
                    <span className="title-divider" aria-hidden />
                    <button
                      className="title-btn"
                      onClick={() => setShowHelp(true)}
                      title="Keyboard shortcuts & guide (?)"
                      aria-label="Keyboard shortcuts and guide"
                    >
                      <kbd>?</kbd> Help
                    </button>
                  </>
                )}
              </>
            )}
            {/* Account bookend (web). Always present so Sign out stays reachable
                even at the empty state, where no image actions render. */}
            {account && (
              <>
                {image && <span className="title-divider" aria-hidden />}
                <span className="title-account">
                  <span className="title-account-email" title={account.email}>
                    {account.email}
                  </span>
                  {isAdmin && (
                    <button
                      className="title-btn ghost"
                      onClick={() => setAdminPanelOpen(true)}
                      title="Manage users"
                    >
                      Admin
                    </button>
                  )}
                  <button
                    className="title-btn ghost"
                    onClick={account.signOut}
                    title="Sign out of FlagLabel"
                  >
                    Sign out
                  </button>
                </span>
              </>
            )}
          </div>
        )}
      </header>

      <section
        className={`workarea ${
          (isTauri() ? folderImages.length > 0 : true) ? "with-folder" : ""
        } ${image ? "with-rail" : ""}`}
      >
        {(isTauri() ? folderImages.length > 0 : true) && (
          <aside className="folder-sidebar" data-tour-id="tour-explorer">
            <div className="folder-header">
              {(() => {
                // Overall completion. Desktop counts locally-labeled images; web
                // reads the shared-dataset summary.
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
                const bar = (
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
                );

                // Desktop: the open folder's name over a meter + count.
                if (isTauri()) {
                  return (
                    <>
                      <div className="folder-head-top">
                        <span className="folder-title" title={folderDir ?? ""}>
                          {folderDir ? pathBasename(folderDir) : ""}
                        </span>
                      </div>
                      <div className="folder-progress">
                        {bar}
                        <span
                          className="folder-progress-count"
                          title="labeled / total"
                        >
                          <span className="mono">{annotated}</span>/
                          <span className="mono">{total}</span>
                        </span>
                      </div>
                    </>
                  );
                }

                // Web: one instrument-style readout row (label · meter · %), then
                // the admin actions as anchored buttons below.
                return (
                  <>
                    <div className="folder-head-readout">
                      <span className="folder-head-label">Dataset</span>
                      {bar}
                      <span className="folder-head-pct">{Math.round(pct)}%</span>
                    </div>
                    {canManageDataset && (
                      <div className="folder-head-actions">
                        <button
                          type="button"
                          className="folder-action-btn folder-action-grow"
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
                          JSON
                        </button>
                        <button
                          type="button"
                          className="folder-action-btn"
                          onClick={handleDownloadDataset}
                          disabled={datasetExporting}
                          title="Download all annotated images and their JSON as one ZIP"
                        >
                          <DownloadIcon />
                          {datasetExporting ? "Zipping…" : "Images"}
                        </button>
                      </div>
                    )}
                  </>
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
                No folders yet. Click New folder to create a site (camera), then add its images.
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
                          canManageDataset
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
                            {canManageDataset && (
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
                              {canManageDataset ? " — click + to add some." : "."}
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
                                    canManageDataset
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
              {isTauri() ? (
                <button className="btn" onClick={handleOpen}>
                  Try another image
                </button>
              ) : (
                <span className="hint">
                  Pick another image from the explorer on the left.
                </span>
              )}
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
                  Each transect carries 15 flags, 1 m apart. For every flag,
                  pick its transect <kbd>1</kbd>–<kbd>3</kbd> and its distance{" "}
                  <kbd>↑</kbd>
                  <kbd>↓</kbd> (1–15) first, then choose a tool and click.
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
                        No images in the shared dataset yet — create a folder (camera) and add its images to begin.
                      </span>
                    )}
                    {folderImages.length > 0 && (
                      <span className="hint">
                        Pick an image from the explorer on the left to begin.
                      </span>
                    )}
                    {canManageDataset && (
                      <div className="state-buttons">
                        <button className="btn primary" onClick={openNewFolder}>
                          New folder
                        </button>
                      </div>
                    )}
                    <span className="hint">
                      <button
                        className="link"
                        onClick={() => setShowHelp(true)}
                        type="button"
                      >
                        <kbd>?</kbd> shortcuts &amp; guide
                      </button>
                    </span>
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
            <div className="zoom-panel" data-tour-id="tour-zoom">
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
              <div className="rail-section" data-tour-id="tour-transect">
                <div className="rail-label">
                  <span>Transect</span>
                  <span className="key-hint">1 · 2 · 3</span>
                </div>
                <div className="segmented">
                  {TRANSECTS.map((t, i) => {
                    const active = currentTransect === t;
                    const color = TRANSECT_COLORS[t];
                    return (
                      <button
                        key={t}
                        className={`segmented-btn transect-btn ${
                          active ? "active" : ""
                        }`}
                        style={
                          active
                            ? {
                                borderColor: color,
                                color,
                                background: `${color}22`,
                              }
                            : undefined
                        }
                        onClick={() => setCurrentTransect(t)}
                      >
                        <span className="seg-letter">{t}</span>
                        <span className="seg-key">{i + 1}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rail-section" data-tour-id="tour-distance">
                <div className="rail-label">
                  <span>Distance</span>
                  <span className="key-hint">↑ · ↓</span>
                </div>
                <div className="distance-stepper">
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
                    className="distance-value"
                    aria-label="Distance"
                  />
                  <div className="distance-spin">
                    <button
                      type="button"
                      className="distance-spin-btn"
                      onClick={() =>
                        setCurrentDistance((d) =>
                          Math.min(99.9, +(d + 1).toFixed(1))
                        )
                      }
                      aria-label="Increase distance"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="distance-spin-btn"
                      onClick={() =>
                        setCurrentDistance((d) => Math.max(0, +(d - 1).toFixed(1)))
                      }
                      aria-label="Decrease distance"
                    >
                      ▼
                    </button>
                  </div>
                </div>
              </div>

              <div className="rail-section" data-tour-id="tour-tool">
                <div className="rail-label">
                  <span>Tool</span>
                  <span className="key-hint">
                    {visibleTools.map((t) => t.key).join(" · ")}
                  </span>
                </div>
                <div className="segmented tool-grid">
                  {visibleTools.map((tool) => (
                    <button
                      key={tool.kind}
                      className={`segmented-btn ${
                        activeType === tool.kind ? "tool-active" : ""
                      }`}
                      onClick={() => selectTool(tool.kind)}
                      title={tool.title}
                      aria-pressed={activeType === tool.kind}
                    >
                      <kbd className="tool-key">{tool.key}</kbd>
                      <span className="tool-name">{tool.label}</span>
                    </button>
                  ))}
                </div>
                <p className="tool-help" aria-live="polite">
                  {/* A polygon keeps the transect/distance its FIRST click captured,
                      and is deliberately NOT cancelled when the rail selection
                      changes (losing 30 traced vertices to a stray arrow key would
                      be hostile) — so the live hint names the captured pair, which
                      is the only place that divergence is visible. */}
                  {polygon.kind === "active"
                    ? `${polygon.transect}${fmtDistance(polygon.distance)} polygon · ${
                        polygon.vertices.length
                      } point${polygon.vertices.length === 1 ? "" : "s"} · ${
                        canClose(polygon)
                          ? "↵ closes it"
                          : `${POLYGON_MIN_VERTICES - polygon.vertices.length} more to close`
                      } · Del undoes · Esc cancels`
                    : pending.kind === "awaitingSecond"
                    ? "Click the second point to finish · Esc to cancel"
                    : KIND_HINT[activeType]}
                </p>
              </div>

              {/* SAM3 segmentation — the whole section, service URL included, is
                  part of the admin-only mask tooling (see ADMIN_ONLY_TOOLS). For an
                  admin it is always mounted so the URL is reachable before anything
                  is selected; the session controls below only appear once a prompt
                  is live. */}
              {adminTools && (
                <div className="rail-section">
                  <div className="rail-label">
                    <span>Segment</span>
                    <span className="key-hint">M</span>
                  </div>
                  {prompt.kind === "active" ? (
                    <>
                      <div className="mask-candidates">
                        {maskBusy ? (
                          <span className="mask-status">Segmenting…</span>
                        ) : maskCandidates.length > 0 ? (
                          <span className="mask-status">
                            candidate {maskCandidateIdx + 1}/{maskCandidates.length}
                            {" · "}
                            <span className="mono">
                              {maskCandidates[maskCandidateIdx]?.score.toFixed(2)}
                            </span>
                          </span>
                        ) : (
                          <span className="mask-status">no candidate</span>
                        )}
                      </div>
                      <div className="mask-actions">
                        <button
                          type="button"
                          className="btn"
                          onClick={cycleMaskCandidate}
                          disabled={maskCandidates.length < 2}
                          title="Cycle to the next candidate (C)"
                        >
                          <kbd>C</kbd>Cycle
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={acceptMaskCandidate}
                          disabled={
                            !canEdit ||
                            maskBusy ||
                            !activeCandidate ||
                            activeCandidate.rings.length === 0
                          }
                          title="Accept this candidate as a mask (Enter)"
                        >
                          <kbd>↵</kbd>Accept
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={endMaskSession}
                          title="Discard this candidate (Esc)"
                        >
                          <kbd>Esc</kbd>Cancel
                        </button>
                      </div>
                      <p className="tool-help" aria-live="polite">
                        Click to add a <strong>positive</strong> point ·{" "}
                        <kbd>⇧</kbd>click for <strong>negative</strong> ·{" "}
                        <kbd>Del</kbd> undoes the last point.{" "}
                        {prompt.clicks.length > 0 &&
                          `${prompt.clicks.length} point${
                            prompt.clicks.length === 1 ? "" : "s"
                          }.`}
                      </p>
                    </>
                  ) : (
                    <p className="tool-help">
                      Select a flag box (<kbd>T</kbd>) and press <kbd>M</kbd> to
                      segment it.
                    </p>
                  )}
                  {maskError && (
                    <p className="mask-error" role="alert">
                      {maskError}
                    </p>
                  )}
                  {/* Service URL. Persisted on desktop via the settings store; on
                      web it is per-session (there is no store there). */}
                  <input
                    type="text"
                    className="sam3-url"
                    value={sam3Url}
                    spellCheck={false}
                    onChange={(e) => updateSam3Url(e.currentTarget.value)}
                    aria-label="SAM3 service URL"
                    title="Base URL of the SAM3 service (the local end of the SSH tunnel)"
                  />
                </div>
              )}
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
                  <span className="sep">·</span>
                  <span className="lbl">B</span>
                  <span className="mono total">{boxCount}</span>
                  <span className="sep">·</span>
                  <span className="lbl">M</span>
                  <span className="mono total">{maskCount}</span>
                </div>
                {clicks.length > 0 && (
                  <button
                    className="clear-link"
                    onClick={handleClear}
                    disabled={!canEdit}
                  >
                    clear all
                  </button>
                )}
              </div>
            </div>
          </aside>
        )}
      </section>

      {showHelp && (
        <KeyboardHelp
          onClose={() => setShowHelp(false)}
          appVersion={appVersion}
          adminTools={adminTools}
          {...(!isTauri()
            ? {
                onReplayWelcome: () => {
                  setShowHelp(false);
                  resetObWelcome();
                  setObStage("welcome");
                },
                onStartTour: () => {
                  setShowHelp(false);
                  setObStage("tour");
                },
                onResetChecklist: () => {
                  setShowHelp(false);
                  resetObChecklist();
                  setObChecklistDismissedState(false);
                },
              }
            : {})}
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

      {/* Web: right-click context menu for a folder/image row (any team member). */}
      {!isTauri() && canManageDataset && ctxMenu && (
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
      {!isTauri() && canManageDataset && deleteTarget && (
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
        canManageDataset &&
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

      {/* Web-only admin user-management panel. */}
      {!isTauri() && adminPanelOpen && account && (
        <AdminPanel
          currentEmail={account.email}
          maskTools={maskTools}
          onClose={() => setAdminPanelOpen(false)}
        />
      )}

      {/* Web-only coordinated onboarding: welcome walkthrough, product tour, and
          getting-started checklist. Gated on the platform; never mounts on desktop. */}
      {!isTauri() && (
        <>
          {obStage === "welcome" && (
            <WelcomeModal
              onFinish={() => {
                markObWelcomeSeen();
                setObStage("none");
              }}
              onStartTour={() => setObStage("tour")}
            />
          )}
          {obStage === "tour" && (
            <ProductTour
              onClose={() => {
                markObWelcomeSeen();
                setObStage("none");
              }}
            />
          )}
          {obStage === "none" &&
            !obChecklistDismissed &&
            obChecklistItems.some((i) => !i.done) && (
              <GettingStartedChecklist
                items={obChecklistItems}
                onDismiss={() => {
                  markObChecklistDismissed();
                  setObChecklistDismissedState(true);
                }}
              />
            )}
        </>
      )}
    </main>
  );
}

export default App;
