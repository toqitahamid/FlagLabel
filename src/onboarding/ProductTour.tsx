// Product tour (web only): coachmark + spotlight steps anchored over the REAL
// app controls via `data-tour-id` attributes (NOT refs — the rail mounts/unmounts
// with the open image). Steps whose anchor isn't in the DOM self-skip, so
// launching the tour with no image open lands on the explorer step and then
// closes cleanly. Styling: .ob-tour-* / .ob-tip-* in onboarding.css.

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

type TourStep = {
  id: string;
  title: string;
  body: React.ReactNode;
  // Where to place the tooltip relative to the anchor rect.
  place: "below" | "left";
};

const STEPS: TourStep[] = [
  {
    id: "tour-explorer",
    title: "Pick an image",
    body: (
      <>
        Open any image from the explorer to start. Your folders (one per camera)
        live here.
      </>
    ),
    place: "below",
  },
  {
    id: "tour-transect",
    title: "Pick the transect",
    body: (
      <>
        Each flag sits on one of three lines. Press <kbd>1</kbd>, <kbd>2</kbd>, or{" "}
        <kbd>3</kbd> — the colour tags every mark.
      </>
    ),
    place: "left",
  },
  {
    id: "tour-distance",
    title: "Set the distance",
    body: (
      <>
        Flags are 1 m apart, 1–15. Set the current flag's distance with{" "}
        <kbd>↑</kbd> <kbd>↓</kbd> (or the steppers).
      </>
    ),
    place: "left",
  },
  {
    id: "tour-tool",
    title: "Choose what to mark",
    body: (
      <>
        <kbd>Q</kbd> marks the wire-ground point; <kbd>W</kbd>/<kbd>E</kbd>/
        <kbd>R</kbd> trace the flag's spans. Then click on the image.
      </>
    ),
    place: "left",
  },
  {
    id: "tour-zoom",
    title: "Place it precisely",
    body: (
      <>
        The zoom panel magnifies under your cursor for sub-pixel clicks.
      </>
    ),
    place: "left",
  },
];

const PAD = 6; // gap between the spotlight and the anchor rect
const TIP_W = 256; // matches .ob-tip width in CSS
const VP_MARGIN = 12; // keep the tip this far from the viewport edge

function anchorRect(id: string): DOMRect | null {
  const el = document.querySelector(`[data-tour-id="${id}"]`);
  return el ? el.getBoundingClientRect() : null;
}

export function ProductTour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Advance to the next step that has a live anchor; close if none remain.
  const advanceFrom = useCallback(
    (from: number) => {
      for (let i = from; i < STEPS.length; i++) {
        if (anchorRect(STEPS[i].id)) {
          setStep(i);
          return;
        }
      }
      onClose();
    },
    [onClose],
  );

  // On step change: if the current step's anchor is missing, self-skip forward.
  // Runs in an effect (never setState during render).
  useEffect(() => {
    if (!anchorRect(STEPS[step].id)) advanceFrom(step + 1);
  }, [step, advanceFrom]);

  // Measure the anchor before paint, and keep it fresh on resize/scroll.
  useLayoutEffect(() => {
    const measure = () => setRect(anchorRect(STEPS[step].id));
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  // Capture-phase Escape so closing the tour doesn't leak to the app's global
  // keydown handler (deselect / nav).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Anchor not yet measured (or self-skipping): render nothing this frame.
  if (!rect) return null;

  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Spotlight hole (rect + padding).
  const hole = {
    top: rect.top - PAD,
    left: rect.left - PAD,
    right: rect.right + PAD,
    bottom: rect.bottom + PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };

  // Tooltip placement. Left rail items get the tip to their left; explorer below.
  let tipLeft: number;
  let tipTop: number;
  if (s.place === "left") {
    tipLeft = hole.left - TIP_W - 12;
    tipTop = hole.top;
  } else {
    tipLeft = hole.left;
    tipTop = hole.bottom + 12;
  }
  // Clamp into the viewport.
  tipLeft = Math.max(VP_MARGIN, Math.min(tipLeft, vw - TIP_W - VP_MARGIN));
  tipTop = Math.max(VP_MARGIN, Math.min(tipTop, vh - 160 - VP_MARGIN));

  return (
    <>
      {/* Four scrim bands dim everything except the anchor hole. */}
      <div
        className="ob-tour-scrim"
        style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }}
      />
      <div
        className="ob-tour-scrim"
        style={{ top: hole.bottom, left: 0, right: 0, bottom: 0 }}
      />
      <div
        className="ob-tour-scrim"
        style={{
          top: hole.top,
          left: 0,
          width: Math.max(0, hole.left),
          height: hole.height,
        }}
      />
      <div
        className="ob-tour-scrim"
        style={{
          top: hole.top,
          left: hole.right,
          right: 0,
          height: hole.height,
        }}
      />

      <div
        className="ob-tour-ring"
        style={{
          top: hole.top,
          left: hole.left,
          width: hole.width,
          height: hole.height,
        }}
      />

      <div className="ob-tip" style={{ top: tipTop, left: tipLeft }}>
        <div className="ob-tip-h">
          <span className="ob-tip-n">
            {step + 1}/{STEPS.length}
          </span>
          {s.title}
        </div>
        <p className="ob-tip-body">{s.body}</p>
        <div className="ob-tip-foot">
          <div className="ob-tip-dots">
            {STEPS.map((_, i) => (
              <i key={i} className={i === step ? "on" : undefined} />
            ))}
          </div>
          <div className="ob-tip-acts">
            <button className="ob-tip-skip" onClick={onClose}>
              Skip tour
            </button>
            <button
              className="ob-tip-next"
              onClick={() => (last ? onClose() : advanceFrom(step + 1))}
            >
              {last ? "Done" : "Next →"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
