# Frontend and Interaction Engineering

Use this workflow for product UI, interaction, accessibility, responsive layout, motion,
and visual verification. Build the actual working screen in the existing application;
do not substitute explanatory copy or a static mock for the requested experience.

Load [visual-acceptance.md](code-frontend/references/visual-acceptance.md) when the result
depends on real Electron rendering, responsive screenshots, accessibility, or image-based
review.

## Ground in the product

Read the existing design system, component patterns, state ownership, routing, and the
complete target workflow. Identify the audience, information density, primary repeated
action, empty state, error state, and narrow-window behavior.

Preserve established visual language unless the user asked for a redesign. Do not copy
generic dashboard patterns or introduce a second component system. Use the existing icon,
typography, spacing, color, radius, and motion tokens. An intentional visual change needs
a reason tied to hierarchy, clarity, or task speed.

## Model behavior before markup

Separate durable domain state from transient view state. Define:

- initial, loading, success, empty, partial, error, and disabled states;
- which actions are optimistic and how they roll back;
- request identity and stale-response handling;
- draft, selection, scroll, and focus preservation across refreshes;
- keyboard, pointer, touch, and reduced-motion behavior;
- resize and localization behavior for the longest expected content.

Do not let a formatting preview, temporary selection, or derived presentation value become
the source of truth. Async completion must verify that it still belongs to the current
request, component, and mode.

## Build accessible operational controls

Use semantic elements and native behavior. Buttons perform commands, links navigate,
segmented controls change views or modes, checkboxes/toggles represent binary settings,
and menus select from options. Give icon-only controls accessible names and tooltips when
their meaning is not universally obvious. Select colors through swatches where relevant
and use numeric inputs/steppers for quantities.

Maintain a visible focus indicator and a logical keyboard order. Traps are appropriate
only inside modal surfaces and must restore focus on dismissal. Do not communicate state
only through color, motion, hover, or an icon. Respect `prefers-reduced-motion`.

## Make layout resilient

Use stable responsive constraints for toolbars, tile grids, counters, and fixed-format
work areas. Content must wrap instead of clipping, overlapping adjacent elements, creating
horizontal scrolling, or covering controls. Do not scale body text with viewport width or
use negative letter spacing.

Cards are for repeated items, modals, and genuinely framed tools, not for wrapping every
page section. Keep information-dense software quiet and scannable: clear hierarchy,
consistent baselines, restrained borders, and state-driven emphasis. Avoid decorative
effects that compete with status, data, or the composer.

For motion, specify what state changed and keep the animation short enough not to delay
input. A streaming response may reveal progressively; a saved status may settle; a drawer
may show its spatial relationship. Avoid perpetual micro-motion and generic animation on
every hover.

## Preserve state and performance

Give async and cached data identity. Discard late responses for superseded mode, request,
selection, or session. Keep component keys stable unless identity truly changed. Preserve
drafts and selected attachments across ordinary navigation and reconnects.

Bound large lists, logs, images, and previews. Avoid work on every input event when the
result can be deferred, and inspect main-thread long tasks in performance-sensitive
surfaces. Optimize only a measured path.

## Verify with real rendering

Run the real application/browser path with a disposable local profile when possible.
Distinguish the embedded browser guest from the Electron application shell:

- use `browser_screenshot` only for the guest webview it controls;
- use the repository's Electron/CDP smoke path to capture the actual BrowserWindow and
  application chrome;
- ensure the resulting pixels are consumed by an image-capable model or `view_image`.
  A PNG path alone does not prove that anyone inspected the render.

Capture and inspect:

- target workflow at a common desktop viewport and a narrow viewport;
- supported light/dark themes where relevant;
- loading, complete, empty, disabled, and failure states;
- long labels, localized copy, large values, and user-provided content;
- keyboard traversal, focus restoration, and reduced motion;
- clipping, overlap, horizontal overflow, text fit, and console/runtime errors.

Compare screenshots across the initial and final state only when the environment is
stable. A screenshot that did not reach the intended state is not visual proof. For canvas,
video, or other non-DOM media, verify actual pixels are nonblank and that interaction and
framing work at both wide and narrow sizes.

The capture surfaces, required states, and overflow/focus checks are detailed in
[visual-acceptance.md](code-frontend/references/visual-acceptance.md).

Finish by re-testing the primary repeated workflow, not just the most photogenic state.
Report browser/Electron coverage and any device, theme, accessibility, or backend behavior
that remained unverified.
