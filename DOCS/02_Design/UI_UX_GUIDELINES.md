# UnmixAudio — UI/UX Design System

**Version**: 3.0
**Last updated**: 2026-04-02
**Scope**: All visual layers — popup.html, popup.js, content-script.js CSS

---

## 1. Brand Voice

UnmixAudio is a **precision tool**. The design language borrows from Linear and Vercel — dark, quiet, competent. Every element earns its place. There is no decoration for decoration's sake.

- Near-black flat background (`#0D0D0F`) — professional, not pure black
- Google-style light gray accent (`#E8EAED`) — clean, confident
- Typography carries the hierarchy; color only reinforces it
- Motion is purposeful: it communicates state, not style
- System fonts only — no CDN font loads in extensions

---

## 2. Color Tokens

All values are declared as CSS custom properties in the `:root {}` block of `popup.html`.
Never hard-code a hex or rgba value directly in a component rule. Always reference the CSS variable. If a new color is needed, add it to the token table first, then use the variable.

| Token | CSS Variable | Value | Usage |
|---|---|---|---|
| Background | `--bg` | `#0D0D0F` | Body background (flat, no gradient) |
| Surface | `--surface` | `rgba(255,255,255,0.05)` | Card default background |
| Surface Hover | `--surface-hover` | `rgba(255,255,255,0.08)` | Card hover state |
| Surface Active | `--surface-active` | `rgba(255,255,255,0.07)` | Card while analyzing |
| Border | `--border` | `rgba(255,255,255,0.07)` | Default card border |
| Border Active | `--border-active` | `rgba(255,255,255,0.22)` | Card border while analyzing |
| Accent | `--accent` | `#E8EAED` | BPM pulse highlight, focus rings |
| Accent Dim | `--accent-dim` | `rgba(232,234,237,0.12)` | BPM pulse box-shadow |
| Text Primary | `--text` | `#F1F3F4` | Metric values |
| Text Secondary | `--text-secondary` | `#9AA0A6` | Status label |
| Text Tertiary | `--text-tertiary` | `#5F6368` | Card labels, units, app label |
| Error | `--error` | `#F28B82` | Error state dot and text |
| Error Surface | `--error-surface` | `rgba(242,139,130,0.1)` | STOP button background |
| Radius | `--radius` | `10px` | Cards and buttons (consistent) |
| Radius Small | `--radius-sm` | `6px` | Small elements |

### content-script.js Alignment

The overlay button in `content-script.js` must use the same palette. Map as follows:

| Element | Property | Value |
|---|---|---|
| Overlay background | `background` | `rgba(13, 13, 15, 0.9)` |
| Analyzing dot | `background` | `#E8EAED` |
| Analyzing dot glow | `box-shadow` | `0 0 6px rgba(232, 234, 237, 0.5)` |
| Analyzing border | `border-color` | `rgba(232, 234, 237, 0.3)` |

---

## 3. Typography Scale

Font stack: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
Rendering: `-webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility`

| Role | Size | Weight | Color Token | Notes |
|---|---|---|---|---|
| App label | `11px` | `600` | `--text-tertiary` | `letter-spacing: 3px`, uppercase |
| Card label | `10px` | `600` | `--text-tertiary` | `letter-spacing: 2.5px`, uppercase |
| Metric value (BPM) | `44px` | `800` | `--text` | `font-variant-numeric: tabular-nums; letter-spacing: -1px` |
| Metric value (Key) | `22px` | `700` | `--text` | — |
| Card unit | `10px` | `400` | `--text-tertiary` | `letter-spacing: 0.5px` |
| Secondary key | `11px` | `400` | `--text-tertiary` | `min-height: 13px` |
| Status label | `12px` | `400` | `--text-secondary` | — |
| Button (primary) | `13px` | `700` | `#0D0D0F` on `--text` bg | `letter-spacing: 0.5px` |
| Button (danger) | `13px` | `600` | `--error` | `letter-spacing: 0.5px` |

---

## 4. Spacing System

Base grid: **8px**. All spacing values must be multiples of 8 (or 4 for fine-grained adjustments within components).

| Context | Value |
|---|---|
| Body padding | `24px` (3 × 8) |
| Section spacing (header, metrics, status) | `24px` / `16px` margin-bottom |
| Card padding | `16px` (2 × 8) |
| Metrics grid gap | `8px` (1 × 8) |
| Actions gap | `8px` (1 × 8) |
| Status row gap | `8px` (1 × 8) |
| Card label margin-bottom | `6px` |
| BPM number margin-bottom (implicit via line-height) | — |
| Card unit margin-top | `4px` |

---

## 5. Motion Tokens

| Token | Value | Applied To |
|---|---|---|
| Card transition | `background 0.3s ease, border-color 0.3s ease` | `.card` default/active switch |
| Button transition (primary) | `background 0.15s, transform 0.1s` | `.btn-primary` hover/active |
| Button transition (danger) | `background 0.15s` | `.btn-danger` hover |
| Status dot transition | `background 0.2s` | `.status-dot` state change |
| BPM pulse easing | `cubic-bezier(0.4, 0, 0.2, 1)` | `bpmPulse` keyframe |
| BPM pulse duration | `60 / BPM` seconds (set via CSS custom property) | `.card.active.bpm-beat` |
| Dot pulse | `2s ease-in-out infinite` | `.status-dot.live` |

### BPM Duration Formula

