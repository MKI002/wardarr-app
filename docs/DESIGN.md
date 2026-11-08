# Wardarr design guide

This guide is binding for every change to the web UI. A new page, panel or
widget follows it from the first commit; a change that breaks one of the rules
below needs a good reason in the pull request.

Wardarr is a night watch for the media stack: the guardian ("Schildwache")
keeps an eye on everything so the person doesn't have to. The UI should feel
calm, playful and considered. It shows what matters at a glance and explains
the rest when asked.

## Principles

1. **Picture first, text second.** If a value is a share, a trend, a limit or
   a state, draw it. A sentence explains the picture; it never replaces it.
2. **One focus per view.** Every page opens with one hero: the single number
   or picture that answers "is everything fine here?". Details follow below.
3. **Say it like a person.** Under a big number goes one plain sentence
   ("4 services need a look."), not a label soup.
4. **Status colours mean status.** Green, amber, red and blue are only used for
   ok, warning, critical and info. Magnitudes (plays, speed, counts) use the
   accent violet.
5. **Nothing waits for an animation.** Every value is readable in the first
   frame. Motion adds life; it never hides or delays content.
6. **Show actions where they apply.** Each row shows at most one primary
   action; the rest go into an `ActionMenu`. Never hide content or actions
   behind an opacity hover.

## Tokens

Colours live in `apps/web/src/app.css` as CSS variables, defined for both
themes. Never use a literal colour in a component.

| Token                                          | Use                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `--bg`, `--surface`, `--surface-2`, `--border` | page, cards, tracks and quiet fills, hairlines                                   |
| `--text`, `--muted`                            | primary and secondary text                                                       |
| `--accent`                                     | magnitudes, selection, the guardian, primary buttons                             |
| `--ok`, `--warning`, `--critical`, `--info`    | status **text** (badges, labels)                                                 |
| `--warning-mark`                               | warning as a **mark** (dots, bars, ring segments); brighter than the text colour |
| `--*-bg`                                       | tinted backgrounds for status badges and icons                                   |
| `--glow-opacity`                               | strength of the ambient night glow behind the app                                |

Text must meet WCAG AA (4.5:1) in both themes; marks meet 3:1 against the
card surface. For lighter steps of a colour use `tint(tone, percent)` from
`components/charts.tsx`, which mixes with the surface. Do not use CSS opacity
on content (see _Motion_).

## Type and layout

- Page header: `PageHeader` from `components/dash.tsx`: an uppercase eyebrow
  (date, section or instance), the title in `text-3xl`/`text-4xl` bold, an
  optional one-line intro and actions on the right.
- Hero numbers: `text-6xl` bold, proportional figures, rolled in with
  `Odometer`. One hero number per view.
- Card numbers: `text-3xl` semibold. Columns of numbers use `tabular-nums`.
- Section labels: `SectionRule` (uppercase label plus hairline) between groups
  of cards; `SectionTitle` inside a card.
- Cards: `Card` from `components/ui.tsx`. It brings the radius, border and the
  soft pointer glow. Do not nest cards in cards; use `bg-surface-2` blocks.
- Grids collapse to one column on phones. Keep 16 px gutters, no horizontal
  page scroll, and leave room for the bottom tab bar on phones.

## Navigation

Pages live in a sidebar on screens from 1024 px, grouped into four sections
by the question a person opens Wardarr with:

| Section    | Question                     | Pages                                                |
| ---------- | ---------------------------- | ---------------------------------------------------- |
| Status     | Is everything fine?          | Overview, Issues, Map                                |
| Media      | What is there to watch?      | Discover, Requests, Library, Quality score, Calendar |
| Automation | What does Wardarr do for me? | Queue Cleaner, Hunting, TRaSH Guides, Tdarr          |
| System     | How is the stack underneath? | Indexers, Indexer insights, Storage                  |

Settings (with backups) and the account menu sit apart at the bottom. The sidebar folds to an
icon rail and every section folds on its own; both are remembered per browser.
Phones get a bottom bar with four pages plus "Menu", a sheet with every page
by section. `Ctrl K`, `⌘K` or `/` opens the command palette for pages,
settings sections and services.

Adding a page:

1. Add the tab to `TABS` in `apps/server/src/overview/routes.ts` (who may see
   it and which capability it needs).
2. Put its id into a section in `GROUPS`, its path into `TAB_PATHS` and a
   24 px stroke icon into `ICONS` in `apps/web/src/components/nav/model.tsx`.
   A tab without a section still shows up, at the end of System.
3. Add `ui.tabs.<id>` in English and German, and a few search words for the
   palette in `SYNONYMS` (`nav/CommandPalette.tsx`).

Only a page that answers its own question gets an entry. Another view of the
same thing (a history, a detail list) usually belongs in a tab inside that page.

## Building blocks

Use these before writing a new chart. They share colours, motion, tooltips and
accessibility.

