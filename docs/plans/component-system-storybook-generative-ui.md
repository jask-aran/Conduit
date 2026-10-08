# Component system, Storybook workbench, and future generative UI

Status: design / implementation plan; **nothing in this plan is implemented by this document**.
Snapshot: `jask-aran/Conduit`, `main` tree `b2f323e756f4854785c54c1e6f2b3c9486764775` (2026-10-08).
Owner: Conduit frontend. Scope: `conduit-web`, its styles, and development tooling.

This plan records the proposed progression from Conduit's existing loose component
conventions to a browsable, tunable SolidJS design system, and subsequently to
optional model-generated native UI. It deliberately separates a near-term,
low-risk Storybook/component consolidation from later protocol and artifact work.

`DESIGN.md` remains the **normative source of visual rules and interaction
grammar**. It describes the frame/pane/frost surfaces, charcoal palette, text
roles, the selection wash, keyboard behaviour, motion, accessibility conventions,
and mobile rules. This document is a build plan, not a second visual spec.
`CONTRIBUTING.md` governs issues/commits and `docs/TESTING.md` governs validation
and environment boundaries.

## Outcomes and non-goals

The first deliverable is a **running component catalogue/editor**: one place to
inspect Conduit's actual components in isolation, switch states and variants,
preview mobile and desktop behaviour, and tune theme variables while seeing the
result immediately. The components must be the same Solid components that the
app uses, not screenshots or visually similar Storybook copies.

The second deliverable is a **coherent component API**: one canonical
implementation for each broadly reusable visual/interaction primitive, grouped
into appropriately scoped modules, with a convenient public barrel. Screens
remain compositions of primitives and feature-specific behaviour. The target is
**not one giant TSX file**, nor the mechanical conversion of every `<button>`,
`<div>`, or `.tsx` file into a component-library call.

Longer term, that component API can support an **optional, constrained,
model-facing component registry** and eventually declarative/streamed generative
UI (DIL-like markup, structured JSON, or another format). Arbitrary HTML/JS
artifacts inside sandboxed iframes are a complementary route, not something the
native component system must replace.

Non-goals for the first milestones:

- A new UI language, DIL parser, LLM tool, or generative rendering runtime.
- Adopting a second palette, icon kit, CSS design system, or React.
- A complete rewrite of the chat, Markdown renderer, terminal, editor, or
  dashboards.
- Moving all reusable UI into `jask-aran/solid-components` immediately.
- An unrestricted visual IDE that edits arbitrary TSX or writes source files.
- A blanket rule that no application code may contain native HTML elements.
- Adding TanStack, Ark UI, or a large charting dependency before a use case
  demonstrates the need.

## Existing state and design constraints

The current frontend is SolidJS + Vite + Tailwind CSS 4 + Kobalte + Geist
Variable + Lucide Solid. Existing design tokens live primarily in
`conduit-web/src/client/styles.css`, and application-specific CSS is distributed
throughout feature directories. This is a working design *system in practice*,
but not yet a discoverable, consolidated component *library*.

Currently:

- `src/components/primitives.tsx` already defines Button, Spinner, Badge,
  Field/FieldGroup/FieldLabel, Input, Textarea, menus, context menus, popovers,
  searchable popover lists, and tooltips.
- `src/components/frost.tsx` defines FrostOverlay, FrostDialog, and Keycap.
- `src/client/settings/settings-controls.tsx` defines Segmented and Switch.
- `src/client/chat/disclosure.tsx` and `step-slider.tsx` are portable controls
  presently owned by chat. Others, such as ContextGauge, QuestionCard,
  VoiceWaveform, ThinkingOrb, ToolStep and AttachmentStrip, are reusable *feature*
  components.
- `src/client/dashboard/primitives/split.tsx` and `chat-list.tsx` provide
  application-specific layout and list patterns.
- `src/client/navigation/runtime-indicator.tsx` and
  `src/client/harness-brand.tsx` provide reusable domain presentation.
- `src/client/workspace/workspace-workbench.tsx` wraps the shared Button with a
  workspace variant.
- The standalone `jask-aran/solid-components` package is currently a separate
  distribution and approval workflow for the meteor-shower implementation,
  consumed as `@jask-aran/solid-components`; its
  `scripts/solid-components-workbench.mjs` is a development/release workflow,
  **not** a visual component gallery. Keep these concepts separate.

At the recorded tree, `conduit-web/src` has **75 TSX files** and **31 CSS
files**. The listings below are a source-file inventory, **not** 75 independent
components and not a completed AST-level audit of every markup occurrence.

Important constraints from `DESIGN.md`:

- Preserve frame (permanent navigation), pane (work surface), and frost
  (floating chrome and overlays). Never apply frost indiscriminately.
- Always-dark charcoal, no blue accent, no new palette. Geist Variable and
  the existing icon conventions remain.
- Rest/current/cursor are distinct states: current is emphasized text, cursor
  is a grey wash, not an added tick, rail or decorative outline.
