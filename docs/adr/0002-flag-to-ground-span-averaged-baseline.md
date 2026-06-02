# Flag-to-ground span calibrates against an averaged 49.53 cm baseline

## Context

The flag-to-ground span runs from the top edge of the flag body down to the
wire–ground intersection. It is the longest baseline of the four annotation
types, so small pixel errors in endpoint placement matter least relative to its
length — making it the most pixel-precise calibration reference. Unlike the
flag body's 6.35 cm height and 8.89 cm width, which are *exact* manufactured
dimensions identical on every flag, its physical length depends on how deep
each flag was pushed into the ground (~3.81 cm buried on average, total wire
53.34 cm). We only have an *average* visible height: 49.53 cm.

## Decision

Treat the flag-to-ground span as a co-equal fourth annotation type and
calibrate it against a single fixed constant of **49.53 cm**, accepting the
per-flag burial variability as measurement noise. Do not collect a per-flag
burial or visible-length field.

## Considered options

- **Per-flag burial/length field the labeler adjusts.** Rejected: the labeler
  cannot judge burial depth from a photo, so the field would be guessed or left
  at the default — burden without signal.
- **Derive the span from existing endpoints** (vertical-span top + wire–ground
  point) instead of storing it. Rejected: the premise of the app is that
  different points are visible at different distances, so the span must be
  explicitly placed when flag-top *and* ground are both clearly visible, not
  silently inherited from endpoints placed under different conditions.

## Consequences

- Calibration from this span carries a systematic per-flag error of order the
  burial variance (a few percent on a 49.53 cm baseline), expected to average
  out across many flags. Downstream consumers should treat the exact flag-body
  spans as the higher-confidence reference and the flag-to-ground span as the
  higher-precision-but-biased one, and may cross-check the two.
