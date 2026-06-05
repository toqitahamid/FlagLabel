// Docked getting-started card (web only). Tracks real annotation progress passed
// down as `items` and is dismissible. App decides when to mount/hide it (after
// the welcome modal, until all items done or dismissed). Styling: .ob-cl-* in
// onboarding.css.

export function GettingStartedChecklist({
  items,
  onDismiss,
}: {
  items: { label: React.ReactNode; done: boolean }[];
  onDismiss: () => void;
}) {
  const doneCount = items.filter((i) => i.done).length;
  const pct = items.length === 0 ? 0 : (doneCount / items.length) * 100;
  const firstNotDone = items.findIndex((i) => !i.done);

  return (
    <aside className="ob-checklist" role="complementary" aria-label="Getting started">
      <div className="ob-cl-head">
        <span className="t">Getting started</span>
        <span className="c">
          {doneCount} / {items.length}
        </span>
      </div>
      <div className="ob-cl-bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <ul className="ob-cl-list">
        {items.map((item, i) => {
          const cls = item.done ? "done" : i === firstNotDone ? "now" : undefined;
          return (
            <li key={i} className={cls}>
              <span className="box">{item.done ? "✓" : ""}</span>
              <span className="lbl">{item.label}</span>
            </li>
          );
        })}
      </ul>
      <div className="ob-cl-foot">
        <button onClick={onDismiss}>Dismiss</button>
      </div>
    </aside>
  );
}