- Use Conduit's established focus, keyboard, fold-don't-squeeze, responsive and
  reduced-motion rules. Do not replace accessibility with appearance.
- Existing Kobalte wrappers and portal/focus handling must remain functional,
  including mobile full-screen overlays and the Android/Tauri shells.
- A component's styling should not depend silently on a specific screen's
  ancestor selectors where a reusable library contract would suffice.
- Avoid altering the live transcript's layout stability, streaming cadence,
  or first-open performance just to obtain nicer component boundaries.

## Architecture: three layers, not one TSX

1. **Application and feature compositions** — chat/transcript, dashboards,
   navigation, settings, workspace, terminal. They own domain data, routing,
   persistence and coordination. They invoke reusable UI but remain individual
   TSX modules.
2. **Conduit component library** — stable branded primitives and reusable
   patterns: Button, Input, Dialog, Menu, Switch, Disclosure, ListRow,
   SettingsRow, StatusIndicator, etc. Owns their visual grammar, supported
   variants and local interactions.
3. **Underlying behaviour and styling** — SolidJS, Kobalte, CSS tokens and
   selected headless engines. TanStack and Ark UI may be adopted later for
   particular missing behaviours; they must not replace the design system.

An eventual **fourth, opt-in model-facing registry** sits *above* the stable
components. It maps a small safe schema of model-visible component names,
properties, slots and actions onto the actual Conduit implementations. It is
not identical to the general TypeScript export barrel.

Proposed *directional* layout (final paths may change during implementation):

~~~text
conduit-web/
  .storybook/
    main.ts
    preview.tsx                    # Solid and dark-root setup
    preview-head.html              # only if genuinely needed
  src/
    components/
      ui/
        index.ts                   # public exports, not implementations
        button.tsx
        badge.tsx
        spinner.tsx
        field.tsx
        input.tsx
        textarea.tsx
        menu.tsx
        context-menu.tsx
        popover.tsx
        tooltip.tsx
        dialog.tsx
        frost.tsx                  # shared material; avoid redundant wrappers
        keycap.tsx
        switch.tsx
        segmented.tsx
        step-slider.tsx
        disclosure.tsx
      patterns/
        index.ts
        list-row.tsx
        settings-row.tsx
        status-indicator.tsx
        ...                        # only patterns demonstrated to be reused
      [feature-specific modules]    # can stay in client/ until justified
    styles/
      tokens.css                   # extracted selectively, not blindly
      ...                          # component-owned shared CSS as needed
    client/
      chat/ dashboard/ navigation/ settings/ workspace/ ...
    stories/                       # optional foundations / composed showcases
~~~

Prefer co-located `*.stories.tsx` beside the component, plus a few gallery
stories for foundations, combined states, and feature-level showcases. Keep the
Storybook code out of the shipping application dependency graph.

`src/components/ui/index.ts` is the ergonomic single import surface, e.g.:

~~~tsx
import { Button, Switch, FrostDialog } from "@/components/ui";
~~~

The implementation remains in small files with clear owners. During a
transition, keep the existing import paths working through compatibility
re-exports from `components/primitives.tsx` and `components/frost.tsx` rather
than updating all consumers in one high-risk diff. Avoid creating circular
imports, especially among overlay/focus/portal helpers.

Distinguish:

- **Primitives:** brand-styled, low-domain API (`Button`, `Input`, `Switch`).
- **Patterns:** stable compositions reused on multiple surfaces
  (`ListRow`, `SettingsRow`, selected dashboard group/header patterns).
- **Feature components:** substantial application-specific UI, often still
  worthy of stories (`QuestionCard`, `ToolStep`, `ThinkingOrb`).
- **Screens/systems:** stateful compositions and renderers; never move merely
  because they use JSX (`Transcript`, `Composer`, terminal, Markdown engine).

Use composition and context for optional slots instead of hundreds of
one-off variants. A simple HTML element does not require a wrapper until there
is reusable behaviour, semantics, accessibility, or a branded presentation
contract. Do not create a deep abstraction for a component used once.

## Source inventory: every TSX file in the snapshot

Paths here are relative to `conduit-web/src/`. The indicator is a *proposed*
classification to investigate, not an assertion that each file contains no
reusable code. Inspect all files before changing ownership.

### Shared component infrastructure (3)

~~~text
components/primitives.tsx           SHARED: split exports carefully
components/frost.tsx                SHARED: retain canonical overlay/dialog
components/phone-menu-panels.tsx    INFRA: keep phone menu internals
~~~

The non-TSX `components/phone-overlays.ts` also belongs to this infrastructure.

### Chat / transcript (24)