```javascript
const duration = 60 / parsedBpm; // seconds
bpmCard.style.setProperty('--beat-duration', duration + 's');
bpmCard.classList.add('bpm-beat');
```

To clear:
```javascript
bpmCard.classList.remove('bpm-beat');
bpmCard.style.removeProperty('--beat-duration');
```

### Performance Rule

Keyframes must only animate `transform`, `opacity`, `box-shadow`, or `border-color`. Never animate `width`, `height`, `top`, `left`, or any property that triggers layout recalculation. This keeps animations on the compositor thread and maintains 60fps.

All direct DOM updates must be wrapped in `requestAnimationFrame`.

---

## 6. State Visual Specs

### idle

- Status dot: `background: var(--text-tertiary)` (no animation), no class modifier
- Status text: "대기 중"
- Metric cards: `--surface` background, `--border` border
- Buttons: START visible (`display: block`), STOP hidden (`display: none`)

### analyzing

- Status dot: `background: #fff`, class `.live`, `dot-pulse` animation active
- Status text: "분석 중..."
- Metric cards: class `.active` — `--surface-active` background, `--border-active` border
- BPM card: class `.bpm-beat` active (pulse at BPM tempo via `--beat-duration`)
- Buttons: STOP visible, START hidden

### error

- Status dot: `background: var(--error)`, class `.err` (no animation)
- Status text: error message string
- Metric cards: remain in last state (no forced reset)
- Buttons: START visible, STOP hidden

### loading (button disabled)

- Status dot: no class modifier (idle appearance)
- Status text: "캡처 요청 중..."
- START button: `disabled`, `opacity: 0.4`, `cursor: not-allowed`

---

## 7. Component Specs

### Metric Card

```
background:    var(--surface)
border:        1px solid var(--border)
border-radius: var(--radius)   /* 10px — same as buttons */
padding:       16px
transition:    background 0.3s ease, border-color 0.3s ease
```

Active state (`.card.active`):
```
background:   var(--surface-active)
border-color: var(--border-active)
```

BPM pulse state (`.card.active.bpm-beat`):
```
animation: bpmPulse var(--beat-duration, 0.5s) cubic-bezier(0.4,0,0.2,1) infinite
```

Note: The confidence bar has been removed from cards. Research shows it clutters professional audio tool interfaces. Confidence is conveyed implicitly through the BPM pulse animation cadence.

### Status Row

```
display:      flex
align-items:  center
gap:          8px
padding:      0 2px
```

Status dot: `6px × 6px`, `border-radius: 50%`, `flex-shrink: 0`

### CTA Button — START (`.btn-primary`)

```
background:    var(--text)    /* #F1F3F4 — the ONLY bright element when idle */
color:         #0D0D0F
border:        none
border-radius: var(--radius)  /* 10px */
padding:       11px 16px
font-weight:   700
font-size:     13px
letter-spacing: 0.5px
```

States:
- Hover: `background: #fff`
- Active: `transform: scale(0.99)`
- Focus-visible: `outline: 2px solid var(--accent); outline-offset: 2px`
- Disabled: `opacity: 0.4; cursor: not-allowed`

### CTA Button — STOP (`.btn-danger`)

```
background:    var(--error-surface)
color:         var(--error)
border:        1px solid rgba(242,139,130,0.25)
border-radius: var(--radius)  /* 10px */
padding:       11px 16px
font-weight:   600
font-size:     13px
letter-spacing: 0.5px
```

States:
- Hover: `background: rgba(242,139,130,0.16)`
- Focus-visible: `outline: 2px solid var(--error); outline-offset: 2px`

---

## 8. Layout & Sizing

| Property | Value |
|---|---|
| Popup width | `360px` |
| Popup height | `auto` — no min-height, content drives size |
| Body padding | `24px` |
| Metrics layout | `grid; grid-template-columns: 1fr 1fr; gap: 8px` |
| Background | `#0D0D0F` flat (no gradient) |

---

## 9. Accessibility (WCAG AA)

Minimum contrast ratios required:

| Pairing | Contrast target |
|---|---|
| `--text` (`#F1F3F4`) on `--bg` (`#0D0D0F`) | >= 4.5:1 |
| `--text-secondary` (`#9AA0A6`) on `--bg` | >= 3:1 (UI text) |
| `--error` (`#F28B82`) on `--bg` | >= 4.5:1 |
| START button: `#0D0D0F` on `--text` (`#F1F3F4`) | >= 7:1 (verified) |

- All interactive elements have `:focus-visible` outlines for keyboard navigation.
- State changes never rely on color alone — always paired with a text label change.

---

## 10. Production Checklist

Before merging any visual change:

- [ ] All CSS values reference tokens from Section 2 (no raw hex in component rules)
- [ ] Spacing values are multiples of 8px (or 4px for fine-grain within components)
- [ ] Contrast ratios verified against Section 9 targets
- [ ] BPM animation keyframe uses only `border-color`/`box-shadow` (no layout properties)
- [ ] Popup hydrates state in under 100ms (`get-state` called at script load)
- [ ] All DOM updates inside `requestAnimationFrame`
- [ ] All required element IDs present: `bpm-card`, `key-card`, `bpm-value`, `key-value`, `key-secondary`, `status-dot`, `status-text`, `start-btn`, `stop-btn`
- [ ] All interactive elements have `:focus-visible` styles
- [ ] No `min-height` on body — height is auto
- [ ] content-script.js CSS updated to match palette (Section 2, overlay alignment table)
- [ ] No new framework or CDN dependencies introduced
