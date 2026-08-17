# DESIGN.md — Warm Editorial
> Version: 1.0 | Mood: 溫暖、沉思、有質感
> Reference: The Atlantic, Substack, Readwise, Ness Labs
> Best for: 部落格、電子報、個人網站、教育文章平台、知識創作

---

## Colors

### Backgrounds
```
bg-base:     #FDFBF7   ← warm off-white canvas (never pure white)
bg-surface:  #F5EFE6   ← warm cream — cards, sidebars
bg-elevated: #EDE6D9   ← hover rows, selected items, callout blocks
bg-dark:     #1C1410   ← dark mode headers, dark callouts
```

### Primary (Terracotta)
```
primary-100: #F7DED5
primary-300: #E8A898
primary-500: #C4644A   ← PRIMARY — terracotta
primary-600: #A84F38   ← hover
primary-700: #8C3E2A   ← pressed, active
```

### Accent (Sage Green)
```
accent-100: #DDE8D8
accent-300: #A8C49E
accent-500: #6B9E60   ← sage green accent
accent-600: #557D4C
```

### Text
```
text-primary:   #1C1410   ← near-black warm brown
text-secondary: #5C4F42   ← warm mid-brown
text-muted:     #9B8E83   ← placeholder, footnotes
text-inverse:   #FDFBF7   ← text on dark surfaces
text-accent:    #C4644A   ← links, emphasized terms
```

### Borders
```
border-subtle:  #EDE0D0   ← barely visible dividers
border-default: #D4C5B2   ← card outlines, input borders
border-strong:  #B8A897   ← table lines, section separators
```

### Semantic
```
error:   #C4644A   ← same as primary (warm tone)
success: #6B9E60   ← same as accent
warning: #C49A2A   ← warm amber
```

---

## Typography

Font families:
- Heading: Georgia, 'Times New Roman', serif
- Body: Charter, Georgia, serif (editorial), OR Inter, system-ui, sans-serif (clean version)
- Mono: JetBrains Mono, monospace
- Display (optional): 'Playfair Display', Georgia, serif (if using web fonts)

Note: The primary differentiator is SERIF headings. Body can be serif or sans-serif depending on context.

| Token       | Size    | Weight | Line Height | Letter Spacing | Use Case                          |
|------------|---------|--------|-------------|----------------|-----------------------------------|
| display    | 3rem    | 700    | 1.05        | -0.02em        | Article hero, author page         |
| heading-xl | 2rem    | 700    | 1.10        | -0.02em        | Section title, chapter heading    |
| heading-lg | 1.5rem  | 600    | 1.20        | -0.01em        | Sub-section, card title           |
| heading-md | 1.25rem | 600    | 1.25        | 0              | Sidebar section, widget title     |
| body-lg    | 1.125rem| 400    | 1.80        | 0              | Article lead paragraph            |
| body       | 1.0625rem| 400   | 1.75        | 0.01em         | Default article body              |
| body-sm    | 0.9375rem| 400   | 1.65        | 0              | Meta, captions, footnotes         |
| label      | 0.875rem | 500   | 1.20        | 0.02em         | Tags, nav items (sans-serif)      |
| label-sm   | 0.75rem  | 500   | 1.20        | 0.04em         | Category tags (CAPS optional)     |
| button     | 0.9375rem| 500   | 1.20        | 0.01em         | Button labels (sans-serif)        |
| quote      | 1.25rem  | 400   | 1.65        | 0              | Block quotes (italic, serif)      |
| mono       | 0.875rem | 400   | 1.65        | 0              | Code blocks                       |
| eyebrow    | 0.75rem  | 600   | 1.20        | 0.12em         | Section labels (ALL CAPS)         |