~~~text
client/chat/attachment-strip.tsx          FEATURE: stories; inspect chips/ring
client/chat/attachments.tsx               FEATURE
client/chat/composer-plus-menu.tsx        FEATURE
client/chat/composer.tsx                  SCREEN/FEATURE
client/chat/context-gauge.tsx             FEATURE: stories
client/chat/disclosure.tsx                EXTRACT primitive + preserve CSS
client/chat/external-link-dialog.tsx      FEATURE: canonical dialog wrapper
client/chat/host-ui-card.tsx              FEATURE
client/chat/incremark-markdown.tsx        RENDERER: remain specialised
client/chat/markdown.tsx                  RENDERER
client/chat/marked-markdown.tsx           RENDERER
client/chat/mobile-composer-options.tsx   FEATURE
client/chat/model-selector.tsx            FEATURE: stories
client/chat/outside-thread-chip.tsx       FEATURE: inspect chip pattern
client/chat/place-picker.tsx              FEATURE: stories
client/chat/question-card.tsx             FEATURE: stories/approval variants
client/chat/queued-messages.tsx           FEATURE: inspect repeated controls
client/chat/review-comment-cards.tsx      FEATURE
client/chat/step-slider.tsx               EXTRACT portable ordered-choice UI
client/chat/thinking-orb.tsx              FEATURE: story all status frames
client/chat/tool-card.tsx                 FEATURE: stories
client/chat/transcript.tsx                SCREEN/RENDERER
client/chat/turn-trace.tsx                FEATURE: stories
client/chat/voice-waveform.tsx            FEATURE: stories
~~~

### Dashboard, navigation, entry/brand (15)

~~~text
client/dashboard/app-dashboard.tsx                SCREEN
client/dashboard/computer-dashboard.tsx           SCREEN
client/dashboard/harness-dashboard.tsx            SCREEN
client/dashboard/primitives/chat-list.tsx          PATTERN: inspect sub-exports
client/dashboard/primitives/split.tsx              PATTERN: extract selectively
client/navigation/chat-preview.tsx                 FEATURE
client/navigation/command-hint-bar.tsx             FEATURE
client/navigation/command-menu.tsx                 FEATURE: stories
client/navigation/leader-palette.tsx               FEATURE: stories
client/navigation/pair-dialog.tsx                  FEATURE
client/navigation/runtime-indicator.tsx            PATTERN/DOMAIN: inspect
client/navigation/server-switcher.tsx              FEATURE
client/navigation/sidebar.tsx                      SCREEN/FEATURE
client/harness-brand.tsx                           DOMAIN: stories
client/main.tsx                                    APPLICATION ENTRY; audit markup
~~~

`dashboard/primitives/split.tsx` exports `SplitDashboard`, `SplitHeader`,
`watchFold`, `SplitQuickActions`, `SplitGroup`, `SplitGroupMore`, `SplitEmpty`,
`SplitRow` and `SplitCounts`. Some are broadly useful; others are deeply
coupled to measurements, responsive layout, focus and application pages.
Extract only the former after consumer review.

### Settings, project, platform (13)

~~~text
client/settings/about-settings.tsx                 FEATURE
client/settings/desktop-settings.tsx               FEATURE
client/settings/save-status.tsx                    PATTERN: possible shared status
client/settings/servers-settings.tsx               FEATURE
client/settings/settings-controls.tsx              EXTRACT Segmented/Switch
client/settings/settings-core.tsx                  SCREEN/FEATURE
client/settings/settings.tsx                       FEATURE
client/settings/shortcuts-settings.tsx             FEATURE
client/settings/voice-local-catalogue.tsx          FEATURE
client/project/dashboard.tsx                       SCREEN
client/project/workspace-appearance-editor.tsx     FEATURE
client/project/workspace-appearance.tsx            DOMAIN: glyphs/presentation
client/platform/pairing.tsx                        FEATURE
~~~

### Workspace, editor, terminal (20)

~~~text
client/workspace/file-type-icon.tsx                 DOMAIN
client/workspace/workspace-annotate.tsx             FEATURE/EDITOR
client/workspace/workspace-chat-view.tsx            FEATURE
client/workspace/workspace-comparison-source.tsx    FEATURE
client/workspace/workspace-comparison.tsx           FEATURE
client/workspace/workspace-diff-view.tsx            FEATURE
client/workspace/workspace-editor.tsx               FEATURE/EDITOR
client/workspace/workspace-excerpt-view.tsx         FEATURE
client/workspace/workspace-file-slot.tsx            FEATURE
client/workspace/workspace-file-viewer.tsx          FEATURE
client/workspace/workspace-files.tsx                FEATURE
client/workspace/workspace-panel.tsx                SCREEN
client/workspace/workspace-rail.tsx                 FEATURE: review row/actions
client/workspace/workspace-review.tsx               FEATURE
client/workspace/workspace-search-panel.tsx         FEATURE
client/workspace/workspace-source-control.tsx       FEATURE
client/workspace/workspace-terminal-view.tsx        FEATURE
client/workspace/workspace-workbench.tsx            WRAPPER: WorkbenchButton/Status
client/remotes/terminal-pane.tsx                    FEATURE/TERMINAL
client/remotes/terminal-route.tsx                   SCREEN/TERMINAL
~~~

