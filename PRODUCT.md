# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The product serves two authenticated guild audiences:

- **Guild members (viewer role):** members receive shared guild credentials or another access mechanism to be defined later. They can view guild progress, member activity, boss results, rankings, and other shared information. Their experience is strictly read-only and must not expose controls that modify data.
- **Guild officers (admin role):** leaders and vice-leaders monitor participation, activity, warnings, absences, and guild rules. They can manage officer-only information and perform explicitly authorized administrative actions.

Guild members may also consume selected information through a Discord bot backed by the same API.

## Product Purpose

The product centralizes structured guild information extracted from game screenshots and makes it useful through the Web interface, API, and Discord bot. It provides two complementary outcomes:

- operational monitoring so officers can verify that members connect, complete expected activities, participate in bosses, donate, and follow guild requirements;
- an enjoyable progression view so the guild can understand how it is advancing in the game over time.

Success means members can quickly understand guild progress without changing data, while officers can identify exceptions and take appropriate actions without manually reconciling screenshots or disconnected records.

## Positioning

The product turns recurring Archero 2 guild screenshots into a persistent, reviewable guild history. It connects source observations, member identity, participation rules, progression trends, officer follow-up, an API, and Discord access in one guild-specific system.

## Operating Context

- Screenshot-derived data is imported into the guild data system.
- The Web application provides viewer and officer experiences over the validated data.
- The API exposes selected information for integrations, including a Discord bot used by guild members.
- Members use the viewer interface to follow collective progress and results.
- Leaders and vice-leaders use Admin surfaces to monitor compliance, investigate exceptions, and manage warnings or related follow-up.
- The product is used on desktop and mobile, including quick checks during guild activities and boss windows.

## Capabilities and Constraints

- The viewer role is read-only. It must never expose data mutation controls.
- The admin role may expose authorized management actions with clear feedback and safeguards.
- Viewer and Admin information architecture may differ when their jobs differ.
- The current interface language is English only. French localization may be considered later but is not part of the current work.
- The current refactor covers the Web interface only.
- OCR UI and OCR workflow changes are explicitly outside this visual refactor and must be handled separately.
- Existing API, ingestion, data contracts, permissions, routes, and validated business rules must remain functional unless a separate task explicitly changes them.
- The future member authentication model is undecided; shared guild credentials are possible but not confirmed as the final security model.

## Brand Commitments

- The interface represents an Archero 2 guild and should feel more specific than a generic analytics product.
- The visual identity should remain suitable for an operational tool: game character may support recognition and motivation without reducing clarity or turning officer workflows into decorative fantasy UI.
- Guild identity, current boss context, weekly game rhythms, rankings, and progression are authentic product materials.

## Evidence on Hand

- Existing working Web application and design tokens: `web/styles.css`.
- Main product surface and workflows: `web/app/components/DashboardApp.jsx`.
- Role-aware navigation: `web/app/components/AppSidebar.jsx` and `web/lib/navigation.js`.
- Existing boss artwork: `web/public/bosses/`.
- Deterministic synthetic guild history for isolated testing: `web/lib/demo-data.js`.
- Existing API documentation and contracts under `docs/` and `web/app/api/`.
- No additional guild crest, official brand guide, custom typeface, or approved visual reference has been provided. Future work must not fabricate those assets or treat placeholders as official guild identity.

## Product Principles

1. **Read-only means unmistakably read-only.** Members should understand and explore the guild without encountering officer controls or ambiguous actions.
2. **Exceptions before inspection.** Officer surfaces should expose what needs attention and provide a direct path to the affected members or activity.
3. **Progress should feel rewarding.** Guild improvement, boss performance, participation, and records should be understandable and satisfying to follow over time.
4. **One source, consistent meaning.** Web, API, and Discord representations should use compatible terminology and explain denominators, dates, freshness, and aggregation consistently.
5. **Operational clarity outranks decoration.** Archero-specific identity should strengthen recognition and motivation while preserving scanability, accessibility, and trust.

## Accessibility & Inclusion

- The Web application must remain usable on desktop and mobile.
- Navigation, filters, charts, forms, warnings, and administrative actions must be keyboard accessible and expose their state programmatically.
- Touch targets, focus states, text contrast, reduced-motion preferences, loading states, empty states, and error recovery must remain usable.
- Visual status cannot rely on color alone.