Hierarchy: Serif headings → warm brown body → muted metadata. Never use color for hierarchy — only font weight and size.

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
space-12: 48px
space-16: 64px
section:  100px–140px   ← editorial breathes more than average
```

Article line length: 65–72 characters (max-width ~700px for body text).

---

## Border Radius

```
radius-none: 0px    ← blockquotes, code blocks (left-border style)
radius-xs:   4px    ← tags
radius-sm:   6px    ← small cards, badges
radius-md:   8px    ← buttons, inputs
radius-lg:   12px   ← cards, panels
radius-xl:   16px   ← modals
radius-full: 9999px ← pill avatars
```

---

## Elevation Model

No blue-tinted or cold shadows — all shadows use warm tones.

- **Level 0** — bg-base (#FDFBF7). Page canvas.
- **Level 1** — bg-surface (#F5EFE6) + border-subtle. Sidebar, inline panels.
- **Level 2** — bg-surface + border-default + shadow-warm-sm. Cards, callouts.
- **Level 3** — bg-elevated + border-strong. Selected/hovered cards.
- **Level 4** — bg-dark (#1C1410) text-inverse. Dark callout blocks, pull quotes.

```
shadow-warm-sm: 0 2px 8px rgba(140,80,50,0.08)
shadow-warm-md: 0 4px 16px rgba(140,80,50,0.12)
shadow-warm-lg: 0 8px 32px rgba(140,80,50,0.16)
```

---

## Components

### Buttons

**`button-primary`** (Terracotta)
- Background: `{colors.primary-500}` (#C4644A)
- Text: white
- Typography: `{typography.button}`, sans-serif
- Radius: `{radius.md}`
- Padding: 10px 22px
- Hover → background: `{colors.primary-600}`

**`button-secondary`**
- Background: transparent
- Text: `{colors.text-primary}`
- Border: 1.5px `{colors.border-strong}`
- Radius: `{radius.md}`
- Padding: 10px 22px
- Hover → background: `{colors.bg-elevated}`

**`button-ghost`** (text link style)
- Background: transparent
- Text: `{colors.text-accent}`
- Underline: 1px underline on hover
- No border, no shadow

**`button-subscribe`** (Newsletter CTA)
- Background: `{colors.bg-dark}` (#1C1410)
- Text: `{colors.text-inverse}`
- Typography: `{typography.button}`
- Radius: `{radius.md}`
- Padding: 12px 28px
- Hover → background: #2D2118

### Cards & Content

**`card-article`**
- Background: `{colors.bg-base}`
- Border-bottom: 1px `{colors.border-subtle}` (no box, just separator)
- Padding-bottom: `{space-6}`
- Image: full-width, border-radius `{radius.sm}`, warm filter optional

**`card-featured`**
- Background: `{colors.bg-surface}`
- Border: 1px `{colors.border-default}`
- Radius: `{radius.lg}`
- Padding: `{space-6}`
- Shadow: `{shadow-warm-md}`

**`card-newsletter`** (Subscription box)
- Background: `{colors.bg-elevated}`
- Border: 1px `{colors.border-default}`
- Radius: `{radius.lg}`
- Padding: `{space-8}`
- Text-align: center

**`blockquote`**
- Border-left: 3px solid `{colors.primary-500}`
- Padding-left: `{space-5}`
- Typography: `{typography.quote}`, italic
- Color: `{colors.text-secondary}`
- Background: transparent

**`callout`** (Note, Insight, Warning)
- Background: `{colors.bg-surface}`
- Border-left: 4px solid `{colors.primary-500}` (or accent-500 for tips)
- Border: 1px `{colors.border-subtle}`
- Radius: 0 `{radius.md}` `{radius.md}` 0
- Padding: `{space-4}` `{space-5}`

**`pullquote`** (Large editorial pull quote)
- Background: `{colors.bg-dark}`
- Color: `{colors.text-inverse}`
- Typography: `{typography.heading-lg}`, italic, serif
- Padding: `{space-8}`
- Radius: `{radius.md}`
- No border

### Badges & Tags

**`tag-category`**
- Background: `{colors.bg-surface}`
- Text: `{colors.text-secondary}`
- Border: 1px `{colors.border-default}`
- Typography: `{typography.label-sm}`
- Radius: `{radius.full}`
- Padding: 3px 10px
- Hover → border: `{colors.primary-300}`

**`tag-featured`**
- Background: `{colors.primary-100}`
- Text: `{colors.primary-700}`
- Border: 1px `{colors.primary-300}`
- Typography: `{typography.label-sm}`
- Radius: `{radius.full}`

**`eyebrow-label`**
- Text: `{colors.text-muted}`
- Typography: `{typography.eyebrow}` (ALL CAPS, wide tracking)
- No background, no border
- Used above article titles

### Reading Progress / Metadata

**`reading-meta`** (author + date + reading time)
- Typography: `{typography.body-sm}`, `{typography.label}`
- Color: `{colors.text-muted}`
- Layout: flex row, gap `{space-3}`, divider via `·` character

---

## Design Principles

### Warmth Through Color Temperature
- All backgrounds, shadows, and borders use warm-toned neutrals — never cold grays.
- The page should feel like warm paper, not a screen.
- Text is near-black warm brown, not pure #000000.

### Serif = Authority
- Headings use serif fonts. This communicates depth, credibility, and editorial intentionality.
- Sans-serif is for UI chrome (buttons, labels, navigation) — not for content.
- Never use sans-serif for the main article body in a full editorial layout.

### Breathing Room
- Editorial layouts require MORE whitespace than typical UI.
- Section spacing is 100–140px. Article sections breathe.
- Line height is 1.75–1.80 for comfortable long-form reading.

### Terracotta as a Warm Signal
- Terracotta (#C4644A) replaces cold blue as the interactive color.
- Links, CTAs, and focus rings all use terracotta — never blue.
- Sage green is used as a secondary accent (success, tags, secondary actions).

### Photography Integration
- Images should feel editorial: slightly warm, not oversaturated.
- Optional: apply a warm CSS filter (`sepia(10%) saturate(90%)`)
- Image captions are always `{typography.body-sm}` + `{colors.text-muted}` + centered.

---

## Do's and Don'ts

### Do
- Use serif fonts for all headings and pull quotes.
- Maintain 1.75–1.80 line height for body text.
- Use warm off-white (#FDFBF7) as the page canvas — never pure white.
- Use generous article max-width (700px) for comfortable reading.
- Use terracotta (#C4644A) for all links and primary CTAs.
- Use eyebrow labels (ALL CAPS, wide tracking) above article titles.
- Use the dark callout (`bg-dark`) for high-impact pull quotes.

### Don't
- Don't use cold grays (#f5f5f5, #e0e0e0) — everything should feel warm.
- Don't use blue for any interactive states — terracotta replaces blue entirely.
- Don't use sans-serif for article body in editorial mode.
- Don't use shadows with blue tint — use warm brown-tinted shadows only.
- Don't use gradients — this theme is flat and editorial.
- Don't use border-radius larger than 16px — editorial feels restrained.
- Don't put more than one primary CTA per article card.

---

## Responsive Behavior

| Breakpoint | Width  | Key Changes                                            |
|-----------|--------|--------------------------------------------------------|
| lg        | 1024px | Two-column: main article + sidebar                     |
| md        | 768px  | Single column; sidebar becomes below-fold              |
| sm        | 640px  | Article padding reduces; display font scales to 2rem   |
| xs        | 375px  | Full-width; body font stays at 1rem; no serif on label |

Article body max-width: 700px. On mobile: full width minus 32px padding.

---

## Tailwind Quick Reference

```
page-bg:       bg-[#FDFBF7]
surface:       bg-[#F5EFE6]
elevated:      bg-[#EDE6D9]
text-primary:  text-[#1C1410]
text-muted:    text-[#9B8E83]
text-accent:   text-[#C4644A]
border:        border-[#D4C5B2]
card:          bg-[#F5EFE6] rounded-xl border border-[#D4C5B2]
blockquote:    border-l-4 border-[#C4644A] pl-5 italic text-[#5C4F42]
btn-primary:   bg-[#C4644A] hover:bg-[#A84F38] text-white rounded-lg
tag:           bg-[#F5EFE6] border border-[#D4C5B2] text-[#9B8E83] rounded-full text-xs px-2.5
eyebrow:       text-xs font-semibold tracking-widest uppercase text-[#9B8E83]
pullquote:     bg-[#1C1410] text-[#FDFBF7] rounded-xl p-8 italic
```