### CSS inventory (31)

All paths below relative to `conduit-web/src/`:

~~~text
client/styles.css

client/chat/attachment-strip.css
client/chat/code-block.css
client/chat/composer-cards.css
client/chat/composer-desktop.css
client/chat/composer-geometry.css
client/chat/disclosure.css
client/chat/incremark-markdown.css
client/chat/markdown.css
client/chat/mobile-header-backports.css
client/chat/outside-thread-chip.css
client/chat/performance-composer.css
client/chat/place-picker.css
client/chat/question-card.css
client/chat/step-slider.css
client/chat/transcript-appearance.css
client/chat/turn-trail.css

client/dashboard/app-dashboard.css
client/dashboard/computer-dashboard.css
client/dashboard/harness-dashboard.css
client/dashboard/primitives/split.css

client/navigation/leader-palette.css
client/navigation/sidebar.css
client/project/dashboard.css
client/remotes/terminal-pane.css
client/remotes/terminal-route.css
client/settings/settings-controls.css
client/settings/shortcuts-settings.css
client/settings/voice-settings.css
client/workspace/workspace-comparison.css
client/workspace/workspace.css
~~~

CSS audit should find duplicate sizes/colours, feature-specific overrides of
supposedly shared elements, duplicated phone/desktop density, and selectors
tied to particular ancestors. `client/styles.css` is currently large and
also contains genuinely global layout and chrome rules. **Do not** perform a
cosmetic wholesale split: migrate reusable token declarations and associated
component rules incrementally with every extracted component, preserving
cascade/import order and the current mobile behaviour.

### Non-TSX UI and imperative DOM candidates

The TSX inventory is not sufficient to find all one-off controls. Review at
least these paths for imperative markup creation, renderer-owned DOM,
duplicated buttons, and exception cases:

~~~text
src/auth-login-page.js
src/client/chat/code-block.ts
src/client/chat/code-highlight.ts
src/client/chat/morph-html.ts
src/client/chat/katex-patch.ts
src/client/chat/markdown-security.ts
src/client/chat/incremark-markdown.tsx
src/client/chat/marked-markdown.tsx
src/client/workspace/workspace-editor-base.ts
src/client/workspace/workspace-search-panel.tsx
src/client/workspace/workspace-files.tsx
src/client/workspace/workspace-file-slot.tsx
src/client/workspace/workspace-annotate.tsx
src/client/navigation/keyboard-probe.ts
src/client/navigation/overlay-scrollbars.ts
src/client/shortcuts/region-cue.ts
src/client/motion-rules.ts
~~~

These are **audit candidates**, not a mandate to move them. Syntax
highlighting, Markdown/KaTeX projection, CodeMirror integration, probes and
performance-critical DOM patches have sound reasons not to become JSX UI
primitives. The standalone server-rendered login page can reasonably remain
a separate rendering context until shared branding becomes worth its cost.

At implementation time supplement this static list with repository searches
for raw `<button>`, `<input>`, `<select>`, `<textarea>`, `document.createElement`,
`innerHTML`, overlays, menus, status dots, and repeated class names. Classify
each match by semantics, not simple text equality.

## Consolidation rules and canonical API

For each candidate component, record:

1. **Who owns it?** UI primitive, shared pattern, domain feature, full screen,
   or renderer infrastructure.
2. **What must be consistent?** Material, typography, spacing, state semantics,
   keyboard behaviour, accessibility, focus return and mobile rendering.
3. **What varies by consumer?** Value/label, variant, size, disabled/busy, icons,
   slots, open state, callbacks; document those props rather than copying CSS.
4. **What is used by more than one surface?** Prefer evidence from consumers or
   known near-term reuse; no abstractions merely to achieve file-count goals.
5. **What is sensitive to performance?** Virtualized lists, transcript,
   instrumented panes, mobile overlays; keep hot code local unless extraction
   preserves cost and behaviour.

Canonical controls should have documented, typed, intentionally constrained
props. Prefer existing controlled Solid patterns (`checked`/`onChange`,
`value`/`onChange`, `open`/`onOpenChange`) and named size/variant unions; avoid
unrestricted style props as the model-facing contract. Native element props
and proper ARIA semantics remain available where appropriate.

Source modules are ordinary Solid components; no React compatibility layer.
Use Kobalte for established accessible behaviour. Preserve portal mount
handling for fullscreen and phone overlays, focus restoration, close-on-select
semantics, keyboard selection wash, and mobile/touch event guards.

Retain backward-compatible exports until consumers are incrementally migrated.
One public barrel may simplify imports; it is **not** the storage location for
every implementation. Avoid importing everything through one barrel in
performance-critical startup paths if this causes eager loading/cycles.

## Storybook: viewer first, editor second

