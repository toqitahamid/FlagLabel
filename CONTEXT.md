# FlagLabel

The domain language for labeling distance flags in wildlife camera-trap photos. A labeler marks points and spans on each flag so a downstream monocular distance-estimation pipeline can calibrate apparent pixel size against known physical dimensions.

## Language

### Flag anatomy

**Flag**:
A distance marker placed in the field: a colored fabric banner attached to the top of a thin metal wire stuck into the ground. Each flag belongs to one **transect** and one **distance**.

**Flag body**:
The colored fabric banner at the top of the flag. Has a known physical size: 6.35 cm tall × 8.89 cm wide.
_Avoid_: flag head, banner (use "flag body")

**Wire**:
The thin metal stake the flag body is attached to. Total length ~53.34 cm; ~49.53 cm protrudes above ground on average when staked.
_Avoid_: stake, pole, stick

**Wire–ground intersection**:
The point where the wire meets the ground — the base of the flag. The primary calibration point and the original (and only prior) annotation type.
_Avoid_: ground contact, base point (use "wire–ground intersection")

### Annotation types

A labeler places one of four annotation types per flag, each tagged with **transect** and **distance**, and each placed **independently** (a flag need not have all three — far-distance flags often have the base occluded but the body visible).

**Wire–ground intersection** (annotation):
A single point at the base of the flag. Stored as one `{u, v}` coordinate. Keyboard: **Q**.

**Vertical span**:
A two-point measurement of the flag body's top and bottom edges — the 6.35 cm vertical dimension. Stored as one record `{u1, v1, u2, v2}`. Keyboard: **W**.
_Avoid_: top/bottom pair, height span (use "vertical span")

**Horizontal span**:
A two-point measurement of the flag body's left and right edges — the 8.89 cm horizontal dimension. Used as a fallback when the flag's bottom edge is not visible at far distances. Stored as one record `{u1, v1, u2, v2}`. Keyboard: **E**.
_Avoid_: width span, left/right pair (use "horizontal span")

**Flag-to-ground span**:
A two-point measurement from the top edge of the flag body down to the wire–ground intersection — the 49.53 cm visible-above-ground height. The longest baseline, so the most pixel-precise calibration reference, used when both the flag top and the ground contact are clearly visible. Its physical length is an **average** (per-flag burial depth varies ~3.81 cm), unlike the exact flag-body dimensions. Stored as one record `{u1, v1, u2, v2}` (`u1,v1` = flag top, `u2,v2` = ground). Keyboard: **R**. JSON array: `flag_to_ground_spans`.
_Avoid_: full-height span, stake-height span, tall span (use "flag-to-ground span")

**Span**:
Umbrella term for a vertical, horizontal, or flag-to-ground span — a single, indivisible two-point calibration measurement. The two endpoints are placed sequentially (first click pins one end, a ghost line follows the cursor, second click completes it) and are always selected and deleted as a unit.

### Coordinates & grouping

**u, v**:
Coordinates in **image pixels** (origin top-left), never view pixels. All stored annotation coordinates are in this space.

**Transect**:
One of three sampling lines — Left (`L`), Center (`C`), Right (`R`). Selected via `1`/`2`/`3`. Each annotation carries one.

**Distance**:
The flag's nominal distance from the camera, 1–15 (meters). Selected via `↑`/`↓`. Each annotation carries one.

## Flagged ambiguities

- **"Flag's two ends"** (the user's original phrasing) was ambiguous between vertical (top/bottom) and horizontal (left/right). Resolved: both are needed — they are two distinct annotation types (**vertical span**, **horizontal span**), chosen by the labeler based on which edges are visible.

## Example dialogue

> **Dev:** At 15 m the base is buried in grass. What does the labeler do?
> **Expert:** Skip the wire–ground intersection — you can't place it. But the flag body is still visible, so drop a vertical span on its top and bottom edges. If even the bottom edge is washed out, use a horizontal span on the left and right instead.
> **Dev:** So one flag at 15 m might have a horizontal span but no wire–ground point?
> **Expert:** Right — annotations are independent. The pipeline pairs them later by transect and distance.
> **Dev:** And a vertical span is two clicks?
> **Expert:** Two clicks, but one measurement. You can't half-delete it — the span is the unit.
