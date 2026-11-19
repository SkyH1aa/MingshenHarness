# Native visualization template catalog

These starter files are original Mingshen resources under this skill's `templates/`
folder. Load a selected file with `use_skill`, copy its patterns into a new workspace
HTML file, and replace every sample value. Do not treat placeholder data as real.

| Template | Use | Resource |
| --- | --- | --- |
| Interactive chart explainer | One annotated quantitative question with a small control set | `references/templates/chart-explainer.html` |
| Data story with facets | A narrative sequence connecting chart, annotation, and evidence | `references/templates/data-story.html` |
| Scenario explorer | Adjustable assumptions and a visible deterministic result | `references/templates/scenario-explorer.html` |

Selection rules:

- Use `chart-explainer` for one main chart and no dashboard shell.
- Use `data-story` when multiple aligned views share a source and narrative.
- Use `scenario-explorer` only when real inputs can drive a transparent calculation.
- Start from plain HTML/SVG when none of the templates fits.

The templates have no external runtime dependency and do not use ZCode host APIs.
