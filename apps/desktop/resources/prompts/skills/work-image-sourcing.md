# Image Sourcing and Asset Clearance

## When to use

Use this skill when an image must be found, compared, licensed, or placed into a
document, deck, page, or visualization. A visual that exists only to decorate a sparse
layout is usually not a reason to search. Prefer supplied brand assets, a real product
screenshot, verified user media, or a generated asset when those better represent the
subject.

The source `image-search` plugin is not a compatible Mingshen capability: it calls a
ZCode HTTP MCP endpoint with ZCode JWT authentication and contains no independent
`SKILL.md`. This native workflow uses only `web_search`, `web_fetch`, the Mingshen
browser, approved workspace reads/downloads, and the user's supplied assets.

Before a consequential search, load
[sourcing and rights](work-image-sourcing/references/sourcing-and-rights.md). Keep the
[asset ledger template](work-image-sourcing/references/asset-ledger.md) when multiple
images are evaluated.

## Define the image brief

Specify:

1. Subject and required visible state. "AI office" is weaker than "worker comparing
   printed schedules at a desk, realistic, no logos."
2. Artifact role: hero, evidence, product detail, portrait, diagram reference, texture,
   or supporting illustration.
3. Crop, aspect ratio, target pixel dimensions, and background/contrast needs.
4. Audience, tone, region, language, and whether the use is internal or public.
5. Whether recognisable people, buildings, logos, artwork, or private property appear.
6. Required rights: internal use, public marketing, commercial use, modification,
   redistribution, and attribution.

Use real images for products, places, people, or objects the viewer must inspect. Do not
replace them with generic gradients or abstract blobs.

## Search and verify

Use `web_search` with source-aware queries, for example:

```json
{"query":"Wikimedia Commons electric bus charging station photo","max_results":10}
```

Prefer official asset pages because they expose creator, exact license, version, and
download context. Open the selected page with:

```json
{"url":"https://commons.wikimedia.org/wiki/File:example.jpg","max_chars":12000}
```

Search snippets are leads, not license evidence. Verify the image page and the linked
license. A search result's thumbnail, hotlink URL, or "free to use" label does not by
itself grant redistribution rights.

For finalists:

- Inspect the actual image composition and crop, not only the thumbnail.
- Record creator, source page, asset URL, license/version, attribution, modifications,
  download date, and restrictions.
- Check whether model/property release is needed for identifiable people or private
  property.
- Prefer the original-size source; do not upscale a small preview.
- Confirm the file signature, MIME type, dimensions, and SHA-256 after download.
- Do not bypass watermarks, paywalls, access controls, robots restrictions, or
  hotlink protection.

## Saving assets

Use an approved download or command tool only when the user needs the image saved for a
deliverable. Keep it inside the active workspace with a stable ASCII name and companion
provenance note. Never put credentials or cookies in a URL or command.

A browser screenshot is evidence of what the page looked like. It is not the original
image and does not inherit the source license in a way that permits reuse. Do not crop a
screenshot and present it as a licensed asset.

When downloading is unavailable, return the official source page, preview URL, license,
and recommended attribution rather than claiming the image is embedded.

## Use in deliverables

Preserve aspect ratio and subject focus. Crop for composition only after checking the
actual pixels. Keep sufficient resolution for the final print or display size. Provide
alternative text that describes the image's function, not a keyword list.

Place attribution in the location required by the license and add the full source record
to the project/source appendix when appropriate. For an editorial image, do not imply
that the person or organization endorses the document. For a logo, do not recolour or
recompose it outside the brand owner's supplied usage rules.

## Final check

- The image communicates the specific subject and is not generic stock atmosphere.
- Crop, resolution, contrast, and surrounding text work at final output size.
- The license and source were actually read.
- Required attribution is present.
- People/property/trademark risk is disclosed.
- The file actually saved is the one inspected.
- No remote image is silently needed when the artifact claims to be offline.
