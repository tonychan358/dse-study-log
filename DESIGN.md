# DESIGN.md — Bento Grid
> Version: 1.0 | Mood: 現代、有層次、視覺豐富
> Reference: Apple iPhone 16 marketing, Linear homepage, Vercel homepage 2024, Craft
> Best for: 產品落地頁、個人作品集、功能展示頁、SaaS 主頁、AI 產品介紹

---

## Colors

### Backgrounds
```
bg-base:     #FFFFFF   ← pure white canvas
bg-surface:  #FAFAFA   ← bento cells (default)
bg-elevated: #F4F4F5   ← hover state
bg-dark:     #09090B   ← dark bento cells (accent contrast)
bg-accent-1: #F0FDF4   ← green tint cell
bg-accent-2: #EFF6FF   ← blue tint cell
bg-accent-3: #FDF4FF   ← purple tint cell
bg-accent-4: #FFF7ED   ← orange tint cell
```

### Primary (Near-Black)
```
primary:        #09090B   ← near-black, used for dark cells + text
primary-hover:  #18181B
```

### Accent Palette (Cell-level accent colors — one per cell type)
```
accent-green:   #22C55E   ← success, growth, metrics
accent-blue:    #3B82F6   ← primary interactive, links
accent-purple:  #A855F7   ← creative, AI features
accent-orange:  #F97316   ← energy, notifications
accent-rose:    #F43F5E   ← alerts, trending
accent-amber:   #F59E0B   ← highlights, ratings
```

### Text
```
text-primary:   #09090B   ← near-black
text-secondary: #52525B   ← zinc-600
text-muted:     #A1A1AA   ← zinc-400
text-inverse:   #FFFFFF   ← on dark cells
text-muted-inv: rgba(255,255,255,0.60)  ← muted on dark cells
```

### Borders
```
border-subtle:  #F4F4F5
border-default: #E4E4E7   ← zinc-200
border-strong:  #D4D4D8   ← zinc-300
border-dark:    rgba(255,255,255,0.10)  ← borders on dark cells
```

---

## Typography

Font family: Inter, system-ui, sans-serif
(Optional: 'Geist', Inter — Vercel-inspired)

| Token       | Size    | Weight | Letter Spacing | Use Case                              |
|------------|---------|--------|----------------|---------------------------------------|
| display    | 3.5rem  | 700    | -0.04em        | Hero headline in bento                |
| heading-xl | 2.25rem | 700    | -0.03em        | Large cell title                      |
| heading-lg | 1.5rem  | 600    | -0.02em        | Medium cell title                     |
| heading-md | 1.25rem | 600    | -0.01em        | Small cell title                      |
| heading-sm | 1rem    | 600    | 0              | Micro cell heading                    |
| body-lg    | 1rem    | 400    | 0              | Cell description                      |
| body       | 0.875rem| 400    | 0              | Body text in cells                    |
| body-sm    | 0.8125rem| 400   | 0              | Caption, metadata                     |
| label      | 0.875rem | 500   | 0.01em         | Labels, tags                          |
| label-sm   | 0.75rem  | 500   | 0.02em         | Small tags, counts                    |
| eyebrow    | 0.75rem  | 600   | 0.08em         | Section labels (ALL CAPS)             |
| button     | 0.875rem | 600   | 0              | CTA buttons                           |
| number-lg  | 3rem    | 700    | -0.02em        | Metric numbers, counters              |
| number-xl  | 4rem    | 700    | -0.03em        | Hero statistics                       |

---

## Spacing System

```
space-1:  4px
space-2:  8px
space-3:  12px
space-4:  16px
space-5:  20px
space-6:  24px
space-8:  32px
space-10: 40px
section:  80px–120px
bento-gap: 12px–16px   ← gap between grid cells
cell-pad:  24px–32px   ← inner padding of bento cells
```

---

## Border Radius

```
radius-sm:   8px    ← small tags, badges
radius-md:   12px   ← small bento cells
radius-lg:   16px   ← standard bento cells (most common)
radius-xl:   20px   ← large feature cells
radius-2xl:  24px   ← hero bento, modals
radius-full: 9999px ← pill tags, avatars, icons
```

---

## Elevation Model

