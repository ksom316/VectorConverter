# Vector Converter

Turns hand-drawn sketches and scanned architectural drawings into editable SVG and DXF
vector files. All image processing happens locally in the browser — nothing is uploaded
to a server, and no account is required.

## Workflow

Upload → Prepare → Trace → Inspect → Export

1. **Upload** a PNG or JPG scan/sketch (drag & drop or file picker).
2. **Prepare**: rotate and crop to the area you want to trace.
3. **Trace**: tune threshold, noise reduction, smoothing, and detail preservation. The
   vector preview updates automatically a moment after each change (slider, −/+ buttons,
   or typed value; "Reset to defaults" restores the originals). Tracing runs in a Web
   Worker so the UI stays responsive, and a superseded trace is cancelled so a slow
   result never replaces a newer one.
4. **Inspect**: compare the original and traced vector side-by-side or as an overlay, with
   zoom/pan, fit-to-view, and white/checkered backgrounds.
5. **Export** as a self-contained SVG, or as a DXF for CAD software. Optionally calibrate
   scale first (pick two points + a known real-world distance) so the DXF export uses real
   units instead of raw image pixels.

## Running locally

```bash
npm install
npm run dev
```

Then open the printed `http://localhost:5173` URL.

## Deploying to Vercel

The app is a static Vite build (`dist/`) with no backend, environment variables or secrets,
so it deploys as a static site. `vercel.json` sets the build/output, long-lived caching for
hashed `/assets/*`, and an SPA fallback to `index.html`.

1. Put the project in a Git repository and push it to GitHub/GitLab/Bitbucket
   (`git init`, commit, add a remote, push). `.vercel`, `node_modules` and `dist` are ignored.
2. In Vercel choose **Add New → Project**, import the repository and keep the detected
   settings (Framework: Vite, Build: `npm run build`, Output: `dist`). No env vars needed.
3. Click **Deploy**. Every later push redeploys.

Or from the CLI: `npx vercel` (log in, accept the defaults) for a preview, `npx vercel --prod`
for production. Requires Node 20.19+ or 22.12+.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — type-check and build for production
- `npm run test` — run the Vitest unit test suite
- `npm run typecheck` — TypeScript project build/check only
- `npm run lint` — oxlint

## Architecture

- `src/lib/image/` — file validation, decoding, and canvas rotate/crop transforms.
- `src/lib/trace/` — preprocessing (grayscale, threshold, Otsu, despeckle), ImageTracer.js
  option mapping, and tracedata → flattened contour geometry extraction.
- `src/workers/trace.worker.ts` — runs preprocessing + tracing off the main thread.
- `src/lib/svg/` — builds and validates the exported SVG from traced geometry.
- `src/lib/dxf/` — builds DXF entities (LWPOLYLINE) from traced geometry and validates the
  result with `dxf-parser`.
- `src/lib/calibration/` — pixel-to-real-world-unit scale math.
- `src/components/` — UI: upload, prepare (rotate/crop), trace controls, preview workspace
  (zoom/pan/overlay), calibration, and export panels.

## Notes and limitations

