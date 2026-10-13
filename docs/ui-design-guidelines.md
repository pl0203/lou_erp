# Padiwan UI design guidelines

Use these shared patterns for all new and revised Padiwan pages, forms, filters,
tables and dialogs. Keep Plus Jakarta Sans, the existing brand palette, logo and
module icons. Compact controls should make routine work easier to scan without
shrinking the information people need to read.

## Responsive density

Density is defined by tokens in `src/index.css`, with shared control styles in
`src/styles/ui.css`. The desktop override requires a viewport of at least 768px,
hover support and a fine primary pointer. Narrow screens and coarse/touch primary
pointers retain the default density, including when an action opts into compact
size.

| Property | Narrow or touch default | Desktop fine pointer |
| --- | --- | --- |
| Standard control minimum height | 44px | 36px |
| Compact action minimum height/width | 44px | 32px |
| Field/action text and line height | 16px / 24px | 14px / 20px |
| Field labels | 16px, medium | 13px, medium |
| Control corners | 10px | 6px |
| Field horizontal padding | 12px | 12px |

Keep body text at 16px, table data at least 14px and supporting text at least 13px.
Card corners stay 14px. Density changes controls, not the overall data-reading
contract. Heights are minimums: long labels, multi-line fields and localized text
can grow rather than being clipped.

## Actions and hierarchy

Use `Button` for a command and `ActionLink` for navigation. Both accept
`size?: 'default' | 'compact'`. Compact actions render `ui-action--compact`.
Omitting size or variant preserves the existing default API.

- `primary`: the main next step in a page, form or action group. Prefer one clear
  primary action per group.
- `secondary`: a substantial alternative that needs a visible bordered surface.
- `quiet`: routine navigation or supporting commands. Text is underlined at rest,
  with a visible hover background and the shared keyboard focus outline.
- `danger-quiet`: a destructive row command, available on `Button` only. It uses
  red text without competing with the main action.
- `danger`: an explicit destructive confirmation, available on `Button` only.

`Button` supports all five variants; `ActionLink` supports primary, secondary and
quiet. Keep frequent row actions such as Lihat and Ubah side by side, using compact
size and a wrapping group. Do not hide two frequent actions in an overflow menu.

```tsx
<div className="flex flex-wrap items-center gap-2">
  <ActionLink to={`/athel/co/${record.id}`} variant="quiet" size="compact">
    Lihat
  </ActionLink>
  <ActionLink to={`/athel/co/${record.id}/edit`} variant="secondary" size="compact">
    Ubah
  </ActionLink>
  <Button variant="danger-quiet" size="compact" onClick={openDeleteConfirmation}>
    Hapus
  </Button>
</div>
```

The command is a native button and defaults to `type="button"`. Use
`type="submit"` explicitly for form submission. Navigation remains a real anchor
with an href, ordinary routing and modified-click behavior. Do not replace a link
with a button or add button roles to navigation. Provide an accessible name for
icon-only actions and preserve labels while pending.

`pending` disables `Button`, sets `aria-busy` and shows an aria-hidden spinner.
Keep the owner's existing mutation lock and recovery rules; shared presentation
does not replace transaction guards. Disabled controls use readable text and
borders rather than a blanket opacity reduction. Keep keyboard focus outlines.

For selected choices, keep native `aria-pressed` or `aria-selected` semantics and
add a visible selected cue appropriate to that control group, such as a border,
background, or underline. ARIA alone does not show sighted users which choice is
active. Audit callers before changing a shared style; do not use one global
attribute selector to style every selected control.

## Fields and custom controls

Use `Field` for a labelled control, with its supplied id, hint and error
associations. Native input, select and textarea children receive shared density
directly. A nested custom input, such as a combobox, should put `ui-control` on the
native editable element while preserving its own keyboard behavior and ARIA.
Standalone editable controls outside `Field` can use the same `ui-control` class;
keep an explicit accessible label and their existing hint/error associations.

```tsx
<Field id="customer" label="Pelanggan" hint="Cari nama pelanggan." error={error}>
  {control => <div className="relative min-w-0">
    <input {...control} className="ui-control" role="combobox"
      aria-expanded={expanded} aria-controls="customer-options" />
  </div>}
</Field>
```

`ui-control` is for editable text/select/textarea-like controls, not checkbox,
radio or button wrappers. Keep required semantics, native input types, validation,
disabled states and error focus. Long labels must wrap and fields must be able to
shrink within their layout. Use balanced filter widths instead of giving each
filter an equally wide desktop box; let filter groups wrap on narrow screens.

Remove obsolete sizing overrides when adopting shared density: utilities such as
`min-h-11`, `text-base`, `py-2`, `py-3` or fixed heights can defeat the tokens.
Retain domain layout, alignment, textarea row count and useful widths. Do not use
`!important`, duplicate density rules per route, or shrink controls with an
unconditional `text-sm`/height utility. Prefer shared tokens to ad hoc overrides.

## Layout and information

Use the existing PageHeader, Section, FilterBar, FormActions, feedback and
pagination patterns. Keep one understandable action hierarchy, visible status
text and distinct empty/error/loading states. Preserve all data columns,
meanings, dates, quantities and authorization-controlled action visibility.
Do not change business behavior while applying visual density.

Keep form/action groups wrapping. Avoid page-wide horizontal overflow. A genuinely
wide table should own a labelled, keyboard-scrollable region, while surrounding
filters and actions still fit the page. Keep readable data text and do not clip
long labels or values to enforce a fixed control height.

## Verification for future screens

- Test native link/button semantics, explicit submit behavior, pending/disabled
  states, labels, error associations and the owner's existing interaction guards.
- Test the responsive CSS/token contract and remove conflicting sizing utilities.
- Inspect actual rendering with desktop fine-pointer, narrow and touch layouts,
  including long text, wrapping, focus, contrast and scrolling.

Source/class assertions and jsdom focus tests establish wiring and semantics.
They do not establish actual browser layout, media-query evaluation, contrast,
keyboard traversal or hit-target size. Record any missing real-render evidence
instead of treating CSS tests or a static mockup as visual acceptance.