| Component                   | File             | For                                                                                    |
| --------------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| `Ring`                      | `charts.tsx`     | a whole split into states (services, indexers) with a centre label                     |
| `Gauge`                     | `charts.tsx`     | one value against a limit (API budget)                                                 |
| `Sparkline`                 | `charts.tsx`     | a recent trend with hover values                                                       |
| `Columns`                   | `charts.tsx`     | counts over time, optionally stacked by status, with hover tooltip and axis            |
| `SegmentBar`                | `charts.tsx`     | parts of a whole; thin beside text, `tall` with shares and legend when it stands alone |
| `Heatmap`                   | `charts.tsx`     | a grid of counts (weekday × hour)                                                      |
| `ProgressRing`, `BarRow`    | `charts.tsx`     | progress of one item, a ranked list                                                    |
| `LiveDot`                   | `charts.tsx`     | something running right now                                                            |
| `Radar`                     | `Radar.tsx`      | the overview centrepiece: every service as a blip                                      |
| `PageHeader`, `SectionRule` | `dash.tsx`       | page and section structure                                                             |
| `Odometer`                  | `dash.tsx`       | big numbers that roll into place                                                       |
| `KpiCard`, `MiniBars`       | `dash.tsx`       | a key figure with a small trend chart                                                  |
| `InsightRow`                | `dash.tsx`       | "worth a look" rows: icon, sentence, action                                            |
| `IssueIcon`                 | `IssueIcon.tsx`  | what kind of problem an issue is, tinted by severity                                   |
| `Funnel`                    | `charts.tsx`     | stages that narrow (downloads → strikes → removals, searched → found → imported)       |
| `InstanceChips`             | `dash.tsx`       | picking one instance of a feature, with logo and a status dot or count                 |
| `ActionMenu`                | `ActionMenu.tsx` | the rare actions of a row (ignore, delete, open elsewhere) behind a "more" button      |
| `Choice`                    | `ui.tsx`         | a small set of exclusive options; the selection slides between them                    |
| `Guardian`                  | `ui.tsx`         | the logo; below 40 px it opens its eye wider and drops the glint by itself             |

### Choosing a chart

| The reader should...               | Use                                                 |
| ---------------------------------- | --------------------------------------------------- |
| see one current value              | a hero number or `KpiCard`                          |
| see a value against a limit        | `Gauge` or a meter bar                              |
| see how a whole splits (≤ 6 parts) | `SegmentBar` (`tall` when alone), `Ring` for states |
| compare items                      | `BarRow` list, largest first                        |
| see change over time               | `Sparkline` (trend), `Columns` (counts per day)     |
| see when something happens         | `Heatmap`                                           |
| see many items × many items        | a matrix of status cells                            |
| see how many get through stages    | `Funnel`                                            |
| see what happens next over time    | a timeline strip with one mark per planned event    |

Never a pie chart, never two y-axes, never a generated rainbow. More than six
parts fold into "Other".

### Chart rules

- Bars at most 24 px thick, 4 px rounded at the data end, square at the
  baseline; 2 px gaps between touching segments.
- Lines 2 px, an end dot of 8 px with a 2 px surface ring, area fills at about
  10 % of the line colour.
- Gridlines are hairlines one step off the surface; label the axis ends and
  the maximum, not every tick.
- Text in charts uses text tokens, never the series colour.
- Every chart has an accessible name (`aria-label` or `role="img"` with a
  summary) and a hover/focus tooltip where values are not printed.
- A single series needs no legend; two or more always get one.

## Motion

Playful but minimal. Implemented with `motion/react`, CSS keyframes for
ambient loops.

- Entrances: springs (`spring` from `ui.tsx`) or 300–600 ms ease-out. Cards
  rise 8–10 px and fade in, staggered by 40–60 ms.
- Charts draw in: rings and lines trace their path, bars grow from the
  baseline, heatmap cells pop in diagonally, numbers roll (`Odometer`) or
  count (`CountUp`).
- Live things breathe: `LiveDot` pulses, download progress carries moving
  stripes whose speed follows the download speed, the radar beam turns.
- Ambient: the night glow drifts over tens of seconds; it is barely visible.
- **Reduced motion:** use `useCalm()` (it follows the system setting and
  Wardarr's own preference) and pass `initial={false}` when calm. CSS loops
  are switched off in `app.css` for both `prefers-reduced-motion` and
  `data-motion="reduce"`. A calm UI shows the final state immediately.
- **No content may rest below full opacity.** Animate opacity only on the way
  in. The e2e tab test fails when an element inside `<main>` keeps an inline
  opacity below 1. For lighter colours use `tint()`.
- View and tab switches use `ViewTransition` from `ui.tsx` (enter only).
  Never wrap keyed views in `AnimatePresence mode="wait"`.
- Canvas animations pause off screen and in background tabs.

## Copy

- Sentence case everywhere, no trailing colons.
- Name things by what people recognise ("Downloads", not "queue items").
- Numbers come with their unit and a time frame ("Peak 64 MB/s in the last
  hour").
- Empty states show the guardian and say what will appear and how to get
  there.
- Every string goes through i18n, in English and German.

## Accessibility

- Keyboard: everything clickable is a button or link with a visible focus
  ring; chart marks with tooltips are focusable.
- Colour is never the only signal: status comes with an icon, label or text.
- Contrast: text 4.5:1, marks 3:1, in both themes.
- Test both themes, both languages, a 400 px wide phone and reduced motion
  before opening a pull request. The demo (`pnpm --filter @wardarr/web
dev:demo`) has realistic data for this.
