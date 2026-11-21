# Design Tokens & Visual Foundation

This directory documents the Relay styling tokens and visual system defined in `styles.css`.

## Color Palette

### Greys & Backgrounds
- `--bg-void`: `#07060b` (Deepest canvas base)
- `--bg-0`: `#0b0a10` (App canvas background)
- `--bg-1`: `#12111a` (Surface layer 1)
- `--bg-2`: `#181622` (Surface layer 2)
- `--bg-3`: `#201d2e` (Surface layer 3)

### Dark Purple (Plum)
- `--plum-900`: `#1a0f2e`
- `--plum-800`: `#24163b`
- `--plum-700`: `#2e1a47`

### Violet, Vibe & Lavender
- `--violet-700`: `#6d28d9`
- `--violet-600`: `#7c3aed`
- `--vibe-500`: `#8b5cf6`
- `--vibe-600`: `#a855f7`
- `--lav-300`: `#c4b5fd`
- `--lav-200`: `#ddd6fe`

### Text & Contrast (>= 4.5:1 on --bg-1)
- `--text`: `#f3f0ff` (Primary text)
- `--text-2`: `#b7b0d0` (Secondary text)
- `--text-3`: `#8a83a3` (Micro-labels & muted text)

### Lines & Borders
- `--line`: `rgba(196, 181, 253, 0.10)`
- `--line-strong`: `rgba(196, 181, 253, 0.22)`

### Status (Toasts & Errors only)
- `--ok`: `#34d399`
- `--err`: `#f87171`

### Signature Gradient
- `--grad`: `linear-gradient(135deg, #6d28d9 0%, #8b5cf6 55%, #a855f7 100%)`

## Typography

- `--font-body`: `'Inter Variable', sans-serif`
- `--font-display`: `'Space Grotesk Variable', sans-serif` (Wordmark, headings)
- `--font-mono`: `'JetBrains Mono Variable', monospace` (IDs, models, numbers)
- **Type scale**: `12px`, `13px`, `14px`, `15px`, `18px`, `24px`, `32px`
- **Body default**: `15px / 1.6`
- **Allowed font weights**: `400`, `500`, `600` ONLY (never 700+)
- **Uppercase micro-labels**: `11px`, weight `500`, letter-spacing `0.06em`, color `--text-3`
- **Tabular figures**: `font-variant-numeric: tabular-nums` for all metrics

## Spacing & Radii

- **Spacing scale**: `4px`, `8px`, `12px`, `16px`, `20px`, `24px`, `32px`, `48px`
- **Radii**: `8px` (`--radius-sm`), `12px` (`--radius-md`), `16px` (`--radius-lg`), `20px` (`--radius-xl`)

## Elevation & Glass Surfaces

- `--shadow-1`: Subtle card elevation (`0 4px 12px -2px rgba(0, 0, 0, 0.4)`)
- `--shadow-2`: Raised elevation (`0 12px 32px -8px rgba(0, 0, 0, 0.6)`)
- `--glow`: Radial purple glow (`0 0 0 1px rgba(139,92,246,.35), 0 8px 30px -8px rgba(139,92,246,.45)`)
- **Glass surfaces**: `background: rgba(24, 22, 34, 0.72)`, `backdrop-filter: blur(14px)`, `border: 1px solid var(--line)`, `box-shadow: inset 0 1px 0 rgba(221, 214, 254, 0.06)`
- **Atmosphere**: Base `--bg-0` with two blurred radial aurora blobs (`--plum-700` and `--violet-600` at 14–18% opacity) and a 3% opacity SVG turbulence noise overlay.
