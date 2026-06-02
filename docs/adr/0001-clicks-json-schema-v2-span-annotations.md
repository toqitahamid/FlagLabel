# Clicks-JSON schema v2: separate per-type arrays for span annotations

> **Update (Slice 1, #2):** The dual-read back-compat below was **reversed** by
> the project owner. `parseAnnotationFile` reads **v2 only**; legacy v1
> `clicks`-only files parse to `[]` and therefore load as empty. There is no
> in-app migration. The rest of this ADR (array layout, dropped `click_type`,
> `reference_dimensions_cm`, the `clicks`→`wire_ground_points` rename) stands.

## Context

v1 of the per-image JSON held a single `clicks` array and a file-level
`click_type: "wire_ground_intersection"` — every record was a wire–ground base
point. To support distance calibration we added three new two-point
*span* annotation types (flag vertical 6.35 cm, flag horizontal 8.89 cm,
flag-to-ground 49.53 cm), each placed independently of the base point because
different parts of a flag are visible at different distances.

## Decision

Bump to `schema_version: 2` and store each annotation type in its own
top-level array: `wire_ground_points`, `flag_vertical_spans`,
`flag_horizontal_spans`, `flag_to_ground_spans`. Span entries are
`{u1,v1,u2,v2,transect,distance}` with canonical endpoint ordering
(upper point first for vertical/flag-to-ground, left point first for
horizontal). Drop the now-misleading file-level `click_type`. Add a
`reference_dimensions_cm` block carrying the known true physical dimensions
(the calibration *inputs*, distinct from any computed pixels-per-cm scale).
Rename `clicks` → `wire_ground_points` because "clicks" was UI language, not
the domain term (*wire–ground intersection*).

## Considered options

- **Single `annotations` array with a per-entry `type` field.** Rejected:
  separate arrays let pipeline code that only wants base points read one array
  and ignore the rest with no per-entry filtering, and the array names are
  self-documenting.
- **Keep `click_type: "mixed"` for old-reader safety.** Rejected: a vestigial
  field that lies about the contents is worse than a clean break flagged by
  `schema_version`.

## Consequences

- Naive v1 readers keyed on `clicks` or `click_type` break. The FlagLabel app
  loader must **dual-read**: prefer `wire_ground_points`, fall back to `clicks`
  for v1 files already on disk — otherwise every previously-labeled image reads
  as empty.
- The downstream distance-estimation pipeline must branch on `schema_version`.
