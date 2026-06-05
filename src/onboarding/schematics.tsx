// Animated SVG schematics shared by the empty-state intro, the keyboard-help
// overlay, and the onboarding welcome modal. Extracted from App.tsx so the
// onboarding components (and their preview harness) can render the real figures
// without pulling in the whole app. Styling lives in App.css (.annotation-guide,
// .ag-*, .transect-guide, .tg-*, .intro-figure*) and is shared globally.

// A small animated schematic of a numbered flag on a wire, showing the four
// annotation types placing themselves in turn: the wire–ground point (Q), the
// vertical (W) and horizontal (E) flag spans, and the full flag-to-ground span
// (R). Pure SVG + CSS; the rolling green highlight is suppressed under
// prefers-reduced-motion, which leaves all four annotations drawn and legible.
export function AnnotationGuide() {
  return (
    <svg
      className="annotation-guide"
      viewBox="0 0 260 184"
      role="img"
      aria-label="An orange survey flag on a thin wire stake. The four annotation types: Q marks the wire–ground point, W spans the flag top to bottom, E spans it left to right, and R spans from the flag top down to the wire base at the ground."
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
      {/* wire stake (solid above ground, dashed where driven in) — runs up the
          flag's left/hoist edge, the way a survey flag is actually attached */}
      <line className="ag-wire" x1="120" y1="30" x2="120" y2="150" />
      <line
        className="ag-wire ag-wire--buried"
        x1="120"
        y1="150"
        x2="120"
        y2="164"
      />
      {/* flag blade — a blaze-orange vinyl square fixed to the stake top, flaring
          out to the fly side. Drawn over the wire so the hoist edge sits on it. */}
      <rect
        className="ag-flag"
        x="120"
        y="30"
        width="50"
        height="40"
        rx="1.5"
      />
      <path className="ag-flag-fold" d="M120 34 Q150 50 168 68" />

      {/* The four annotations are demonstrated ONE AT A TIME, each as the actual
          two-click gesture: a start dot drops (first click), a line grows slowly
          to the end, an end dot lands (second click). Only the active one is
          visible; they cycle Q → W → E → R. Geometry encodes drag direction:
          a line reveals from its (x1,y1) start, so W/R start at the top and E at
          the left. */}

      {/* Q — wire–ground point: a single click, so it just drops a dot. */}
      <g className="ag2 ag2--q">
        <circle className="ag2-start" cx="120" cy="150" r="4.5" />
        <text className="ag2-label" x="120" y="176" textAnchor="middle">
          Q
        </text>
      </g>

      {/* W — vertical flag span, top → bottom, just off the fly (right) edge. */}
      <g className="ag2 ag2--w">
        <line
          className="ag2-line"
          x1="178"
          y1="30"
          x2="178"
          y2="70"
          pathLength={100}
        />
        <circle className="ag2-start" cx="178" cy="30" r="4" />
        <circle className="ag2-end" cx="178" cy="70" r="4" />
        <text className="ag2-label" x="186" y="53">
          W
        </text>
      </g>

      {/* E — horizontal flag span, left → right, just above the top edge. */}
      <g className="ag2 ag2--e">
        <line
          className="ag2-line"
          x1="120"
          y1="20"
          x2="170"
          y2="20"
          pathLength={100}
        />
        <circle className="ag2-start" cx="120" cy="20" r="4" />
        <circle className="ag2-end" cx="170" cy="20" r="4" />
        <text className="ag2-label" x="145" y="11" textAnchor="middle">
          E
        </text>
      </g>

      {/* R — flag-to-ground span, flag top → wire base, left of the wire. */}
      <g className="ag2 ag2--r">
        <line
          className="ag2-line"
          x1="104"
          y1="30"
          x2="104"
          y2="150"
          pathLength={100}
        />
        <circle className="ag2-start" cx="104" cy="30" r="4" />
        <circle className="ag2-end" cx="104" cy="150" r="4" />
        <text className="ag2-label" x="96" y="94" textAnchor="end">
          R
        </text>
      </g>
    </svg>
  );
}

// Three transect sampling lines — Left, Center, Right — fanning out from the
// camera, each in its data color (red / amber / blue). Keys 1 / 2 / 3 select
// them, and the chosen transect's color tags every annotation. Same
// suppress-under-reduced-motion behavior as AnnotationGuide.
export function TransectGuide() {
  return (
    <svg
      className="transect-guide"
      viewBox="0 0 220 150"
      role="img"
      aria-label="The three transect lines a flag can stand on: Left in red, Center in amber, Right in blue. Keys 1, 2, 3 select which line a flag is on, and the chosen color tags every mark."
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
export function GuideFigures() {
  return (
    <div className="intro-figures">
      <figure className="intro-figure">
        <TransectGuide />
        <figcaption className="intro-figcaption">
          <b>Transect</b> — which of the three lines a flag stands on.{" "}
          <kbd>1</kbd> <span className="t-l">L</span> · <kbd>2</kbd>{" "}
          <span className="t-c">C</span> · <kbd>3</kbd>{" "}
          <span className="t-r">R</span>; the color tags every mark.
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
