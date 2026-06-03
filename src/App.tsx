import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
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

function clickFilename(image: LoadedImage): string {
  return `${siteFromPath(image.path)}__${stemFromPath(image.path)}.json`;
}

function expectedJsonPath(image: LoadedImage, clicksDir: string): string {
  return joinPath(clicksDir, clickFilename(image));
}

function clickJsonPathFor(imagePath: string, clicksDir: string): string {
  const name = `${siteFromPath(imagePath)}__${stemFromPath(imagePath)}.json`;
  return joinPath(clicksDir, name);
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
      ["Toggle auto-advance 1→15", "a"],
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
      ["Retag selected click L / C / R", "1 / 2 / 3"],
      ["Adjust selected click distance", "↑ / ↓"],
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

function DistanceSparkline({ clicks }: { clicks: Annotation[] }) {
  const bins: Counts[] = Array.from({ length: 15 }, () => ({
    L: 0,
    C: 0,
    R: 0,
  }));
  for (const c of clicks) {
    // Sparkline summarizes wire-ground distances only; spans are excluded.
    if (c.kind !== "wire_ground") continue;
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

  const [appVersion, setAppVersion] = useState<string>("");
  const [showHelp, setShowHelp] = useState<boolean>(false);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const zoomCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const storeRef = useRef<Store | null>(null);

  // Load persisted settings on mount
  useEffect(() => {
    (async () => {
      try {
        const s = await Store.load(SETTINGS_FILE);
        storeRef.current = s;
        const dir = await s.get<string>(SETTINGS_KEY_CLICKS_DIR);
        if (typeof dir === "string") setClicksDir(dir);
      } catch (e) {
        console.error("Failed to load settings", e);
      }
    })();
  }, []);

  useEffect(() => {
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

  const loadImage = useCallback((path: string): Promise<void> => {
    return new Promise((resolve) => {
      setError(null);
      const url = convertFileSrc(path);
      const img = new Image();
      img.onload = () => {
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
        imgRef.current = null;
        setImage(null);
        setError(path);
        resolve();
      };
      img.src = url;
    });
  }, []);

  const handleOpen = useCallback(async () => {
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
      const images = await invoke<string[]>("list_images_in_dir", {
        path: selected,
      });
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
    (async () => {
      const result: Record<string, Counts> = {};
      for (const path of folderImages) {
        if (cancelled) return;
        const jsonPath = clickJsonPathFor(path, clicksDir);
        try {
          const content = await invoke<string | null>("read_text_file", {
            path: jsonPath,
          });
          if (!content) continue;
          result[path] = countsFromAnnotations(parseAnnotationFile(JSON.parse(content)));
        } catch (e) {
          console.error("Failed to read", jsonPath, e);
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
    if (!image || !clicksDir) return;
    let cancelled = false;
    (async () => {
      const path = expectedJsonPath(image, clicksDir);
      try {
        const content = await invoke<string | null>("read_text_file", { path });
        if (cancelled || !content) return;
        const anns = parseAnnotationFile(JSON.parse(content));
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
    let dir = clicksDir;
    if (!dir) {
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
    const path = expectedJsonPath(image, dir);
    const meta: FileMeta = {
      site: siteFromPath(image.path),
      image: pathBasename(image.path),
      image_w: image.width,
      image_h: image.height,
    };
    const data = buildAnnotationFile(meta, clicks, appVersion, new Date().toISOString());
    const content = JSON.stringify(data, null, 2);
    try {
      await invoke("write_text_file", { path, content });
      setLastSavedAt(Date.now());
      setDirty(false);
      setImageCounts((prev) => ({
        ...prev,
        [image.path]: countsFromAnnotations(clicks),
      }));
    } catch (e) {
      console.error("Save failed", e);
    }
  }, [image, clicks, clicksDir, appVersion, dirty]);

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

  // F4: auto-save 5s after the last change (only when clicksDir is set)
  useEffect(() => {
    if (!dirty || !image || !clicksDir) return;
    const id = setTimeout(() => {
      handleSave();
    }, 5000);
    return () => clearTimeout(id);
  }, [dirty, clicks, image, clicksDir, handleSave]);

  const handleUndo = useCallback(() => {
    setClicks((prev) => {
      if (prev.length === 0) return prev;
      return prev.slice(0, -1);
    });
    setSelectedIdx(null);
    setDirty(true);
  }, []);

  const handleClear = useCallback(async () => {
    if (clicks.length === 0) return;
    const ok = await ask(
      `Clear all ${clicks.length} click${
        clicks.length === 1 ? "" : "s"
      } for this image?`,
      { title: "Clear clicks", kind: "warning" }
    );
    if (ok) {
      setClicks([]);
      setSelectedIdx(null);
      setDirty(true);
    }
  }, [clicks.length]);

  const deleteSelected = useCallback(() => {
    if (selectedIdx === null) return;
    setClicks((prev) => prev.filter((_, i) => i !== selectedIdx));
    setSelectedIdx(null);
    setDirty(true);
  }, [selectedIdx]);

  const retagSelected = useCallback(
    (t: Transect) => {
      if (selectedIdx === null) return;
      setClicks((prev) =>
        prev.map((c, i) => (i === selectedIdx ? { ...c, transect: t } : c))
      );
      setDirty(true);
    },
    [selectedIdx]
  );

  const adjustSelectedDistance = useCallback(
    (delta: number) => {
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
    [selectedIdx]
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

  // Cursor that matters for the main-canvas repaint: only non-null while a span
  // is mid-placement (drives the ghost line). When idle this is null on every
  // render, so the main-draw effect below does NOT re-run on idle mousemove —
  // the full image + markers are not re-stroked just from hovering.
  const ghostCursor = pending.kind === "awaitingSecond" ? cursor : null;

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

      // Live ghost line from the pending span's first endpoint to the cursor.
      // ghostCursor is non-null only while awaiting the second click.
      if (pending.kind === "awaitingSecond" && ghostCursor) {
        drawGhostLine(
          ctx,
          offsetX + pending.first.u * effScale,
          offsetY + pending.first.v * effScale,
          offsetX + ghostCursor.u * effScale,
          offsetY + ghostCursor.v * effScale,
          pending.transect
        );
      }
    }

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
    // ghostCursor (not cursor) gates repaint: null while idle so idle hover
    // doesn't re-run; the cursor object changes each move while placing.
  }, [image, clicks, selectedIdx, viewScale, viewPanX, viewPanY, pending, ghostCursor]);

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
        return;
      }
      setPendingCollision({ candidate, existingIndex });
    },
    [clicks, applyAutoAdvance]
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
    [activeType, pending, currentTransect, currentDistance, addClickAt, commitAnnotation]
  );

  // Collision-confirm resolvers. The modal is guarded so `clicks` cannot be
  // reordered while open, keeping `existingIndex` valid.
  const resolveCollisionReplace = useCallback(() => {
    if (!pendingCollision) return;
    const { candidate, existingIndex } = pendingCollision;
    setClicks((prev) => [
      ...prev.filter((_, i) => i !== existingIndex),
      candidate,
    ]);
    setDirty(true);
    applyAutoAdvance(candidate);
    setPendingCollision(null);
  }, [pendingCollision, applyAutoAdvance]);

  const resolveCollisionKeepBoth = useCallback(() => {
    if (!pendingCollision) return;
    const { candidate } = pendingCollision;
    setClicks((prev) => [...prev, candidate]);
    setDirty(true);
    applyAutoAdvance(candidate);
    setPendingCollision(null);
  }, [pendingCollision, applyAutoAdvance]);

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
          </span>
        )}
        {image && (
          <div className="title-actions">
            <button
              className="title-btn"
              onClick={handleUndo}
              disabled={clicks.length === 0}
              title="Undo last click (⌘Z)"
            >
              Undo
            </button>
            <button
              className="title-btn primary"
              onClick={handleSave}
              disabled={!dirty}
              title="Save (⌘S)"
            >
              Save
            </button>
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
        className={`workarea ${folderImages.length > 0 ? "with-folder" : ""} ${
          image ? "with-rail" : ""
        }`}
      >
        {folderImages.length > 0 && (
          <aside className="folder-sidebar">
            <div className="folder-header">
              <div className="folder-path" title={folderDir ?? ""}>
                {folderDir ? pathBasename(folderDir) : ""}
              </div>
              <div className="folder-meta">
                <span className="mono">
                  {
                    folderImages.filter((p) => {
                      const c =
                        image?.path === p
                          ? countsFromAnnotations(clicks)
                          : imageCounts[p];
                      return c && c.L + c.C + c.R > 0;
                    }).length
                  }
                </span>
                <span> labeled / </span>
                <span className="mono">{folderImages.length}</span>
                <span> total</span>
              </div>
            </div>
            <ul className="image-list">
              {folderImages.map((path, idx) => {
                const isActive = image?.path === path;
                const liveCounts = isActive ? countsFromAnnotations(clicks) : null;
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
                        <span style={{ color: TRANSECT_COLORS.L }}>
                          {rowCounts.L}
                        </span>
                        <span className="dot">·</span>
                        <span style={{ color: TRANSECT_COLORS.C }}>
                          {rowCounts.C}
                        </span>
                        <span className="dot">·</span>
                        <span style={{ color: TRANSECT_COLORS.R }}>
                          {rowCounts.R}
                        </span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
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
              <div className="state-tagline">
                Mark the wire-ground intersection of each distance flag.
              </div>
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
                  <kbd>?</kbd> shortcuts
                </button>
              </span>
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
                <span className="key-hint">[ ]</span>
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
                <div className="segmented">
                  <button
                    className={`segmented-btn ${
                      activeType === "wire_ground" ? "active" : ""
                    }`}
                    style={
                      activeType === "wire_ground"
                        ? {
                            background: "var(--text-primary)",
                            color: "var(--bg-app)",
                            borderColor: "var(--text-primary)",
                          }
                        : undefined
                    }
                    onClick={() => setActiveType("wire_ground")}
                    title="Wire–ground point (Q)"
                  >
                    Wire–ground
                  </button>
                  <button
                    className={`segmented-btn ${
                      activeType === "vertical_span" ? "active" : ""
                    }`}
                    style={
                      activeType === "vertical_span"
                        ? {
                            background: "var(--text-primary)",
                            color: "var(--bg-app)",
                            borderColor: "var(--text-primary)",
                          }
                        : undefined
                    }
                    onClick={() => setActiveType("vertical_span")}
                    title="Vertical span (W)"
                  >
                    Vert. span
                  </button>
                  <button
                    className={`segmented-btn ${
                      activeType === "horizontal_span" ? "active" : ""
                    }`}
                    style={
                      activeType === "horizontal_span"
                        ? {
                            background: "var(--text-primary)",
                            color: "var(--bg-app)",
                            borderColor: "var(--text-primary)",
                          }
                        : undefined
                    }
                    onClick={() => setActiveType("horizontal_span")}
                    title="Horizontal span (E)"
                  >
                    Horiz. span
                  </button>
                  <button
                    className={`segmented-btn ${
                      activeType === "flag_to_ground_span" ? "active" : ""
                    }`}
                    style={
                      activeType === "flag_to_ground_span"
                        ? {
                            background: "var(--text-primary)",
                            color: "var(--bg-app)",
                            borderColor: "var(--text-primary)",
                          }
                        : undefined
                    }
                    onClick={() => setActiveType("flag_to_ground_span")}
                    title="Flag-to-ground span (R)"
                  >
                    Flag→ground
                  </button>
                </div>
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
                  <span className="key-hint">↑ ↓</span>
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
                  <span className="key-hint">a</span>
                </label>
                <DistanceSparkline clicks={clicks} />
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
                <div className="counts-line">
                  <span style={{ color: TRANSECT_COLORS.L }}>L</span>
                  <span className="mono">{counts.L}</span>
                  <span className="sep">·</span>
                  <span style={{ color: TRANSECT_COLORS.C }}>C</span>
                  <span className="mono">{counts.C}</span>
                  <span className="sep">·</span>
                  <span style={{ color: TRANSECT_COLORS.R }}>R</span>
                  <span className="mono">{counts.R}</span>
                  <span className="eq-sep">=</span>
                  <span className="mono total">{wireGroundCount}</span>
                  <span className="lbl">wire–ground</span>
                </div>
              </div>

              {clicks.length > 0 && (
                <button className="clear-link" onClick={handleClear}>
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
    </main>
  );
}

export default App;
