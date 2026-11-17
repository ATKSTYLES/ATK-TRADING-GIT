# ATK Deck V2 — Design System Specification

## 1. Visual Philosophy
Minimalist, professional, Notion-inspired workspace optimized for clarity, speed, and zero visual clutter. Single-level flat elevation with hairline `1px` borders instead of nested boxes, heavy gradients, or pill-badge clutter.

## 2. Color Tokens
### Light Mode
- Canvas Background: `#FAFAFA`
- Surface / Card: `#FFFFFF`
- Subtle Surface: `#F5F5F5`
- Hairline Border: `#E5E7EB`
- Primary Text: `#111827`
- Secondary Text: `#4B5563`
- Muted Metadata: `#6B7280`

### Dark Mode (`.dark` class on `<html>`, `@custom-variant dark`)
- Canvas Background: `#0B0E14`
- Surface / Card: `#111622`
- Subtle Surface: `#171C28`
- Hairline Border: `#1F2937`
- Primary Text: `#F3F4F6`
- Secondary Text: `#D1D5DB`
- Muted Metadata: `#9CA3AF`

### Semantic Status Tokens (Paired with Text Labels)
- Positive / Win / Live: `#16A34A` (Light) / `#34D399` (Dark)
- Negative / Loss: `#DC2626` (Light) / `#F87171` (Dark)
- Caution / Missed / Out-of-Session: `#D97706` (Light) / `#FBBF24` (Dark)
- Attended Zero-Trade / Info: `#0284C7` (Light) / `#38BDF8` (Dark)

## 3. Typography Tokens
- Display / Headings: `'Plus Jakarta Sans', sans-serif` (weights 500, 600, 700)
- Body Prose / UI: `'DM Sans', sans-serif` (weights 400, 500)
- Telemetry / Numbers / Timestamps: `'JetBrains Mono', monospace` with `font-variant-numeric: tabular-nums`

## 4. Layout & Spacing Scale
- Sidebar width: `248px` fixed on desktop (`lg:`), slide-over drawer on mobile.
- Top header height: `56px` (`h-14`).
- Main content max-width: `1320px`, horizontal padding `16px`–`32px`.
- Card padding: `16px`–`24px`, radius `8px` (`rounded-lg`), `1px` border.
- Table row height: `36px`–`40px`, left-aligned text, right-aligned tabular numeric columns.

## 5. Component Discipline
- **Zero-Pill Metadata**: Dates, tags, and statuses use unboxed typography with `·` separators rather than rounded pill chips.
- **Segmented Controls**: Interactive filter bars use subtle neutral container backgrounds (`p-1 rounded-lg`) with active elevated tab buttons.
- **Buttons**: Primary CTA uses solid high-contrast neutral (`#111827` / `#F3F4F6`), secondary uses `1px` hairline border, destructive uses crimson outline/fill.
- **Charts**: Crisp SVG curves (`EquityCurveSvg`) with dashed zero-baseline and tabular min/max annotations.