- **Tracing library**: uses [ImageTracer.js](https://github.com/jankovicsandras/imagetracerjs),
  a pure-JS, browser-compatible raster-to-vector tracer. Potrace itself only ships as a
  Node/CLI tool, so it isn't usable directly in a browser; ImageTracer.js's internal
  tracedata functions also run cleanly inside a Web Worker without any DOM dependency,
  which keeps tracing off the main thread.
- **OpenCV.js**: deliberately not included. Our own preprocessing pipeline (grayscale,
  Otsu/manual threshold, box blur, connected-component despeckling) already covers the
  required adjustments for scanned line drawings, and pulling in OpenCV.js's multi-MB WASM
  binary for this would run against the "keep dependencies minimal" goal without changing
  tracing quality for this MVP.
- **Curve approximation**: ImageTracer's quadratic Bézier segments are flattened to 8
  straight-line samples before SVG/DXF generation, so both exports approximate curves as
  short line segments rather than exact splines. This keeps DXF output as plain
  LWPOLYLINE entities, which is widely compatible but not geometrically exact for very
  tight curves.
- **Vertex simplification**: after curve-flattening, every contour and hole runs through
  Ramer-Douglas-Peucker simplification (`lib/trace/geometry.ts` `simplifyPolyline`) at a
  small pixel tolerance tied to the "smoothing" slider (`traceOptions.ts`
  `smoothingToSimplifyEpsilonPx`, ~0.35-1.5px). This removes pixel-staircase/JPEG-ringing
  wobble along straight or curved runs without snapping any angle — a point only survives
  because it deviates from its neighbors' chord by more than the tolerance, so real
  corners, 45-degree walls, and small openings/notches are always preserved regardless of
  this setting. On a real scanned CAD export (`Sample_Floorplan.jpg`, 842×569px JPEG) this
  cut the largest traced contour from 2530 to 1448 points and total exported SVG vertices
  from 4612 to 2552 (~45% reduction, same 155-path count — no contours were merged or
  dropped), confirmed by direct inspection of exported path/vertex counts and cropped
  before/after renders. Some residual waviness remains by design, since the tolerance is
  deliberately conservative to avoid erasing genuinely small architectural features.
- **DXF holes**: DXF has no native "hole" concept, so a contour's hole loops (e.g. the
  inside of a window/door outline) are exported as their own separate closed LWPOLYLINE,
  rather than as a single filled region with a cutout (which the SVG export does support,
  via `fill-rule="evenodd"`).
- **Measurement accuracy**: without calibration, exported coordinates are 1 drawing unit =
  1 source image pixel — not a real-world measurement. Calibration (two points + a known
  distance) must be set before exporting DXF for it to reflect real-world units; this is
  surfaced clearly in the Export panel either way.
- **DXF validation**: generated DXF files are parsed with `dxf-parser` before download to
  confirm they're structurally valid and contain at least one entity. This confirms
  structural validity, not that any specific external CAD application has opened the file
  — no such manual/external CAD testing was performed.
- **Polarity assumption**: thresholding always treats darker-than-cutoff pixels as ink
  (`src/lib/trace/preprocess.ts` `applyThreshold`). Scans of dark-lines-on-light-paper (the
  typical case) work correctly; an inverted/negative scan (light lines on a dark
  background) would have its foreground and background swapped and trace incorrectly. There
  is no auto-polarity detection.
- **Tracing is area-based, not centerline-based**: ImageTracer traces the boundary of each
  raster ink region, so every stroke (wall line, dimension line, hatch mark) becomes a thin
  closed outline of its two edges rather than a single open centerline path. For wall
  outlines in a floor plan this is usually the desired result (it preserves wall
  thickness); for zero-width elements like dimension lines or symbol strokes, it means the
  SVG/DXF output never contains true open polylines, only very thin closed loops. This is
  inherent to any raster area-tracing approach (the same is true of Potrace-style tracers)
  and would require a separate skeletonization step to change.
- **Large images**: files up to 8000px per side and 25MB are accepted. Preprocessing
  (blur, despeckle) and the pixel buffer transferred to the trace worker scale with
  width × height, so a scan near that limit can use several hundred MB of browser memory
  during tracing. This has not been load-tested against the 8000px ceiling in this
  environment, so treat it as an unverified risk for very large scans rather than a
  confirmed limit.
- **Automated testing**: Vitest covers image validation, preprocessing (grayscale,
  threshold, Otsu, despeckle), trace option mapping, tracedata → geometry extraction
  (including curve sampling and hole nesting), SVG generation/validation, DXF entity
  generation/validation (including coordinate flipping and calibration scaling), and
  calibration math — including empty-trace and invalid-input cases. End-to-end UI
  behavior (upload → prepare → trace → calibrate → export) was manually verified with a
  scripted Playwright smoke run during development, not included in the repository.
