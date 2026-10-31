# iOS live detection & capture alignment — root-cause analysis and fix plan

Status: Parts 1–3 complete in code (analysis, diagnostics, fix). Sections 8–10 describe what shipped; section 7 lists what still requires a real-iPhone bundle.

Reference implementation: `C:\Marker-td\gradevn` (Flutter, Android release APK). Web port: `C:\Gradevn-web`.
No Dart file was modified for this analysis. `C:\Marker-td` stays read-only.

---

## 1. Symptom

On a real iPhone (Safari, installed PWA at https://gradevn-web.vercel.app/):

1. Live screen always shows **0/4 mốc**, even when all four printed corner squares are visibly inside the four guide rectangles. Rectangles are at the same screen positions as the Android APK.
2. Auto capture therefore never fires. Manual capture does fire.
3. The result screen "Ảnh phiếu đã nắn phẳng" is **not flat/upright**: the sheet is tilted/sheared with background around it, vertical streak artifacts in the upper-left, and the four green circles (template marker positions) land on only ~2 real squares. Bubble grid is misaligned, so answers are likely wrong.

Both symptoms must be explained by the same underlying data path, because the live rectangles and the capture pipeline share the same overlay→frame mapping and the same blob scan.

## 2. Method

- Read the full Dart live-scan path and the full web path, line by line (sections 3–4).
- Built a synthetic test harness that runs the **real production code** (`scanLiveMarkerBoxes`, `scanAndGrade`, `verifyWarpedGrayPlanar`) on generated sheet scenes, including degradations (section 6). The harness is temporary (`tests/camera/_part1.report.test.ts`) and is removed from the final test suite; its results are recorded here.
- Cross-checked browser/PWA behavior where the code can only observe it indirectly. No iPhone simulator or Mac is available, so iOS-specific frame delivery is **not** verified here; that is precisely what the on-device diagnostics (Part 2) are for.

## 3. Dart live path (reference)

| Step | Behavior | Location |
| --- | --- | --- |
| Camera frame | `CameraImage` YUV420; only the Y plane and its `bytesPerRow` stride are used; frame rejected if `stride*(h-1)+w > bytes.length` | `scan_screen.dart:278-283` |
| Display frame size | `_analysisFrameSize = Size(height, width)` — sensor frame is landscape, screen is locked portrait, so frame size is recorded display-oriented | `scan_screen.dart:286` |
| Throttle | one analysis per `_analysisInterval` (80 ms) | `scan_screen.dart:289-297` |
| Frame rotation | isolate rotates the Y plane 90° CW (sensor 90) or CCW (sensor 270) into the display orientation before any ROI math | `scan_screen.dart:311-317`, `:400-423` |
| Overlay rects sent with the frame | `_captureOverlayRects()`: guide-box centers (calibration fractions of the preview area) ± half of the 157×203 box, mapped **screen→frame** through `CoverMapping`; returned as fractions of the analysis frame | `scan_screen.dart:307-310`, `:542-570` |
| Per-rect scan | expand pinned rect by `_rectExpandFactor = 1.5`; `locateDarkBlobInRegion` with `minFill 0.6`, `aspect 0.6..1.65`, `minSidePx max(4, shortRect*0.12)`, `maxSidePx shortRect*0.95`; accept only if blob centroid stays inside the **original** rect | `scan_screen.dart:424-460` |
| Per-rect decision | `rectReads` returns a bool per rect → lights. No whole-frame detector, no knownQuad, no verification in the live tick (R11) | `scan_screen.dart:461-480` |
| Green streak / auto capture | 2 consecutive all-green ticks (80 ms each) → auto capture; `_autoArmed` re-arms only after leaving 4/4 | `scan_screen.dart:339-348` |
| Threshold | within the ROI: `pageLevel = p75` of sampled luma, `threshold = clamp(pageLevel*0.5, 30, 200)` | `marker_blob_scan.dart:90-108` |
| Blob rules | BFS on a subsampled grid (`step = max(1, min(rw,rh)/48)`), component ≥ 8 cells, `fill ≥ minFill`, aspect in range, side in range, closest centroid to window center wins (− area·0.01) | `marker_blob_scan.dart:114-154` |

Key consequence: in the Dart live path the frame is guaranteed **display-oriented** before ROI fractions are applied. On Android that guarantee is enforced by the explicit rotation.

## 4. Web live path

| Step | Behavior | Location |
| --- | --- | --- |
| Camera frame | `<video>` (`playsinline`, `muted`, `autoplay`), `object-fit: cover`, full window; probe draws it into a canvas and reads RGBA | `ScanScreen.svelte:1015-1021`, `:1359-1372`; `camera.ts:42-59` |
| Readiness | probe returns early while `readyState < 2` or `videoWidth == 0`, retries every 220 ms (no error shown) | `ScanScreen.svelte:428-431` |
| Throttle | `PROBE_INTERVAL_MS = 80` | `ScanScreen.svelte:71`, `:417-423` |
| Frame size | `video.videoWidth × video.videoHeight` at probe time | `ScanScreen.svelte:439-442` |
| ROI mapping | `overlayRectsForFrame(area, frameNow)`: guide centers → screen boxes → `CoverMapping.toFrame` → normalized rects | `ScanScreen.svelte:443`; `overlayGeometry.ts:102-176` |
| Pixel extraction | `captureVideoFrame(video, 640)`: scale = min(1, 640/videoWidth); `drawImage`, `getImageData`; no stride, no orientation handling, no byteLength assertion | `imageInput.ts:44-58` |
| Worker | copies RGBA into `Uint8ClampedArray`, computes BT.601 full-range luma, calls `scanLiveMarkerBoxes` | `omr.worker.ts:42-66`, `:170+` |
| Per-rect scan | faithful port of `rectReads`: 1.5× expansion, `minFill .6`, aspect `.6..1.65`, `minSide max(4, .12*shortRect)`, `maxSide .95*shortRect`, centroid in original rect | `liveMarkerScan.ts:30-70` |
| Lights | `lights = response.squares.map(ok)`; same 2-tick streak / auto-arm logic as Dart | `ScanScreen.svelte:447-482` |
| Errors | probe exceptions are stored in `probeError`, which is rendered **only inside the debug panel**; otherwise silent | `ScanScreen.svelte:453-455`, `:246` |
| Threshold / blob | same `locateDarkBlobInRegion` port, same p75×0.5 clamp, same BFS/rules | `markerBlobScan.ts:37-156` |

### 4.1 Difference table (live)

| Aspect | Dart (APK) | Web | Web location | Likelihood of causing 0/4 |
| --- | --- | --- | --- | --- |
| Frame orientation | Explicit 90°/270° rotation using `sensorOrientation` | None — assumes `drawImage(video)` pixels are already display-oriented | `ScanScreen.svelte:443-445`; `imageInput.ts:44-58` | **Medium-high** if Safari’s canvas frame differs from the displayed orientation (synthetic 90° case: 0000) |
| Luma source | Camera Y plane (BT.601 Y, limited range typically) | RGBA → 0.299R+0.587G+0.114B (full range) | `omr.worker.ts:170+` | Low by itself; combined with iOS tone mapping a few–tens of levels |
| ROI base | Display-oriented analysis frame | `videoWidth/Height` + display box | `ScanScreen.svelte:439-443` | Same orientation risk as above |
| Threshold | p75×0.5 clamp 30–200 | identical | `markerBlobScan.ts:73-80` | **High**: with a bright page p75≈230, threshold≈115; a mid-gray marker (glare/auto-exposure) at 130–150 is “not dark” → no blob → 0/4 |
| ROI min contrast evidence | works on Android camera exposure | synthetic fails at marker/page 146/232, 147/190, 130/210 | section 6 | **High** |
| Marker size rule | 12% of box short side | identical | `liveMarkerScan.ts:57` | Low: synthetic markers at 0.13 pass, at 0.10 fail; real markers are ~0.3–0.6 of the box |
| Border/ROI margin | centroid must stay in original rect; 1.5× window | identical | `liveMarkerScan.ts:63-66` | Low: synthetic markers shifted to ±40–45% of the box still pass |
| Detection loop failure visibility | `debugPrint` + analysis errors are visible in Flutter logs | error only in debug panel; a hung worker leaves lights at 0/4 with no message | `ScanScreen.svelte:425-458` | **Medium**: cannot be excluded on device; diagnostics added |
| Frame readiness | camera controller frame is complete by definition | `readyState ≥ 2`; synchronous canvas read | `ScanScreen.svelte:428`; `imageInput.ts:44` | Low |
| State gating | none (direct per-rect bool) | none | `ScanScreen.svelte:447-482` | Ruled out |
| Downscale | 640 px target width | 640 px target width | `imageInput.ts:13` | Ruled out (640×480 synthetic passes) |

## 5. Web capture path

- Capture (auto or manual) reads **three canvas frames** at 1600 px wide, 120 ms apart, then stops the stream and grades all three (`ScanScreen.svelte:490-551`).
- Each frame is graded with `overlayRects` and `frameSize` (`ScanScreen.svelte:572-579`).
- `scanAndGrade` passes `skipVerification:false` but `requireVerifiedWarp:false` (`scanFlow.ts:195-216`).
- Quad resolution order (`scanService.ts:190-217`):
  1. `knownQuad` (photo picker crop) → no verification.
  2. `overlayRects` → `resolveOverlayRects` (pinned ROI blob scan) → if null, whole-frame detector.
  3. no pinned rects → whole-frame detector → `overlayQuad` fallback.
- Pinned path (`resolveOverlayRects`, `scanService.ts:420-506`): 1.5× ROI, `locateDarkBlobInRegion` **defaults** (`minFill .5`, aspect `.55..1.8`, no min/max side), centroid must stay in the original rect, `worstFill ≥ .04`, side ratio ≤ 2.4, `plausibleQuad` only checks width/height > 1. It picks the variant with highest worst fill.
- **Trust shortcut** (`scanService.ts:237-239`): if the quad came from the pinned path and was not from the detector, `verification = null` and the round-trip is skipped. This is Dart R17 behavior (`scan_service.dart:401-411`).
- If verification is computed and fails, alternatives are tried; if none passes, grading continues anyway because `requireVerifiedWarp:false` (Dart R19b; `scan_service.dart:499-503`). So a wrong warp can be graded silently.
- Warp: `solveHomography(targetQuad.corners, quad.corners)` + bilinear gray sampling (`sheetAlignment.ts`); target = template `cornerMarkerCenters` on a 1576×2205 page.
- Result screen draws the warped image and **template** marker centers (`drawWarpedScan`), not the quad actually used (`render.ts`, `ScanScreen.svelte:766-803`).

### 5.1 Hypotheses A–F (capture)

| # | Hypothesis | Verdict | Evidence |
| --- | --- | --- | --- |
| A | Web silently substitutes overlay rect centers as the quad when no markers are found | **Mechanism confirmed, literal “centers” disproved.** No code path uses the guide-box centers as corners. The pinned path instead uses the **centroid of whatever dark blob it finds inside each expanded ROI**, and `quadTrusted` skips all verification. Under iPhone contrast, other dark regions (bubbles/text) can win; synthetic low-contrast + distractors produced a 29.6 px wrong quad, accepted silently. Background around the sheet follows when the quad is larger than/wrong relative to the markers. | `scanService.ts:192-193`, `:237-239`, `:420-506`; synthetic result 6.2 |
| B | Preview `object-fit: cover` vs full captured frame mismatch | **Not observed in math; iOS pixel-orientation still unverified.** The same `overlayRectsForFrame` fractions are applied to the 1600 px capture; fractions are resolution-independent. Synthetic cover mapping for 1920×1080 and 1080×1920 in a 390×844 box is exact. The capture image is recognizable/upright (not sideways), so a wholesale cover mismatch is unlikely; an iOS frame-orientation mismatch would show as a sideways sheet, which the user did not report. | `overlayGeometry.ts:102-176`; synthetic tests 7.1 |
| C | Stride/size mismatch producing shear/streaks | **No stride in the web path** (ImageData is tightly packed RGBA). However, there were **no assertions** at any hop; a dimension mismatch would silently shear. Add `byteLength === w*h*4` assertions and fail loudly. | `imageInput.ts:44-58`, `omr.worker.ts:47`, `:75` |
| D | Rotation/flip applied to frame but not marker coords | **Possible for live (no variants); capture already has orientation variants.** `resolveOverlayRects` tries identity/180 (same axis) or CW/CCW (cross axis) between capture dims and preview dims. If `videoWidth/Height` disagree with the pixel buffer, those variants cannot repair it. Diagnostics will record raw frame + ROI positions. | `scanService.ts:435-454` |
| E | Three frames captured at different moments / half-decoded | **Unlikely.** Canvas `drawImage` is synchronous and uses the current decoded frame. Frames are 120 ms apart by design (voting). No `readyState`/`currentTime` assertion existed; add diagnostics. | `ScanScreen.svelte:522-541` |
| F | Warp corner order / degenerate quad | **Corner order consistent (tl,tr,br,bl).** `plausibleQuad` is weak (only width/height > 1), and the pinned path never verifies, so a degenerate or wrong quad is not rejected. Post-warp sanity check missing for pinned quads. | `scanService.ts:498`, `:237-239` |

Why the four green circles look axis-aligned: `drawWarpedScan` always draws the **template** marker centers. They are an axis-aligned rectangle in the output regardless of the quad used. They landing on only ~2 real squares is a symptom of a wrong homography, not proof that overlay centers were used as corners.

**Status after implementation (section 9):** C is closed by assertions at every hop; F is closed by always checking the warp and either rescuing with a verified alternative quad or exposing a non-blocking warning; E now records `readyState/currentTime` per captured frame. A remains a Dart-parity risk that the diagnostic (not a silent guess) now handles. B/D can only be closed with a real iPhone bundle.

## 6. Synthetic live-detection results (real production code)

Scene: white page, text lines, four dark printed markers; guide rects from `guideGeometry`; sheet content mapped through `coverMapping`; marker side = 18% of box width unless stated. Result string = four booleans `tl,tr,br,bl`.

### 6.1 Resolution / orientation

| Case | Result |
| --- | --- |
| portrait 1080×1920 | 1111 |
| portrait 720×1280 | 1111 |
| landscape 1280×720 | 1111 |
| landscape 1920×1080 | 1111 |
| landscape area 844×390 | 1111 |
| low res 640×480 | 1111 |

### 6.2 Degradations

| Case | Result |
| --- | --- |
| blur radius 2 | 1111 |
| blur radius 5 | 1111 |
| perspective, top edge +10% wider | 1111 |
| perspective, top edge +20% wider | 1111 |
| marker at +40% box width (right edge) | 1111 |
| marker at +45% box height (bottom edge) | 1111 |
| marker at −45% box width (left edge) | 1111 |
| marker side 0.13 of box | 1111 |
| marker side 0.10 of box | **0000** |

### 6.3 Contrast (marker luma / page luma)

| Case | Result |
| --- | --- |
| 20 / 228 (printed black) | 1111 |
| 130 / 210 | **0000** |
| 146 / 232 | **0000** |
| 147 / 190 | **0000** |

The contrast failures are the exact signature of this report: the rectangles look correctly placed, but no pixel in the ROI is below `p75×0.5`, so every rect reports no blob and the screen stays at 0/4. The code cannot distinguish “no marker here” from “marker is not dark enough”.

### 6.4 Content rotated 90° relative to the displayed frame

| Case | Result |
| --- | --- |
| content portrait, frame/rects landscape | **0000** for the raw rect set and all four rect variants |

If Safari ever hands the canvas a frame whose orientation does not match `videoWidth/Height` as displayed, every tick fails exactly like this. This cannot be confirmed without the device; the diagnostic export includes the raw live frame and the four ROI rectangles so it can be confirmed from one screenshot.

### 6.5 Capture path

| Case | Quad error vs truth | Verification |
| --- | --- | --- |
| correct pinned path 1600×900 | 0.8 px (would pass) | **not computed** (`quadTrusted`) |
| correct pinned path 1080×1920 | 6.5 px (max marker offset 8.1 px > 6.0) | **not computed** |
| low contrast + distractor squares | **29.6 px** | **not computed** |
| low contrast, no distractors | no quad | falls back to detector |

This proves hypothesis A’s mechanism: the pinned path can return a quad that is visibly wrong and the pipeline grades it without ever running the round-trip check. On the iPhone, low contrast makes the ROI scan latch onto bubbles/text instead of the printed markers; the resulting quad is larger/skewed relative to the sheet, which is exactly “sheet tilted in a large frame with background”.

After the fix (section 9), the same low-contrast + distractor scene is still returned (Dart best-effort), but `diagnostics.alignmentWarning === true` unless an alternative quad passes the round-trip check and is adopted (`rescuedQuad`). Regression test `tests/camera/captureDiagnostics.test.ts` asserts this. Rotating the captured frame 0/90/180/270 relative to the preview-oriented pinned rects still resolves the four markers within 9 px, so orientation variants remain intact.

## 7. Confirmed vs unconfirmed on the real iPhone

**Confirmed by code + synthetic reproduction**

- The live per-rect logic itself is a faithful port; green lights are not gated by any other state.
- Low contrast alone produces permanent 0/4 with correctly positioned rectangles.
- The capture pinned path can produce and silently grade a wrong quad; there is no verification for pinned quads and failure does not block grading (`requireVerifiedWarp:false`).
- Cover mapping math is correct **provided** the canvas frame is display-oriented; if it is not, 0/4 follows deterministically.
- No byteLength assertion exists at the capture→worker hop.

**Unconfirmed without device data**

- Whether Safari delivers `drawImage(video)` pixels in the same orientation as the displayed preview and reported `videoWidth/Height` on this iPhone/iOS version.
- Whether the probe worker runs at all on the device (no error surfaced outside debug).
- The actual luma of the printed markers vs the page in the probe frames on this device.
- Whether the pinned capture quad is wrong because of contrast, mapping, or both.

Consequently Part 2 (diagnostics) ships first, and Part 3’s fix is conservative: alignment checks and warnings, exact Android defaults, and an opt-in tolerant mode rather than silently loosening thresholds.

## 8. On-device diagnostics (Part 2)

Implemented on the scan screen and result screen. Enabled with `?debug=1` (URL query; also kept on for dev builds).

Live panel (updates with every probe tick):

- `videoWidth × videoHeight`, displayed preview box (CSS px), `devicePixelRatio`, `screen.orientation`, `readyState`, `currentTime`.
- Track settings from `track.getSettings()` (`width`, `height`, `frameRate`, `facingMode`, deviceId) and the `describeTrack` label.
- Tick stats: ticks/s measured over a 3 s window, last tick duration, worker state (`alive` / `error`), last error. Probe exceptions are also surfaced on the normal scan screen as a red banner, not only in this panel.
- Per rect (tl, tr, br, bl): guide rect and 1.5× scan rect in **frame pixels**, threshold used (`p75 × factor`), sampled/dark pixel counts, connected-component count, and the closest candidate (`bbox`, side, fill, aspect, distance to ROI centre, touches scan border) with an explicit rejection reason: `no dark pixels (threshold X, p75 Y)`, `no blob (...)`, `area too small`, `fill 0.41 < 0.6`, `aspect 2.1 outside 0.6..1.65`, `side 3 px outside 9.4..78.0`, `centroid outside guide box`, or `FOUND`.
- A small thresholded ROI thumbnail for each rect (from the worker mask, RGBA).
- Button **“Lưu dữ liệu chẩn đoán”**: exports via the iOS share sheet (`navigator.share` with files; download fallback) individual files: RAW full probe frame PNG (no overlay), the 4 thresholded ROI PNGs (upscaled nearest-neighbour to 160 px wide), and `live-<timestamp>.json` with all numbers, `userAgent`, platform, track settings, cover mapping, guide/overlay rects, `frameInfo`, and the last 50 tick summaries.
- The panel also has a button to export the **last capture** (raw frame + warped image + JSON) when one exists, so a failed capture does not need to be repeated to collect data.

Capture diagnostics (auto and manual; result screen + JSON export):

- Path used: auto-all-green vs manual; quad source: `knownQuad` / `pinned overlayRects` / whole-frame detector / `overlayQuad`.
- RAW captured frame exactly as grabbed (1600 px), width/height/byteLength, `videoWidth/videoHeight`, `readyState`, `currentTime` at each of the 3 frames.
- Worker-received frame width/height/byteLength with assertion `byteLength === width*height*4` both in the client and in the worker (throws a clear Vietnamese error, never shears silently).
- Markers actually used for the warp in captured-frame px; separately the pinned overlay positions, detector positions, target template positions, corner order, homography matrix, pageScale, source/warped sizes.
- Warped image + round-trip verification of the 4 corner squares against template positions, with pixel error, plus `rescuedQuad` when the pinned quad was replaced by an alternative that passed.
- ROI/overlay→frame mapping numbers: cover scale, offsetX/offsetY, guide centres, overlay rect centres.
- Export bundle: `capture-<timestamp>-raw.png` + `capture-<timestamp>-warped.png` + `capture-<timestamp>.json` through the share sheet.
- On the result screen, the raw captured frame is shown with the quad actually used (green), the 4 overlay rects (amber) and, with the toggle, the overlay rect centres (cyan crosses).
- If the post-warp check fails, a **non-blocking** warning is shown above the flattened image and in the warnings list: “Phiếu có thể chưa được nắn đúng, nên chụp lại.” Grading still follows Dart semantics, but the image is never presented as verified.

## 9. Fix plan (Part 3) — implemented

Defaults match Android; no grading-math change.

1. **Live** — implemented
   - `probeOnce` keeps `readyState`/`videoWidth` guards, records frame/timing diagnostics, and every probe exception sets `probeStatus = 'error'` and shows a red banner on the scan screen. Worker errors are no longer invisible.
   - `byteLength === w*h*4` asserted in `captureVideoFrame`, `toImageBuffer` and the worker (`assertImageBuffer`).
   - Dart per-rect rules remain the default (`p75×0.5`, minFill 0.6, aspect 0.6–1.65, side 0.12–0.95 of short rect, centroid inside guide rect). Opt-in setting **“Chế độ iOS dễ tính (mốc tương phản thấp)”** (debug panel, persisted in `localStorage`, default OFF) changes only the threshold factor to **0.8** for the live scan and the pinned capture scan. It is never enabled automatically.
   - No automatic orientation probe was added. The diagnostic bundle shows whether the frame is display-oriented. If it is not, an orientation probe can be designed with real data instead of guessed.
2. **Capture** — implemented
   - Every grade request now calculates the post-warp round-trip verification, even for pinned quads (`diagnoseAlignment: true`, `verificationSkipped`). This is a diagnostic check; it does not change the grading formula.
   - If the pinned quad fails that check, the service tries (a) the whole-frame detector quad and (b) the other orientation variant of the pinned scan, and adopts the first alternative that passes (`rescuedQuad`). This is a deliberate deviation from Dart R17 “trust pinned quads”: it only changes which quad is used for rectification, never the scoring math. If no alternative passes, the Dart result is kept and the non-blocking warning is shown.
   - The flattened image and the markers used are now visible; the overlay-centre toggle allows a direct visual check. The raw captured frame is cloned before the worker transfer, so the debug canvas and the raw PNG export stay intact after grading.
3. **Tests** — implemented in `tests/camera/captureDiagnostics.test.ts`:
   - cover mapping at 390×844 for 1920×1080, 1080×1920, 1280×720, 720×1280; all four rect centres round-trip to the guide centres and the markers are FOUND;
   - 90°/180°/270° rotation of the captured frame against the preview-oriented pinned rects: the quad still finds all four markers within 9 px;
   - rejection reasons (`no dark pixels`, `area too small`/`side`, `fill 0.4 < 0.6`, aspect/flat) and mask RGBA size;
   - tolerant factor 0.8 flips the 146/232 grey-marker case from 0000 to 1111;
   - RGBA stride mismatch throws with the byte counts;
   - pinned quad that latches onto distractor blobs either reports `alignmentWarning` or is rescued by a passing quad — never silently presented as verified.
   - Full suite: **73 tests passing**; `npm run check` clean; `npm run build` succeeds.

Verification in a desktop browser (Vite dev server + a fake 1080×1920 camera stream, `?debug=1`):

- Live panel rendered 4 ROI cards with real thresholds, dark-pixel counts, closest-blob numbers, rejection reasons (`side 7 px outside 10..79.1`, …) and 4 thresholded masks whose dark-pixel counts match the numbers; the tolerant toggle switched `p75×0.5` (threshold 127.5) to `p75×0.8` (200) at runtime.
- Manual capture produced the capture diagnostics block (quad source, used/pinned/detector/target quads, offsets, homography, source 1080×1920/8,294,400 byte) and the export bundle `capture-…-raw.png` + `capture-…-warped.png` + `capture-….json` (share sheet stubbed to inspect file names/sizes).
- Photo-picker fallback still grades the fixtures correctly (9.25 and 9.75) and draws the captured frame with the used quad.
- This pass caught a real bug: the worker transfer detached the raw capture buffer, so the raw PNG export and the debug canvas were empty (`rawFrame.byteLength = 0`). Fixed by cloning the raw frame before grading (`cloneImage`), with a regression test.

## 10. Vietnamese summary (for the phone test)

**Nguyên nhân đã xác nhận bằng code + mô phỏng**

1. Logic quét 4 ô live trên web là bản port đúng của APK, nhưng ngưỡng “đen” là `p75×0.5` của vùng ROI. Khi giấy quá sáng/camera iPhone làm mốc in ra màu xám (chói, auto-exposure), mốc không còn “đen” theo ngưỡng → cả 4 ô báo không thấy mốc → luôn 0/4 dù mắt thấy mốc nằm trong ô. Mô phỏng đúng hiện tượng: mốc 146/giấy 232, 147/190, 130/210 đều cho 0000.
2. Đường chụp dùng quad từ “quét blob trong 4 ô ghim”. Nếu tương phản thấp, blob bắt nhầm sang bong bóng/chữ; nhánh này **bỏ qua kiểm chứng** (`quadTrusted`, giống Dart R17) và web còn đặt `requireVerifiedWarp:false`, nên quad sai vẫn được chấm. Mô phỏng: quad lệch 29.6 px mà không hề báo. Đây là lý do ảnh nắn phẳng bị nghiêng/méo, còn nền xung quanh.
3. 4 vòng tròn xanh trên ảnh kết quả luôn là vị trí mốc của template (hình chữ nhật thẳng), không phải tâm 4 ô overlay; chúng chỉ khớp 2 mốc thật vì homography dùng quad sai.
4. Chưa xác nhận được trên máy thật: Safari có trả khung canvas đúng hướng hiển thị không, worker có chạy không, và độ sáng thực của mốc. Nếu khung bị xoay 90° so với `videoWidth/Height`, mô phỏng cũng cho 0000 tuyệt đối.

**Đã sửa trong bản này**

- Thêm màn chẩn đoán `?debug=1`: hiện khung hình, track, nhịp quét, ngưỡng, số pixel tối, lý do từng ô và ảnh mask; lỗi worker hiện banner đỏ ngay màn quét.
- Thêm nút **“Lưu dữ liệu chẩn đoán”** ở màn quét (raw frame + 4 ROI ngưỡng + JSON) và ở màn kết quả (raw frame đã chụp + ảnh nắn + JSON có quad/verify/homography).
- Thêm kiểm tra `byteLength = width×height×4` ở mọi chặng; buffer sai báo lỗi rõ thay vì làm ảnh bị xé.
- Quad ghim giờ luôn được kiểm chứng sau nắn. Nếu sai, thử detector và biến thể hướng còn lại; chỉ nhận quad đạt. Nếu không cứu được, vẫn giữ kết quả theo Dart nhưng hiện cảnh báo **“Phiếu có thể chưa được nắn đúng, nên chụp lại.”** — không im lặng.
- Ảnh kết quả hiện quad thực dùng để nắn (xanh), 4 ô ghim (vàng), tâm ô ghim (xanh lơ, có công tắc).
- Thêm **“Chế độ iOS dễ tính (mốc tương phản thấp)”** trong bảng chẩn đoán, mặc định TẮT, đổi ngưỡng p75×0.5 → ×0.8 để so sánh; không tự bật.

**Cần gửi lại sau khi test**: mở `https://gradevn-web.vercel.app/?debug=1`, đứng ở màn quét, bấm **“Lưu dữ liệu chẩn đoán”** (gửi RAW frame + 4 ảnh ROI ngưỡng + JSON). Sau đó chụp thử một phiếu (tự động hoặc nút Chụp), ở màn kết quả bấm **“Lưu dữ liệu chẩn đoán lần chụp”** (gửi RAW frame đã chụp + ảnh đã nắn + JSON có quad/verify/homography). Chỉ cần gửi đúng 2 gói đó là đủ để chốt nguyên nhân còn lại và kiểm tra bản sửa. Nếu vẫn 0/4, thử gạt **Chế độ iOS dễ tính** rồi gửi thêm một gói live nữa để so sánh.

