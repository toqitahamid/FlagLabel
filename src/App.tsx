import { useCallback, useEffect, useRef, useState } from "react";
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

type Transect = "L" | "C" | "R";

type Click = {
  u: number;
  v: number;
  transect: Transect;
  distance: number;
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

type Counts = { L: number; C: number; R: number };

function countsFromClicks(cs: Click[]): Counts {
  const out: Counts = { L: 0, C: 0, R: 0 };
  for (const c of cs) out[c.transect]++;
  return out;
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

function hitTestClick(
  u: number,
  v: number,
  cs: Click[],
  effScale: number
): number | null {
  // Radius converted into image space so the on-screen target stays roughly
  // constant regardless of zoom level.
  const radiusImg = HIT_TEST_RADIUS_CSS_PX / effScale;
  let bestIdx: number | null = null;
  let bestD2 = radiusImg * radiusImg;
  for (let i = 0; i < cs.length; i++) {
    const dx = cs[i].u - u;
    const dy = cs[i].v - v;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function buildClickFile(
  image: LoadedImage,
  clicks: Click[],
  appVersion: string
) {
  return {
    site: siteFromPath(image.path),
    image: pathBasename(image.path),
    image_w: image.width,
    image_h: image.height,
    click_type: "wire_ground_intersection",
    note: "Click at the wire-ground intersection (base), not the flag head.",
    created_at: new Date().toISOString(),
    app_version: appVersion,
    clicks: clicks.map((c) => ({
      u: c.u,
      v: c.v,
      transect: c.transect,
      distance: c.distance,
    })),
  };
}

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
      ["Transect L / C / R", "1 / 2 / 3"],
      ["Distance ± 1 m", "↑ / ↓"],
      ["Distance ± 0.5 m", "⇧↑ / ⇧↓"],
      ["Toggle auto-advance 1→15", "a"],
    ],
  },
  {
    title: "Editing",
    rows: [
      ["Undo last click", "⌘Z"],
      ["Clear all (current image)", "clear all link"],
      ["Select a click (click on its dot)", "mouse"],
      ["Remove selected click", "Del / ⌫"],
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

function DistanceSparkline({ clicks }: { clicks: Click[] }) {
  const bins: Counts[] = Array.from({ length: 15 }, () => ({
    L: 0,
    C: 0,
    R: 0,
  }));
  for (const c of clicks) {
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

function drawMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  c: Click,
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

  const label = `${c.transect}${fmtDistance(c.distance)}`;
  ctx.font = "600 9px 'Geist Mono', ui-monospace, monospace";
  ctx.textBaseline = "alphabetic";
  const w = ctx.measureText(label).width;
  const labelX = x + r + 3;
  const labelY = y - r;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(labelX - 3, labelY - 9, w + 6, 12);
  ctx.fillStyle = "#fafafa";
  ctx.fillText(label, labelX, labelY);
}

function App() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clicks, setClicks] = useState<Click[]>([]);
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
          const data = JSON.parse(content);
          if (!Array.isArray(data.clicks)) continue;
          result[path] = countsFromClicks(data.clicks as Click[]);
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
        const data = JSON.parse(content);
        if (Array.isArray(data.clicks)) {
          setClicks(data.clicks as Click[]);
          setDirty(false);
          setLastSavedAt(Date.now());
        }
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
    const data = buildClickFile(image, clicks, appVersion);
    const content = JSON.stringify(data, null, 2);
    try {
      await invoke("write_text_file", { path, content });
      setLastSavedAt(Date.now());
      setDirty(false);
      setImageCounts((prev) => ({
        ...prev,
        [image.path]: countsFromClicks(clicks),
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
    deleteSelected,
    retagSelected,
    adjustSelectedDistance,
    zoomByFactor,
    resetView,
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
        const x = offsetX + c.u * effScale;
        const y = offsetY + c.v * effScale;
        drawMarker(ctx, x, y, c, viewScale);
      }

      if (selectedIdx !== null && clicks[selectedIdx]) {
        const sc = clicks[selectedIdx];
        const x = offsetX + sc.u * effScale;
        const y = offsetY + sc.v * effScale;
        ctx.beginPath();
        ctx.arc(x, y, 10 + 2 * viewScale, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
  }, [image, clicks, selectedIdx, viewScale, viewPanX, viewPanY]);

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
    const cu = Math.max(r, Math.min(image.width - r, cursor.u));
    const cv = Math.max(r, Math.min(image.height - r, cursor.v));
    const sx = cu - r;
    const sy = cv - r;
    const sw = 2 * r;
    const sh = 2 * r;
    const zoomScale = cssW / sw;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cssW, cssH);

    for (const c of clicks) {
      if (c.u < sx || c.u > sx + sw || c.v < sy || c.v > sy + sh) continue;
      const x = (c.u - sx) * zoomScale;
      const y = (c.v - sy) * zoomScale;
      drawMarker(ctx, x, y, c, zoomScale);
    }

    if (selectedIdx !== null && clicks[selectedIdx]) {
      const sc = clicks[selectedIdx];
      if (sc.u >= sx && sc.u <= sx + sw && sc.v >= sy && sc.v <= sy + sh) {
        const x = (sc.u - sx) * zoomScale;
        const y = (sc.v - sy) * zoomScale;
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
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
  }, [image, clicks, cursor, zoomRadius, selectedIdx]);

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
      setClicks((prev) => [
        ...prev,
        { u, v, transect: currentTransect, distance: currentDistance },
      ]);
      setDirty(true);
      if (autoAdvance) {
        const intDist = Math.round(currentDistance);
        const idx = CANONICAL_DISTANCES.indexOf(intDist);
        if (idx >= 0 && idx + 1 < CANONICAL_DISTANCES.length) {
          setCurrentDistance(CANONICAL_DISTANCES[idx + 1]);
        }
      }
    },
    [currentTransect, currentDistance, autoAdvance]
  );

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
      const hit = hitTestClick(p.u, p.v, clicks, effScale);
      if (hit !== null) {
        setSelectedIdx(hit);
        return;
      }
      if (selectedIdx !== null) {
        setSelectedIdx(null);
        return;
      }
      addClickAt(p.u, p.v);
    },
    [
      mainCanvasEventToImageCoords,
      addClickAt,
      clicks,
      selectedIdx,
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
      const cu = Math.max(r, Math.min(image.width - r, cursor.u));
      const cv = Math.max(r, Math.min(image.height - r, cursor.v));
      const sx = cu - r;
      const sy = cv - r;
      const sw = 2 * r;
      const sh = 2 * r;
      const u = sx + (zx / ZOOM_PANEL_PX) * sw;
      const v = sy + (zy / ZOOM_PANEL_PX) * sh;
      // Zoom-panel effective scale: ZOOM_PANEL_PX CSS-px maps to (2*r) image-px.
      const hit = hitTestClick(u, v, clicks, ZOOM_PANEL_PX / (2 * r));
      if (hit !== null) {
        setSelectedIdx(hit);
        return;
      }
      if (selectedIdx !== null) {
        setSelectedIdx(null);
        return;
      }
      addClickAt(u, v);
    },
    [image, cursor, zoomRadius, addClickAt, clicks, selectedIdx]
  );

  const counts: Record<Transect, number> = { L: 0, C: 0, R: 0 };
  for (const c of clicks) counts[c.transect]++;

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
                          ? countsFromClicks(clicks)
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
                const liveCounts = isActive ? countsFromClicks(clicks) : null;
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

            <div className="rail-middle">
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

              <div className="rail-section">
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
            </div>

            <div className="rail-bottom">
              <div className="rail-section counts">
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
                  <span className="mono total">{clicks.length}</span>
                  <span className="lbl">clicks</span>
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
