# Visual Acceptance

Use this reference when layout, interaction, theme, motion, or real rendered behavior is
part of the requested change.

## Identify the correct rendering surface

`browser_screenshot` captures the embedded guest webview controlled by the browser tool. It
does not capture the Electron custom title bar, sidebars, settings overlays, or other
application chrome.

For the full Electron renderer, use an isolated profile and the repository's Electron/CDP
smoke path to capture the actual BrowserWindow. For plain web pages, use the supported
browser surface. Do not describe a guest-page screenshot as a screenshot of the desktop
application.

The captured pixels must be consumed by image-capable model input or `view_image`. A PNG
path, successful capture command, or DOM description is not proof that the image was
inspected.

## Prepare the state

Use representative content and a deterministic local provider or fixture where possible.
Set the intended locale, theme, viewport, zoom, and feature state before capture. Wait for
finite animations and the target asynchronous state, but do not freeze the UI in a fake
completed state unless that state itself is under test.

Check that the renderer has no uncaught exception, console error, blank canvas, or failed
asset request. For canvas or video, verify nonblank pixels and interact with the scene at
both wide and narrow sizes.

## Inspect the actual composition

At each required viewport, inspect:

- hierarchy and information density;
- text wrapping, clipping, truncation, and overlap;
- horizontal overflow and unexpected scroll containers;
- control hit areas and disabled/loading/error feedback;
- focus indicator, keyboard order, and focus restoration after modal dismissal;
- long translated labels and large numeric values;
- day/night or other supported theme contrast;
- motion direction and whether reduced-motion disables nonessential movement.

DOM bounds can detect overflow and overlap systematically, but do not replace looking at
the captured frame. Use both when the workflow supports it.

## Cover workflow states

At minimum inspect the primary workflow plus the states changed or most likely to fail:
initial, loading, complete, empty, validation error, runtime error, permission/confirmation,
cancelled, and restored-from-persistence as applicable.

Repeat the primary action after visual inspection. A polished initial frame with a broken
second action is not an accepted interaction.

## Record honest evidence

Keep the viewport, theme, locale, state, and evidence path together. If the renderer
crashed, the screenshot is blank, the model cannot consume images, or the viewport is not
the intended one, mark visual acceptance as incomplete. Do not infer page quality from a
successful build or from accessibility text alone.
