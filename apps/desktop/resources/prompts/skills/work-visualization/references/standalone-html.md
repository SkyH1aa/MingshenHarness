# Standalone HTML contract

## File

Write a complete HTML document with:

- `<!doctype html>`, `<html lang="...">`, `<head>`, and `<body>`.
- Inline CSS and JavaScript.
- Inline SVG or Canvas rendering.
- Data embedded in a clearly delimited script or markup block.
- No local module imports, fetch of local files, service credentials, or required CDN.

Use a concise lowercase hyphenated ASCII file name in the requested workspace. Do not
write into a system temporary directory. Do not overwrite an existing file unless the
user asked to modify it.

## Data

Place the data in one obvious constant or table. Add comments only for source, units,
period, transformation, and uncertain values. Keep identifiers stable. Do not embed
personal, secret, or unapproved production data.

For moderately large datasets, aggregate or downsample outside the page, state the
method, and preserve extrema. For tabular content, semantic `<table>` remains preferable
to a chart.

## Rendering

Prefer semantic HTML/CSS and direct SVG for simple charts. If complex scales or paths
are necessary, implement a small local helper rather than requiring a package. Use
`ResizeObserver` for chart width. Compute domains from observations and axis padding,
not hard-coded guesses.

Use CSS variables for surface, text, muted text, grid, focus, and a bounded series
palette. Ensure the page reads on its own without the Mingshen shell. A neutral light
surface is acceptable; light/dark support is optional unless requested.

## Tooltips and details

A shared tooltip must be pointer-transparent. Give marks a larger invisible hit target
when necessary. Keyboard focus should expose the same essential value as hover. Touch
users must be able to access details without a physical hover state.

Do not use colored cards in place of a chart. Do not hide categories behind legend
toggles when comparison requires them simultaneously.

## Browser inspection

From the workspace, start an approved local static server or use a supported local file
workflow with `browser_open`. Then:

1. Inspect the initial state.
2. Exercise every primary interaction with real pointer or keyboard input.
3. Capture desktop and narrow screenshots.
4. Inspect any screenshot through the image-capable model path.
5. Check console errors and failed assets.
6. Compare visible values to the embedded data and source.

If local browser access is unavailable, report the file as generated but not visually
verified.
