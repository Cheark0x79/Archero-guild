---
name: "Archero 2 Guild Dashboard"
description: "A precise, tactical field ledger for shared guild progress and officer operations."
colors:
  canvas: "oklch(96.8% 0.005 250)"
  surface: "oklch(99.2% 0.002 250)"
  surface-subtle: "oklch(94.2% 0.01 250)"
  surface-strong: "oklch(89.5% 0.016 250)"
  surface-hover: "oklch(97.2% 0.008 250)"
  ink: "oklch(20% 0.025 250)"
  muted-ink: "oklch(43% 0.03 250)"
  divider: "oklch(84% 0.018 250)"
  field-cyan: "oklch(52% 0.15 225)"
  field-cyan-soft: "oklch(93% 0.035 225)"
  field-cyan-dark: "oklch(38% 0.13 225)"
  success: "oklch(50% 0.13 155)"
  warning: "oklch(64% 0.16 70)"
  danger: "oklch(55% 0.18 25)"
  info: "oklch(55% 0.13 225)"
  rail: "oklch(22% 0.028 250)"
  rail-surface: "oklch(26% 0.035 250)"
  rail-hover: "oklch(30% 0.035 250)"
  rail-text: "oklch(86% 0.018 250)"
  rail-muted: "oklch(76% 0.025 250)"
  brand-cyan: "oklch(67% 0.15 225)"
  focus-cyan: "oklch(72% 0.11 225)"
  white: "white"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.15
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.45
rounded:
  compact: "6px"
  default: "8px"
  panel-lg: "12px"
  shield: "10px 10px 18px 18px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.field-cyan}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.default}"
    padding: "0 14px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.field-cyan-dark}"
    textColor: "{colors.white}"
    rounded: "{rounded.default}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.default}"
    padding: "0 12px"
    height: "38px"
  navigation-active:
    backgroundColor: "{colors.field-cyan-dark}"
    textColor: "{colors.white}"
    rounded: "{rounded.default}"
    padding: "10px 12px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.default}"
    padding: "16px"
  guild-fact:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.field-cyan-dark}"
    padding: "16px 12px"
    height: "104px"
  range-active:
    backgroundColor: "{colors.field-cyan}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.compact}"
    padding: "0 9px"
    height: "28px"
  status-symbol:
    backgroundColor: "{colors.field-cyan-soft}"
    textColor: "{colors.field-cyan-dark}"
    rounded: "{rounded.default}"
    size: "52px"
  guild-crest-placeholder:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    rounded: "{rounded.shield}"
    size: "52px 58px"
---

# Design System: Archero 2 Guild Dashboard

## Overview

**Creative North Star: "The Guild Field Ledger"**

The interface is a precise guild command center: tactical, dense, and calm. It presents captured guild facts as an operational record rather than a live-game spectacle, with a dark navy rail anchoring a cool, light data canvas. Compact typography, stable grids, and explicit capture dates let members scan progression quickly and let officers trust what they are seeing.

The visual system is flat and ledger-like. Tonal surfaces and thin separators organize information; cyan marks selected navigation, chart data, links, and key totals without flooding the screen. Archero specificity comes from real guild context and the exact boss assets already shipped with the product—not fabricated crests, generic fantasy scenery, or decorative boss imagery.

**Key Characteristics:**

- Dense but unhurried operational layout.
- Cool, flat surfaces with thin structural dividers.
- Rare cyan emphasis for data, state, and navigation.
- Explicit freshness labels and captured-date context.
- Exact boss artwork used only where it identifies a real recorded boss.

## Colors

The palette pairs a cool paper-like canvas with a navy command rail; cyan is a scarce functional signal, while green, amber, and red remain semantic status colors.

### Primary

- **Field Cyan:** The principal data and interaction accent, used for chart lines, active range controls, links, and primary actions.
- **Deep Field Cyan:** The stronger cyan used for high-value totals, active rail navigation, and primary hover states.
- **Pale Field Wash:** A restrained cyan tint behind compact status symbols and chart areas.

### Neutral

- **Cool Ledger Canvas:** The application background that keeps the dense dashboard quiet.
- **Paper Surface:** The near-white panel and control surface.
- **Subtle and Strong Tonal Surfaces:** Adjacent layers for hover feedback, segmented controls, empty states, and tracks.
- **Ledger Ink:** The high-contrast text color for headings, values, and controls.
- **Muted Ledger Ink:** Supporting copy, labels, timestamps, and axis text.
- **Hairline Divider:** The single-pixel structure around panels, facts, controls, and row divisions.
- **Command Rail:** The dark navigation plane with softened light text and quieter secondary labels.

### Named Rules

**The Rare Signal Rule.** Field Cyan is reserved for current state, navigational intent, and plotted data; it must not become a decorative wash across large surfaces.

**The Captured Truth Rule.** Semantic color reinforces a labeled state and never substitutes for text, dates, values, or accessible state.

## Typography

**Display Font:** Inter (with system sans-serif fallbacks)

**Body Font:** Inter (with system sans-serif fallbacks)

**Character:** One pragmatic sans-serif family keeps the interface exact and compact. Hierarchy comes from weight, size, and placement rather than editorial contrast or ornamental type.

### Hierarchy

- **Display** (700, 28px, 1.15): Page and guild titles; balanced wrapping is allowed on narrow screens.
- **Title** (700, 16px, 1.25): Panel and chart headings.
- **Body** (400, 15px, 1.45): Descriptions, status detail, and general interface copy.
- **Label** (700, 12px, 1.45): Fact labels, freshness labels, chart controls, links, and metadata. The rail also uses 11–13px supporting text where space is constrained.

