# Portal Theme Contract

This document defines the **stable UI theme contract** for the M365 Discovery Portal.

It exists to prevent styling regressions, ensure dark/light mode correctness,
and keep TSX and CSS responsibilities clearly separated.

This contract is considered **locked** unless explicitly revised.

---

## 1. Source of truth

**CSS variables in `apps/portal/src/app/globals.css` are the single source of truth.**

All colours, tones, and emphasis must derive from these variables.

TSX must never hardcode colour values.

---

## 2. Semantic tokens (stable)

The following tokens are guaranteed and may be used anywhere:

### Core text
- `--text` — primary foreground text
- `--muted` — secondary / explanatory text
- `--muted2` — tertiary / metadata text

### Panels & structure
- `--bg` — page background
- `--panel`, `--panel-2` — card/panel surfaces
- `--border` — borders and dividers

### Status tones
- `--ok-bg`, `--ok-fg`
- `--warn-bg`, `--warn-fg`
- `--bad-bg`, `--bad-fg`
- `--muted-bg`, `--muted-fg`

These are semantic, **not brand colours**.

---

## 3. CSS responsibilities (preferred)

CSS owns:
- colour
- contrast
- hover/focus states
- dark/light mode behaviour

Examples:
- `.link`, `.link-action`
- `.badge.*`
- `.env-card.tone-*`

---

## 4. TSX responsibilities (allowed but constrained)

TSX **may**:
- apply semantic classes (`link-action`, `badge warn`, etc)
- reference semantic tokens (e.g. `var(--text)`, `var(--muted)`)

TSX **must not**:
- hardcode hex/RGB colours
- override contrast decisions
- fix visual bugs caused by missing CSS

If TSX styling is required to “fix” appearance, the fix belongs in CSS.

---

## 5. Links & actions

All navigational or action links must use one of:
- `.link`
- `.link-action`

These classes guarantee readable contrast on all supported themes.

---

## 6. Contract violations

The following are considered violations:
- Inline hex/RGB colours in TSX
- Per-page colour overrides
- Duplicate semantic meanings (e.g. inventing new “warning yellow”)

Violations should be fixed at the **CSS layer**, not patched in TSX.

---

## 7. Intentional simplicity

This is **not** a design system.

It is a minimal, enforced contract to keep the Portal readable,
predictable, and safe to extend.
