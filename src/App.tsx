import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { ask, open } from "@tauri-apps/plugin-dialog";
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

function buildClickFile(image: LoadedImage, clicks: Click[]) {
  return {
    site: siteFromPath(image.path),
    image: pathBasename(image.path),
    image_w: image.width,
    image_h: image.height,
    click_type: "wire_ground_intersection",
    note: "Click at the wire-ground intersection (base), not the flag head.",
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

function drawMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  c: Click,
  scale: number
) {
  const color = TRANSECT_COLORS[c.transect];
  const r = Math.max(4, Math.min(7, 5 * Math.sqrt(scale)));
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
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [zoomRadius, setZoomRadius] = useState<number>(ZOOM_DEFAULT);

  const [currentTransect, setCurrentTransect] = useState<Transect>("L");
  const [currentDistance, setCurrentDistance] = useState<number>(1);
  const [autoAdvance, setAutoAdvance] = useState<boolean>(true);

  const [clicksDir, setClicksDir] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState<boolean>(false);

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

  // OTA: check for updates on launch (M7 — log only, no UI yet)
  useEffect(() => {
    (async () => {
      try {
        const update = await check();
        if (update) {
          console.log(
            `[updater] update available: ${update.version} (current: ${update.currentVersion})`
          );
        } else {
          console.log("[updater] no updates available");
        }
      } catch (e) {
        console.log("[updater] check failed:", e);
      }
    })();
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
    setError(null);
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png"] }],
    });
    if (!selected || Array.isArray(selected)) return;

    const url = convertFileSrc(selected);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setClicks([]);
      setCursor(null);
      setCurrentDistance(1);
      setDirty(false);
      setLastSavedAt(null);
      setImage({
        path: selected,
        url,
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
    };
    img.onerror = () => {
      imgRef.current = null;
      setImage(null);
      setError(selected);
    };
    img.src = url;
  }, [dirty, clicks.length]);

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
    if (!image || clicks.length === 0) return;
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
    const data = buildClickFile(image, clicks);
    const content = JSON.stringify(data, null, 2);
    try {
      await invoke("write_text_file", { path, content });
      setLastSavedAt(Date.now());
      setDirty(false);
    } catch (e) {
      console.error("Save failed", e);
    }
  }, [image, clicks, clicksDir]);

  const handleUndo = useCallback(() => {
    setClicks((prev) => {
      if (prev.length === 0) return prev;
      return prev.slice(0, -1);
    });
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
      setDirty(true);
    }
  }, [clicks.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const inInput = e.target instanceof HTMLInputElement;
      const cmd = e.metaKey || e.ctrlKey;

      // Global shortcuts — work even in inputs
      if (cmd && e.key.toLowerCase() === "o") {
        e.preventDefault();
        handleOpen();
        return;
      }
      if (cmd && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
        return;
      }

      if (inInput) return;

      if (cmd && e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleUndo();
      } else if (e.key === "1") {
        e.preventDefault();
        setCurrentTransect("L");
      } else if (e.key === "2") {
        e.preventDefault();
        setCurrentTransect("C");
      } else if (e.key === "3") {
        e.preventDefault();
        setCurrentTransect("R");
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.shiftKey ? 0.5 : 1;
        setCurrentDistance((d) => Math.min(99.9, +(d + step).toFixed(1)));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const step = e.shiftKey ? 0.5 : 1;
        setCurrentDistance((d) => Math.max(0, +(d - step).toFixed(1)));
      } else if (e.key === " ") {
        e.preventDefault();
        setAutoAdvance((a) => !a);
      } else if (e.key === "[") {
        e.preventDefault();
        setZoomRadius((r) => Math.max(ZOOM_MIN, r - 5));
      } else if (e.key === "]") {
        e.preventDefault();
        setZoomRadius((r) => Math.min(ZOOM_MAX, r + 5));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleOpen, handleSave, handleUndo]);

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

      const scale = Math.min(cw / image!.width, ch / image!.height);
      const drawW = image!.width * scale;
      const drawH = image!.height * scale;
      const offsetX = (cw - drawW) / 2;
      const offsetY = (ch - drawH) / 2;

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
        const x = offsetX + c.u * scale;
        const y = offsetY + c.v * scale;
        drawMarker(ctx, x, y, c, 1);
      }
    }

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
  }, [image, clicks]);

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
  }, [image, clicks, cursor, zoomRadius]);

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
      const scale = Math.min(cw / image.width, ch / image.height);
      const drawW = image.width * scale;
      const drawH = image.height * scale;
      const offsetX = (cw - drawW) / 2;
      const offsetY = (ch - drawH) / 2;
      if (
        cssX < offsetX ||
        cssX > offsetX + drawW ||
        cssY < offsetY ||
        cssY > offsetY + drawH
      ) {
        return null;
      }
      return {
        u: (cssX - offsetX) / scale,
        v: (cssY - offsetY) / scale,
      };
    },
    [image]
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
      if (!p) return;
      addClickAt(p.u, p.v);
    },
    [mainCanvasEventToImageCoords, addClickAt]
  );

  const handleCanvasMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const p = mainCanvasEventToImageCoords(e);
      if (!p) return;
      setCursor(p);
    },
    [mainCanvasEventToImageCoords]
  );

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
      addClickAt(u, v);
    },
    [image, cursor, zoomRadius, addClickAt]
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
        <span className="app-name">FlagLabel</span>
        {image && (
          <span className="title-info">
            <span className="sep">·</span>
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
      </header>

      <section className={`workarea ${image ? "with-rail" : ""}`}>
        <div className="canvas-container" ref={containerRef}>
          {image ? (
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              onMouseMove={handleCanvasMove}
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
              <button className="btn primary" onClick={handleOpen}>
                Open an image
              </button>
              <span className="hint">
                or press <kbd>⌘O</kbd>
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
                              color: "#0c0c0d",
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
                <span className="key-hint">space</span>
              </label>
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

            <div className="rail-spacer" />

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

            <div className="rail-section actions">
              <button
                className="btn"
                onClick={handleUndo}
                disabled={clicks.length === 0}
                title="⌘Z"
              >
                Undo
              </button>
              <button
                className="btn primary"
                onClick={handleSave}
                disabled={clicks.length === 0 || !dirty}
                title="⌘S"
              >
                Save
              </button>
            </div>

            {clicks.length > 0 && (
              <button className="clear-link" onClick={handleClear}>
                clear all
              </button>
            )}
          </aside>
        )}
      </section>

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
          </>
        ) : (
          <span>no image</span>
        )}
      </footer>
    </main>
  );
}

export default App;