Storybook should be **development-only**, run separately from Conduit's
authenticated server, and render **the real imported Solid components**
against the **real Conduit styles and design tokens**. It is not a separate app
theme or a second copy of the components.

### Setup

- Investigate the current Storybook SolidJS/Vite adapter and its exact
  peer-dependency compatibility with Conduit's Vite 6 toolchain. Pin versions
  deliberately; **do not** blindly upgrade Vite or force-install mismatched
  peers. If needed, isolate the Storybook build/toolchain or use a compatible
  adapter version. Verify the actual working story build before declaring
  this milestone complete.
- Add `.storybook/main.ts` and `preview.tsx` with the necessary Solid plugin,
  TS path alias and CSS processing. Import the production stylesheet and Geist.
- Apply `.dark` on the correct root for every story and ensure overlay
  portals inherit it. Validate popovers, dialogs, overlay/backdrop and focus
  return rather than only closed components.
- Make Storybook's controls and docs work with Solid props, avoiding React-only
  decorators/addons. Configure story files to remain out of production bundles.
- Add scripts in `conduit-web/package.json`, e.g. `storybook` and
  `build:storybook`; the exact adapter and CLI names are chosen from its
  verified installation.
- Keep the existing `solid-components` workbench scripts untouched. If it
  later gets its own Storybook, keep the two scopes explicit.

### Catalogue taxonomy and initial stories

Suggested sidebar categories: **Foundations**, **Primitives**, **Patterns**,
**Chat**, **Navigation**, **Workspace**, **Overlays**, **Experimental**.

Start with working stories for:

- Foundations: colours (roles, not arbitrary swatches), type roles, spacing,
  radii, frame/pane/frost materials, interaction state grammar, icons/keycaps.
- Primitives: Button (sizes/variants/busy/disabled), Badge, Spinner, Field,
  Input, Textarea, Switch, Segmented, Menu + ContextMenu + submenu/radio items,
  Popover + searchable list, Tooltip, FrostOverlay, FrostDialog, Disclosure,
  StepSlider.
- Patterns: ListRow / SettingsRow / split-page groups as extracted;
  runtime/status indicator; save status; harness mark.
- Feature showcase: QuestionCard approvals/choices, ToolStep, ContextGauge,
  ThinkingOrb states, AttachmentStrip, VoiceWaveform, model selector and
  representative chat controls. Mock data and callbacks only; no live harness
  or required server session.

Each public component should have a default story and relevant states:
hover, focus/keyboard, selected/current, open, loading, disabled/error,
long text, empty content, and mobile-width where meaningful. Include
actual interactions for complex primitives; merely displaying a static
screenshot is insufficient. Use explicitly controlled fixtures to make
behaviour reproducible and do not connect stories to user credentials,
filesystem mutations, or production backend state.

### The visual editor and its limits

**Stage A: Props playground.** Storybook Controls adjusts labels, variants,
open/closed/disabled state, numeric sizing where props allow it, and selects.
These changes are **ephemeral** and do not edit source code.

**Stage B: Token playground.** Add a small, dev-only workbench panel or
Storybook addon to edit Conduit token variables (e.g. typography roles,
radius, spacing, frost fill/stroke/blur/shadow, colour roles) with live preview.
Apply overrides to the story's scoped preview root, clean them up on story
change, and support Reset, Compare before/after, Copy CSS and/or Export patch.
Persisting a design change to source is a separate explicit developer action,
reviewable in Git; avoid quietly mutating TSX or `styles.css` from browser UI.

**Stage C: Composite inspection.** Add a side-by-side variant grid and
viewport presets for desktop and phone. Test frost over several real
backgrounds, particularly blur/opacity. Where a style is still hardcoded in a
feature stylesheet, label it **not token-controlled** rather than presenting
a slider which has no effect.

Storybook is a visual **viewer + props playground** out of the box, not
automatically a general source editor. Do not promise WYSIWYG edits to
arbitrary TSX, automatic pull requests, or that a CSS token override reaches
every one-off rule. Start with CSS patch export and the regular editing flow.

### Testing and accessibility for the catalogue

Check actual Kobalte keyboard navigation and aria state, focus return, menu
dismissal, overlay sizing, mobile/touch behaviour, disabled variants and
`prefers-reduced-motion`. Respect Conduit's intentional selection-wash
convention without regressing keyboard discoverability. Exercise long labels,
localized content widths and UI scale. As individual screens adopt extracted
components, verify representative full-app behaviour using the narrowest
applicable seam in `docs/TESTING.md`.

Do not load all chat, terminal, markdown or dashboard code eagerly to populate
the Storybook sidebar. Keep stories lazily imported and bundling separate.

## Phased implementation and acceptance criteria

The slices below are *proposed* bounded Features, not permission to implement
all of them in a single change. They align with the issue conventions in
`CONTRIBUTING.md`; when scheduling, search for existing work and attach
Features to an appropriate Roadmap rather than creating duplicates.