- **Level 0** — bg-base (#FFFFFF). Page canvas.
- **Level 1** — bg-surface + border-default. Default bento cells.
- **Level 2** — bg-surface + border-strong + shadow-sm. Hovered cells.
- **Level 3** — bg-dark or bg-accent. Accent/dark bento cells (no shadow needed — contrast is elevation).

```
shadow-sm: 0 1px 4px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)
shadow-md: 0 4px 12px rgba(0,0,0,0.08)
```

---

## The Bento Grid System

### Grid Foundation
```css
.bento-grid {
  display: grid;
  gap: 12px;                    /* bento-gap */
  grid-template-columns: repeat(4, 1fr);   /* 4-column default */
}
```

### Cell Sizes (by column/row span)
```
tiny:     1×1  (1 col, 1 row)  ← single stat, icon block
small:    2×1  (2 col, 1 row)  ← short text + badge
medium:   2×2  (2 col, 2 row)  ← feature highlight, chart
wide:     3×1  (3 col, 1 row)  ← tagline + CTA
tall:     1×2  (1 col, 2 row)  ← narrow vertical stat
large:    3×2  (3 col, 2 row)  ← hero feature, screenshot
full:     4×1  (4 col, 1 row)  ← full-width banner
hero:     4×2  (4 col, 2 row)  ← above-the-fold hero block
```

### Responsive Grid Collapse
```css
/* Desktop: 4 columns */
@media (min-width: 1024px) { grid-template-columns: repeat(4, 1fr); }
/* Tablet: 2 columns */
@media (min-width: 640px)  { grid-template-columns: repeat(2, 1fr); }
/* Mobile: 1 column */
@media (max-width: 639px)  { grid-template-columns: 1fr; }
```

On mobile: ALL cells become 1×1. No spanning. Order matters — design mobile order intentionally.

---

## Components

### Bento Cells

**`cell-default`** (Light, content cell)
- Background: `{colors.bg-surface}`
- Border: 1px `{colors.border-default}`
- Radius: `{radius.lg}` (16px)
- Padding: `{cell-pad}` (24px)
- Overflow: hidden
- Hover → shadow: `{shadow-sm}`, border: border-strong

**`cell-dark`** (Dark contrast cell)
- Background: `{colors.bg-dark}` (#09090B)
- Border: 1px `{colors.border-dark}`
- Radius: `{radius.lg}`
- Padding: `{cell-pad}`
- Text: text-inverse

**`cell-accent-{color}`** (Tinted accent cell)
- Background: `{colors.bg-accent-1/2/3/4}` (green/blue/purple/orange tint)
- Border: 1px border-default
- Contains a clear accent-colored element (icon, number, badge)

**`cell-gradient`** (Gradient hero cell)
- Background: linear-gradient(135deg, primary, accent-blue)
- Text: white
- Radius: radius-xl
- No border

**`cell-image`** (Screenshot/illustration cell)
- Background: bg-surface
- Image fills bottom 60-70% of cell (overflow hidden, object-fit: cover)
- Text header at top: 30-40% of cell
- Border: 1px border-default

### Metric Cells

**`metric-card`**
- Layout: label top, huge number middle, trend badge bottom
- Label: eyebrow style (CAPS, text-muted)
- Number: number-xl, font-weight 700, text-primary (or accent color)
- Trend: `+12%` badge in green/red tint
- Use for: user counts, revenue, performance stats

**`feature-badge`** (Small "available on" / "trusted by" cell)
- Row of logos / avatars
- Label at top, count at bottom (e.g., "10,000+ teams")
- Typography: body-sm + number-lg

### Cards (Non-grid context)

**`card-default`**
- Background: bg-surface
- Border: 1px border-default
- Radius: radius-lg
- Padding: space-6
- Shadow: none (flat, Bento aesthetic)

### Buttons

**`button-primary`** (Dark)
- Background: `{colors.primary}` (#09090B)
- Text: white
- Typography: button
- Radius: radius-full (pill shape)
- Padding: 10px 20px
- Hover → background: primary-hover

**`button-secondary`** (White)
- Background: white
- Text: text-primary
- Border: 1px border-default
- Radius: radius-full
- Padding: 10px 20px
- Hover → border: border-strong

**`button-icon-round`** (Circle icon button)
- Background: bg-surface
- Border: 1px border-default
- Radius: full
- Size: 36px × 36px
- Hover → bg-elevated

### Badges & Pills

**`badge-default`**
- Background: bg-elevated
- Text: text-secondary
- Border: 1px border-default
- Typography: label-sm
- Radius: full
- Padding: 4px 10px

**`badge-accent-{color}`**
- Background: accent tint (e.g., green-50 for accent-green)
- Text: accent dark (e.g., green-700)
- Border: 1px accent at 30% opacity
- Radius: full

**`pill-eyebrow`** (Section eyebrow)
- Background: bg-elevated
- Text: text-muted
- Typography: eyebrow (CAPS, mono or label)
- Radius: full
- Padding: 4px 12px
- Border: 1px border-default
- Used ABOVE section headings

### Navigation

**Header:**
- Background: rgba(255,255,255,0.80) + backdrop-blur(12px)
- Border-bottom: 1px border-subtle (on scroll)
- Sticky top
- Max-width: 1280px, center-aligned
- Logo + nav links + CTA button

---

## Design Principles

### The Grid IS the Layout
- The entire page is made of bento cells. No traditional "hero → features → CTA" section blocks.
- Cells can be dark, light, or accent-tinted — contrast creates visual rhythm.
- Vary cell sizes deliberately: alternating large+small creates "visual breathing."

### Dark + Light Contrast
- Dark cells (#09090B) create anchors in an otherwise light grid.
- Rule of thumb: ~20-30% dark cells, ~70-80% light cells.
- Dark cells should contain the most important messaging.

### Typography in Cells
- Cells with limited space use ONLY heading + body. No paragraph text.
- Large cells can include a visual element (screenshot, illustration, chart).
- Headlines in dark cells are always white. In light cells, near-black.

### Accent Colors = Cell Personality
- Each accent color tells a story: green = growth, blue = trust, purple = creativity.
- One accent color per cell — don't mix accents within a cell.
- Use accent tint backgrounds (not solid) for light cells. Reserve solid accents for badges/icons.

### Motion (Hover)
- Cells subtly elevate on hover: `shadow-sm` appears + slight border darkening.
- Interactive cells (linked): transform scale(1.01) or subtle translate-y(-1px).
- Avoid heavy animations — the grid should feel stable.

---

## Do's and Don'ts

### Do
- Use `grid-template-areas` or named placement for predictable layouts.
- Mix dark and light cells for visual rhythm (about 25% dark).
- Use `overflow: hidden` on all cells — let content be clipped by the cell boundary.
- Use circular/pill CTAs — they feel modern and contrast with the rectangular grid cells.
- Include at least one metric/stat cell with a large number to anchor the grid.
- Use eyebrow pills (ALL CAPS, small) above section headings.

### Don't
- Don't make all cells the same size — the grid feels alive through variety.
- Don't use more than 3 accent colors in a single bento section.
- Don't add internal borders between cell content items — cells breathe.
- Don't use gradients inside cells that already have a dark or accent background.
- Don't use text larger than display (3.5rem) inside any single cell.
- Don't mix more than 2 card styles within a single bento row.
- Don't neglect mobile reflow — test all cells at 1-column single width.

---

## Responsive Behavior

| Breakpoint | Width  | Key Changes                                            |
|-----------|--------|--------------------------------------------------------|
| xl        | 1280px | 4-col grid, full spans work                            |
| lg        | 1024px | 3-col grid; 4-col spans become full-width              |
| md        | 768px  | 2-col grid; large cells become 2-wide max              |
| sm        | 640px  | 1-col; all cells full width, stacked                   |
| xs        | 375px  | Full width; cell padding reduces to 16px               |

Bento gap: 12px on desktop, 8px on mobile.

---

## Tailwind Quick Reference

```
grid:       grid grid-cols-4 gap-3
cell:       bg-zinc-50 border border-zinc-200 rounded-2xl p-6 overflow-hidden
cell-dark:  bg-[#09090B] border border-white/10 rounded-2xl p-6
cell-2col:  col-span-2
cell-2row:  row-span-2
btn-dark:   bg-[#09090B] text-white rounded-full text-sm font-semibold px-5 py-2.5
btn-light:  bg-white border border-zinc-200 text-zinc-900 rounded-full text-sm font-semibold px-5 py-2.5
badge:      bg-zinc-100 border border-zinc-200 text-zinc-500 rounded-full text-xs font-medium px-2.5 py-1
eyebrow:    text-xs font-semibold tracking-widest uppercase text-zinc-400
number-xl:  text-6xl font-bold tracking-tight text-zinc-900
```