### Named Rules

**The Numeric Scan Rule.** Important totals are bold and larger than their labels; supporting context stays compact and muted so the value remains the first read.

## Layout

The desktop shell uses a fixed 236px command rail and a flexible content column. The main canvas has 24px horizontal padding, while dashboard groups use a consistent 16px gap. The identity header, five-part fact band, wide guild-power trajectory, quick-status ledger, and three equal trend cards form a clear top-to-bottom reading order.

At 980px, the shell becomes one column, the power/status pair stacks, and the trend grid moves to two columns with its final card spanning the row. At 700px, the rail becomes a sticky 52px-high mobile header with an explicit Menu control; content padding drops to 16px, the trend grid becomes one column, and status links move beneath their copy. The fact band uses two columns below 700px and one column below 420px. Charts swap their wide and compact SVG variants below 700px rather than squeezing labels.

Spacing follows a compact 4/8/12/16/24/32px rhythm. Panels and major dashboard regions keep 16px internal padding; data rows may use smaller increments when they preserve 38–52px control and status targets.

## Elevation & Depth

The dashboard is flat at rest. Depth is conveyed by the contrast between canvas, surface, and secondary tonal surfaces, plus one-pixel dividers. Standard cards, facts, and charts have no shadow. A low ambient shadow exists for elevated contexts, and the sticky mobile rail uses a stronger shadow solely to separate navigation from scrolling content.

### Shadow Vocabulary

- **Ambient Low** (`0 6px 14px oklch(20% 0.025 250 / 7%)`): Reserved for genuinely elevated surfaces such as the login panel.
- **Mobile Rail Separation** (`0 8px 20px oklch(16% 0.03 250 / 18%)`): Used only under the sticky mobile navigation rail.

### Named Rules

**The Flat Ledger Rule.** Dashboard panels remain flat at rest; use tonal contrast and dividers before considering shadow.

## Shapes

The dominant shape is a gently rounded rectangle with an 8px radius. Nested range buttons tighten to 6px, large isolated panels may reach 12px, and status pills use a full capsule. Borders are thin and cool. The shield-like A2 guild marker is the deliberate exception, with a 10px top radius and 18px lower corners; it suggests guild identity without pretending to be an official crest.

## Components

### Buttons

- **Shape:** Compact rectangle with gently curved edges (8px radius) and a 38px minimum height.
- **Primary:** Field Cyan background, white text, bold label, and 14px horizontal padding.
- **Hover / Focus:** Hover shifts to Deep Field Cyan; keyboard focus adds a 2px Focus Cyan outline with a 2px offset.
- **Secondary:** Paper Surface with a Hairline Divider border; hover uses the subtle tonal surface and the same focus outline.
- **Disabled:** Cursor and opacity change together; primary uses 0.55 opacity and secondary uses 0.45.

### Cards / Containers

- **Corner Style:** Gently rounded (8px radius).
- **Background:** Paper Surface over the Cool Ledger Canvas.
- **Shadow Strategy:** None on dashboard cards; follow the Flat Ledger Rule.
- **Border:** One-pixel Hairline Divider.
- **Internal Padding:** 16px for panels; the fact band applies 16px vertically and 12px horizontally to each fact.

### Navigation

The desktop rail is a dark, fixed-width command plane. Navigation rows use an 8px radius and 10px by 12px padding; hover is a tonal navy shift, while active state uses Deep Field Cyan with white text. On mobile, the rail collapses behind a clearly labeled Menu button, remains sticky, and exposes a single-column link list when opened. Focus states remain visible against the dark surface.

### Range Selector

The chart range control is an inline segmented group on the secondary tonal surface, with a one-pixel border and 3px inset padding. Each option is at least 28px high; the active option becomes Field Cyan with white text, while hover and focus use Paper Surface without changing layout.

### Guild Fact Band

Five facts form one continuous bordered band on desktop. Each cell is centered, at least 104px high, and separated by a single vertical divider. Labels are compact and muted; values use Deep Field Cyan and a responsive 20–28px scale. The band becomes a two-column grid on small screens and a single ledger stack at 420px.

### Quick Status Row

Status rows are full-row links with a 52px Pale Field Wash symbol, a flexible copy column, and a compact cyan route label. Rows use dividers rather than individual cards. The boss variant may show only the exact asset associated with the captured boss record; missing artwork falls back to a neutral textual mark.

### Data Chart

Charts use a 3px Field Cyan line, Paper Surface points with a 3px cyan stroke, a translucent cyan area, muted axis labels, and bold ink value labels. The chart card carries explicit scope and date language. Wide and compact SVG compositions are authored separately for readable responsive behavior.

## Do's and Don'ts

### Do:

- **Do** keep Field Cyan rare and functional: active state, route intent, plotted data, or a key total.
- **Do** pair snapshot-derived values with explicit capture or date context.
- **Do** use tonal layering and one-pixel dividers to organize dense data.
- **Do** preserve the desktop-to-mobile sequence and the authored compact chart variant.
- **Do** use exact existing boss artwork only when it identifies the corresponding captured result.

### Don't:

- **Don't** imply live data through labels such as “today” when the source is a captured snapshot.
- **Don't** add shadows to ordinary dashboard panels or fact cells.
- **Don't** turn cyan into a broad decorative background or introduce an unapproved competing accent.
- **Don't** fabricate a guild crest, boss illustration, fantasy backdrop, or generic boss imagery.
- **Don't** expose mutation controls in the viewer dashboard.
