# FlagLabel user guide

Detailed annotation workflow for FlagLabel. For installation, the keyboard shortcut table, the output format, and SAM3 setup, see the [README](../README.md).

## Workflow

1. **⌘O** to open a single image, or **⌘⇧O** to open a folder and step through it with `←` / `→`.
2. Pick what to mark with **Q / W / E / R / T / Y / P** (or the rail buttons): a **wire–ground point** (`Q`, the default); a **vertical** (`W`), **horizontal** (`E`), or **flag-to-ground** (`R`) span; a **box** (`T`) around the whole flag; an accepted **mask** (`Y`, for selecting one — SAM3 masks are created from a box, see below); or a hand-drawn **polygon** (`P`), which produces a mask by tracing.
   > The **box**, **mask** and **polygon** tools (`T` / `Y` / `P`, and the `M` / `C` mask keys) are granted per user on the web build — not by the admin role. Someone who already has them can grant or revoke access in **Manage users**; the change takes effect the next time the person loads FlagLabel. Boxes and masks already saved in a file stay visible and are preserved on save for everyone.
3. Pick a transect: **L / C / R** (or buttons `1 / 2 / 3`), and set distance with the number input or **↑ / ↓** (hold shift for 0.5 m steps).
4. Place the annotation:
   - **Wire–ground point** — one click at the wire–ground intersection. A colored dot + label (e.g. `L1`) appears on the main image and in the zoom panel.
   - **Spans** — two clicks: the first pins one end, a ghost line follows the cursor, the second completes it. Endpoints can land on either the main image or the zoom panel; **Esc** cancels a half-placed span. Each flag carries the spans independently, so far flags can hold only the ones still visible.
   - **Box** — two clicks on opposite corners, with a live rubber-band rectangle in between. Either corner can go first; the box is stored top-left → bottom-right regardless. Corners can land on either the main image or the zoom panel, and **Esc** cancels a half-drawn box.
   - **Mask** — not clicked directly. Select a box you've drawn and press **M**; the SAM3 service segments the flag inside it and proposes up to three candidate masks. Press **C** to cycle candidates, click to add a positive refinement point (**⇧click** for negative, **Del** to undo the last one), and **Enter** to accept. **Esc** discards without saving anything. The accepted mask inherits the box's transect and distance, and the prompt box is deleted automatically — the mask replaces it. (To re-mask a flag later, draw a fresh box.) See [Mask segmentation](../README.md#optional-sam3-mask-segmentation).
   - **Polygon** — the manual fallback for flags SAM3 can't segment (too small, too far, too low-contrast). Press **P**, then click the flag's outline vertex by vertex; a solid line joins the placed vertices while a dashed segment follows the cursor and a dashed hint shows where the outline would close. **Enter** closes it (3 vertices minimum) into a mask, **Del** / **⌫** removes the last vertex, and **Esc** discards the whole outline. Vertices can land on either the main image or the zoom panel — the panel is usually where a distant flag's edge is actually visible. The transect and distance are captured on the **first** click and kept for the whole outline, so changing the rail selection mid-trace won't retag it; the rail hint shows the pair it will commit with. Hand-drawn masks are stored exactly like segmented ones, but always with `"score": 1` (see [Output format](../README.md#output-format)).
5. **⌘S** to save, or just keep working — annotations auto-save 5 s after the last edit. The first save asks for a folder; that folder is remembered.

Re-opening an image whose JSON already exists in the saved folder auto-loads the previous annotations. In folder mode, the sidebar shows per-image annotation counts so you can see at a glance how much of the batch is done.

### Editing existing annotations

Click on a placed marker or span to select it. While selected:

- **1 / 2 / 3** re-tags it to L / C / R.
- **↑ / ↓** (with ⇧ for 0.5 m) nudges its distance.
- **Delete** / **Backspace** removes it.
- **Esc** clears the selection.

### Zoom and pan

The main image supports trackpad pinch or mouse wheel to zoom around the cursor, and **Space + drag** (or middle-mouse drag) to pan. The 360 px zoom panel on the right stays at its own fixed magnification for precision clicking.