### 0. Establish inventory and baseline (small, independent)

- Record the inventory above and the current imports/consumers of shared
  primitives. Search raw JSX/DOM/CSS overrides; tag real duplicates and
  intentional exceptions.
- Identify the current effective design tokens versus hardcoded values and
  CSS/cascade dependencies.
- Capture representative baseline previews (desktop/phone, menu/dialog,
  composer, settings, dashboard) for visual parity.
- Confirm the Storybook Solid/Vite compatibility path before changing
  production dependencies.

**Done:** a checked migration map with known consumers and no unexamined
claim that all TSX files are reusable components.

### 1. Install Storybook against existing files (first visible deliverable)

- Add Storybook only, with Solid support, shared CSS/tokens, dark theme,
  aliases and the smallest needed addons.
- Write initial primitive/frost/settings stories *without* relocating those
  components. Ensure real interactions and portals work.
- Make `npm run storybook` open a gallery and `build:storybook` produce a static
  development catalogue.

**Done:** components render identically in the app and in a functioning
workbench, including an open dialog and menu; production application runtime
is unchanged.

### 2. Canonical shared primitives (component consolidation)

- Divide `components/primitives.tsx` into focused `components/ui/` modules.
- Consolidate `frost.tsx`, `settings/settings-controls.tsx`,
  `chat/disclosure.tsx` and `chat/step-slider.tsx` where portability is clear.
- Keep CSS colocated or in shared tokens as appropriate; preserve exact
  variants, focus, keyboard and mobile rules.
- Add `ui/index.ts` plus compatibility re-exports; migrate a few callers,
  then the remainder incrementally without forcing a single large diff.
- Update stories to import the canonical components.

**Done:** the public UI primitives have one owned implementation, are
browsable, typechecked, and app parity is preserved.

### 3. Shared patterns, not a universal widget soup

- Review `dashboard/primitives/split.tsx` and `chat-list.tsx`,
  `navigation/runtime-indicator.tsx`, `settings/save-status.tsx` and
  `workspace/workspace-workbench.tsx`.
- Extract evidence-backed ListRow/SettingsRow/status/group/heading patterns.
- Keep feature-specific state, process lifecycle, measuring, routing, and
  transcript logic in feature directories.
- Add interactive composed examples of the resulting patterns.

**Done:** repeated visual behaviour uses common patterns, without a
generalized global component forcing unlike features into one API.

### 4. Theme workbench and token consolidation

- Implement live token overrides, reset, comparison and CSS patch export.
- Selectively relocate canonical tokens from `client/styles.css`, preserving
  the effective CSS variables and computed values.
- Convert only genuinely shared hardcoded visual properties to tokens,
  per surface; avoid a premature wholesale restyling or incomplete scaling
  migration.
- Record style roles and concrete component APIs in short component docs;
  leave visual intent in `DESIGN.md`.

**Done:** adjusting a common radius, typography or frost property in the
gallery visibly affects intended shared components, and applying the exported
patch to source is straightforward and reviewable.

### 5. Gradual deduplication of one-offs

- Audit the remaining 75-TSX inventory and the imperative DOM/CSS paths
  against the now-established primitives.
- Replace duplicated dialogs, status markers, settings controls, list rows,
  chips and buttons only where behaviour/presentation really coincide.
- Do not extract Markdown/KaTeX projection, virtualized rendering, terminal
  internals, editor decorations, or full screens to chase uniformity.
- Add stories for important feature components even if they never move.

**Done:** no avoidable duplicate implementations of canonical UI patterns;
the remaining feature-specific code has clear ownership.

### 6. Advanced components (deferred)

Add capabilities only when the product actually needs them:
TanStack Solid Table/Virtual/Form/Query for dense data and stateful tables,
Ark UI/Zag for advanced tree/combobox/splitter-like behaviour lacking in
existing primitives, and Corvu/Solid UI as implementation references where
appropriate. Maintain Kobalte for currently working menus, dialogs, popovers
and the like. Do not install overlapping comprehensive systems or copy
another library's visual palette.

**Done:** each advanced adoption answers a specific unmet interaction/data
requirement and is wrapped in Conduit's own component API and Storybook stories.

### 7. Model-facing UI registry / generative UI (deferred experiment)

Build only after the UI API has stabilized and there is a real product need.
See the contract and security considerations below. This phase is not a
dependency of Storybook or UI consolidation.

## Model-facing component registry (future)

A TypeScript barrel exporting everything in `components/ui` is **not** a safe
model interface. A model-facing registry should intentionally expose a limited
set of renderable components with versioned identifiers, typed/validated props,
permitted child nesting, defaults, interaction contracts and documentation.

Candidate conceptual contract (illustrative, not an approved schema):

~~~ts
type UiNode = {
  key: string;                    // stable identity for updates
  type: string;                   // registry ID, not import path
  props?: Record<string, unknown>;// validated against this type's schema
  children?: UiNode[] | string;   // constrained per component
};

