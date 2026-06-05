// First-run welcome walkthrough (web only). A 4-step modal shown once after the
// first web login; the final step branches into the product tour or dismisses.
// Styling is global in onboarding.css (.ob-* classes); figures come from the
// shared schematics module.

import { useEffect, useState } from "react";
import { AnnotationGuide, TransectGuide, GuideFigures } from "./schematics";

type Step = {
  fig: React.ReactNode;
  title: string;
  body: React.ReactNode;
};

const STEPS: Step[] = [
  {
    fig: <AnnotationGuide />,
    title: "Mark where each flag meets the ground",
    body: (
      <>
        Every distance flag sits on a wire. You'll click the exact point where
        that wire meets the ground — and, when you can, trace the flag's size for
        calibration.
      </>
    ),
  },
  {
    fig: <TransectGuide />,
    title: "Pick the transect line",
    body: (
      <>
        Flags stand on one of three lines. Press <kbd>1</kbd>, <kbd>2</kbd>, or{" "}
        <kbd>3</kbd> (Left, Center, Right) — the colour you pick tags every mark
        you place.
      </>
    ),
  },
  {
    fig: <AnnotationGuide />,
    title: "Set the distance, then the tool",
    body: (
      <>
        Each line holds 15 flags, 1 m apart. Set the flag's distance with{" "}
        <kbd>↑</kbd> <kbd>↓</kbd>, then choose a tool — <kbd>Q</kbd> wire-ground,{" "}
        <kbd>W</kbd>/<kbd>E</kbd>/<kbd>R</kbd> for the flag spans — and click.
      </>
    ),
  },
  {
    fig: <GuideFigures />,
    title: "Everything saves automatically",
    body: (
      <>
        Your marks sync to the shared dataset the moment you place them — no save
        button. Take a 30-second tour of the controls, or jump straight in.
      </>
    ),
  },
];

export function WelcomeModal({
  onFinish,
  onStartTour,
}: {
  onFinish: () => void;
  onStartTour: () => void;
}) {
  const [step, setStep] = useState(0);
  const last = step === STEPS.length - 1;

  // Capture-phase key handling so navigation/escape never leaks to the app's
  // global keydown handler underneath (which would deselect / nav images).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onFinish();
      } else if (e.key === "ArrowRight") {
        e.stopPropagation();
        setStep((s) => Math.min(STEPS.length - 1, s + 1));
      } else if (e.key === "ArrowLeft") {
        e.stopPropagation();
        setStep((s) => Math.max(0, s - 1));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onFinish]);

  const s = STEPS[step];

  return (
    <div className="ob-backdrop" onClick={onFinish}>
      <div
        className="ob-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="ob-top">
          <div className="ob-dots">
            {STEPS.map((_, i) => (
              <i key={i} className={i === step ? "on" : undefined} />
            ))}
          </div>
          <button className="ob-skip" onClick={onFinish}>
            Skip
          </button>
        </div>

        <div className="ob-fig">{s.fig}</div>
        <h2 className="ob-title">{s.title}</h2>
        <p className="ob-body">{s.body}</p>

        <div className="ob-actions">
          <span className="ob-step">
            {step + 1} / {STEPS.length}
          </span>
          <div className="ob-action-btns">
            {step > 0 && (
              <button
                className="ob-back"
                onClick={() => setStep((v) => Math.max(0, v - 1))}
              >
                Back
              </button>
            )}
            {last ? (
              <>
                <button className="ob-secondary" onClick={onStartTour}>
                  Take a quick tour
                </button>
                <button className="ob-next" onClick={onFinish}>
                  Start labelling
                </button>
              </>
            ) : (
              <button
                className="ob-next"
                onClick={() => setStep((v) => Math.min(STEPS.length - 1, v + 1))}
              >
                Next →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