type UiAction = {
  id: string;                     // known host action, not arbitrary JS
  payload?: Record<string, unknown>;
};
~~~

The registry maps a model-visible identifier like `table`, `slider`,
`card`, or `chart` to a trusted Conduit implementation; it does **not**
allow arbitrary module imports, arbitrary Solid component execution, or
unrestricted event-handler strings. A chart is a renderer receiving data
and config, not a free-form JS function supplied by the model.

Potential descriptors include:

- Stable ID and semantic description.
- Schema for props/children/slots and allowed variants.
- Allowed event names and mapping to explicit host actions.
- Whether the component can safely stream or contains user input.
- Default, disabled, invalid and loading behaviour.
- Limits for depth, count, data size, rendered dimensions and update rate.
- Version or compatibility marker so old persisted outputs still reopen.
- Storybook examples as design-time fixtures; optionally a *generated*
  machine-readable manifest. Never assume a Storybook manifest is an
  executable secure renderer by itself.

Generation-time schema and runtime validation are both necessary; the host
must reject unexpected actions/props and apply normal authorization before
file, chat, shell or external operations. User-entered values should belong
to controlled client-side state, not be overwritten by the next streamed
model token.

A useful initial experiment is a bounded structured tool or render block
(e.g. `render_chart`, `render_table`, `render_comparison`) without inventing a
general markup language. This tests whether native interactive answer
components are worth their maintenance cost before committing to a DSL.

## DIL-like native UI versus iframe HTML artifacts

These solve related but different problems, and **both may exist**.

**Native declarative answer UI** is best when Conduit should guarantee
readability, theme fidelity, accessibility, safe interactions, and cheap
reusable rendering: comparison tables, charts, filters, selectors, calculators
and in-message data exploration. The model chooses a validated component tree;
Conduit owns actual rendering, local state, layout, motion, and host actions.

**Arbitrary artifacts** are best for unconstrained visualizations,
simulations, bespoke mini-apps and exploratory HTML/CSS/JS that would be
awkward to express through a fixed registry. Render these in an isolated
iframe, not as trusted Conduit DOM.

A DIL-like language would be one encoding of a component tree, **not** an
architectural prerequisite. Options to evaluate when ready:

- Compact streamable markup / custom declarative syntax (DIL/OpenUI-like):
  expressive layout, potentially efficient tokens, but a new parser and
  model-facing language to design and maintain.
- Structured JSON tree with progressive updates or JSON Patch
  (json-render-like): familiar schema validation and patch semantics, but
  partial JSON and update identity still require careful orchestration.
- Protocols such as A2UI when multiple agents/client runtimes make
  interoperability valuable; verify available Solid integration instead of
  assuming a React renderer ports trivially.
- A small fixed set of structured tool results, likely the cheapest first
  native UI experiment.

All formats should target the **same host registry and renderer**. Protocol
choice should not change the design system or become intertwined with
component implementations. No decision to support OpenAI's exact DIL syntax
is made here; it is not an open compatibility target.

### Incremental rendering and state

Streaming is *not* the same thing as eagerly inserting partially generated
HTML. A native pipeline would need a progressive parser or update protocol,
AST/node identity, schema validation, bounded reconciliation, and state
preservation while the model continues writing.

Target behavioural rules:

- Show only a valid stable subtree or finalized property value, never broken
  markup/unsafe partial handlers. Preserve adjacent ordinary Markdown text.
- Key interactive nodes so a later streaming patch does not reset sliders,
  focus, input values, scroll position, or running animations.
- Separate ephemeral widget state from model-owned presentation props.
  Define what happens on edit/regenerate, cancel, reconnect, replay and
  incomplete/interrupted output.
- Bound node count, depth, payload size, updates/sec, CPU/layout work and
  expensive charts. Maintain transcript first-open and streaming budgets.
- Persist a versioned representation with a fallback if the old renderer or
  registry component is unavailable; the transcript remains readable.
- Give host actions explicit permission semantics and user confirmation when
  required. Widget-rendering must not silently become a tool-execution path.

### Iframe artifact option and security

A persistent iframe can render streaming HTML without resetting the iframe
on every token: host receives chunks, parses/patches into a persistent
sandbox document, and activates JS only when complete/valid. This path does
not require a new UI language or brand-specific components. Use it for
arbitrary artifacts, not as a trusted alternative to a native registry.

Security requirements before enabling generated JS:

- Sandboxed iframe with `allow-scripts` where required and **without**
  `allow-same-origin` in the untrusted-content case, preferably on an
  isolated origin. No access to Conduit's cookies, local storage, DOM or
  authenticated API session.
- Restrictive CSP and network/resource policy. An iframe sandbox alone does
  not prevent generated scripts from attempting external network requests or
  exfiltration; control `connect-src`, scripts, framing, external imports,
  navigation and form submissions according to the artifact's capability.
- Minimal `postMessage` bridge with origin/source validation and fixed message
  schemas. No arbitrary `eval`/host-function proxy or general filesystem,
  shell or authenticated fetch proxy.
- Per-artifact resource, navigation, storage, lifetime and update budgets.
  Establish event lifecycles and teardown on transcript disposal.
- Persistent source saved as an inspectable artifact, with a clear distinction
  between artifact content and trusted Conduit UI.

The host may supply optional Conduit CSS tokens or a small themed CSS kit to
make artifacts visually consistent; it must not grant DOM/JS privileges simply
to enforce styling.

### What this means for Storybook

Storybook develops and documents the **native Conduit UI layer**. Its stories
and component docs can later inform a deliberately curated model registry.
Storybook does not itself interpret DIL, sandbox HTML, validate permissions,
or make model-generated components safe. If model-facing support is added,
keep story metadata, component renderers, schema validators and action
permissions separately owned and testable.

## Risks, decisions and guardrails

| Risk or open decision | Direction |
| --- | --- |
| Storybook SolidJS + Vite 6 compatibility | Verify adapter version/peer deps first; isolate tooling if necessary; no forced production upgrade. |
| Large refactor invalidates state/keyboard/phone | Storybook-first; extract one surface at a time; preserve compatibility exports and test focused interactions. |
| Token editor only affects some styles | Clearly distinguish token-controlled versus hardcoded; migrate one component/surface at a time. |
| Single giant barrel increases eager bundle size | Keep small source modules, selective imports/lazy features, watch import cycles and startup cost. |
| Existing dedicated `solid-components` package | Keep separate for now; do not add npm release steps to routine Conduit UI tuning. |
| Double accessibility frameworks | Keep Kobalte for established components; introduce Ark/Corvu only to cover a concrete gap. |
| Overgeneralization of domain components | Use primitive/pattern/feature/screen categories; no global abstraction without real reuse. |
| Generated interfaces execute hostile actions | Registry validation, limited actions, authorization; separate sandboxed artifact runtime. |
| Streaming causes focus resets/layout shift | Stable identity, partial subtree commits, preservation of local state and layout budgets. |
| Divergence between `DESIGN.md` and component stories | `DESIGN.md` wins on visual intent; stories demonstrate *current code* and flag migration debt. |

## Acceptance and verification

**First milestone (Storybook + foundation inventory)** is complete when:

- Storybook runs in development and builds independently with a verified,
  compatible Solid/Vite setup.
- The initial gallery shows real Conduit shared components in base states and
  supports live props controls; dialog/menu portals and keyboard interaction
  work with Conduit's styles.
- Dark theme, Geist, frame/pane/frost and phone viewport can be previewed.
- No app runtime behaviour or production bundle dependency changed as a
  side-effect of bringing up the gallery.

**Consolidation milestone** is complete when:

- Canonical UI primitives are in focused modules with stable public exports,
  Storybook examples and compatibility paths during migration.
- Application consumers use shared implementations where behaviour truly
  matches, while feature systems remain in their owning modules.
- No deliberate visual, accessibility, focus, interaction, mobile or
  performance regression is introduced.
- Reusable styling and token ownership are clear; source edits remain
  reviewable and deliberate.

**Visual editor milestone** is complete when:

- The component viewer supports controls for variants/states and live
  adjustments of *actual* shared tokens.
- It shows original versus adjusted appearance and can export a meaningful
  CSS change for review, without silently modifying source.
- Unsupported tuning dimensions are identified honestly.

**Generative UI** has **no current completion gate**: it remains a later
prototype decision, contingent on a stable useful registry and a demonstrated
use case. Native declarative components and sandboxed artifacts should be
evaluated independently against security, performance and usability.

Follow `docs/TESTING.md` for each implementation change: smallest sufficient
targeted typecheck, unit seam or real-browser check; release-wide sweeps when
appropriate. This documentation-only plan needs no application build, and
does not authorize restarting any user-managed service.

## Reference entry points

- [Design language](../../DESIGN.md)
- [Contributing / issue scope](../../CONTRIBUTING.md)
- [Testing and browser/runtime boundaries](../TESTING.md)
- [Existing primitives](../../conduit-web/src/components/primitives.tsx)
- [Existing frost implementations](../../conduit-web/src/components/frost.tsx)
- [Existing settings controls](../../conduit-web/src/client/settings/settings-controls.tsx)
- [Existing dashboard patterns](../../conduit-web/src/client/dashboard/primitives/split.tsx)
- [Current theme and component styles](../../conduit-web/src/client/styles.css)
- [Current Vite toolchain](../../conduit-web/vite.config.js)
- [Separate solid-components development workflow](../../scripts/solid-components-workbench.mjs)

This is a proposed architecture and migration sequence. The **committed
near-term direction** is *viewer first, canonical components second, visual
editing third*. The model registry and DIL-like/UI-artifact choices are
explicitly deferred until those foundations can be exercised in the app.
