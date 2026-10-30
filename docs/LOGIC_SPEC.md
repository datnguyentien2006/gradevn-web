# GradeVN — Logic Specification (Step 0, for the web/PWA port)

**Source of truth:** `C:\Marker-td\gradevn` (Flutter 3.47.7 / Dart 3, app `0.1.0+1`), read-only snapshot taken 2026-10-30. The original project must not be modified. A backup already exists at `C:\Marker-td-backup-20261030`.

**Target:** `C:\Gradevn-web` — iPhone-first PWA (Safari iOS 16.4+), Vite + TypeScript strict, deployed on Vercel.

**Rule for this port:** the grading pipeline and its constants are documented here and must be reproduced, not "improved". Bugs/oddities are listed in §7 for a decision; they are not fixed silently.

All line references below are for the snapshot above. Units:

- **Template units**: the printed frame is 2311 × 3409; corner marker centres are `(0,0)`, `(2311,0)`, `(2311,3409)`, `(0,3409)`.
- **Page units**: the whole sheet = frame + margins, 3151 × 4409.
- **Standard page**: the OMR reference page, 1576 × 2205 px (`SheetLayout.standardPage`). The actual warp target may be smaller: `pageScale = min(1, sourceWidth / 1576)`.
- **Image pixels**: coordinates in the decoded captured image (post-EXIF).
- **Preview fractions**: 0..1 of the displayed camera frame, used for the four fixed calibration boxes.
- **Density**: 0..1 ink fraction per bubble cell.

---

## 1. Screen map and user flows

### 1.1 Navigation tree

```
StartupGate (splash_screen.dart)
└─ HomeScreen (home_screen.dart) — bottom tabs
   ├─ Classes tab (classes_tab.dart)
   │  └─ ClassDetailScreen — roster, add/edit/delete student, import students XLSX
   ├─ Contests tab (contests_tab.dart)
   │  └─ ContestDetailScreen (contest_detail_screen.dart)
   │     ├─ KeyEditorScreen (key_editor_screen.dart)
   │     └─ ScanScreen (scan_screen.dart)
   │        └─ GradeResultScreen (grade_result_screen.dart)
   ├─ Results tab (results_tab.dart)
   │  ├─ ClassScoreboardScreen (class_scoreboard_screen.dart)
   │  └─ SheetListScreen (sheet_list_screen.dart)
   │     └─ SheetDetailScreen (sheet_detail_screen.dart)
   └─ Stats tab (stats_tab.dart)
Settings → PlaceholderScreen (placeholder_screen.dart) — no real settings yet.
```

`CropReviewScreen` exists but is unreachable in the current camera flow: a failed scan shows "re-shoot" and stays on the camera (`scan_screen.dart:654-669`).

### 1.2 Flows

**First launch.** `StartupGate` shows the animated splash for ~2.6 s (`splash_screen.dart`) and then the tab shell. There is no onboarding.

**Classes and students.**
- Classes tab: list classes; create class (name, description); edit/delete class. Delete is guarded by a repository rule (class with students cannot be deleted); UI asks confirmation (`classes_tab.dart:86-103`).
- Class detail: roster; add/edit student (code + full name); delete student (sheet rows keep their `studentId` cleared but remain); import students from XLSX column A = code, B = full name (`classes_tab.dart:471-548`, `xlsx_service.dart:146-167`).
- Class scoreboard: students × exams score matrix; tapping a cell jumps to the corresponding sheet.

**Create exam.** In Contests tab, dialog fields:
- name, date, optional class ("outside class" if none);
- question count (default 40), answer choices (default 4), max score (default 10);
- sheet type: Standard / 50 questions / 120 questions / Multi-part (ministry);
- ministry: part I/II/III question counts and max points;
- orientation: portrait/landscape.

The dialog stores a `Contest` (`contests_tab.dart`). **Important:** every form type and orientation still uses the single TN40 geometry (§7.1).

**Enter answer key.** From exam detail → "Add answer key" (`KeyEditorScreen`, 2 tabs):
1. **Exam code tab**: one row of 0–9 chips per digit; number of digits = template `examSlots` (3). Live preview of the assembled code.
2. **Answers tab**: one row per question, A–E toggles; tapping a selected letter deselects it.
- Save requires a complete code unless the user chooses **"Save without exam code"**, which stores an empty code = common/default key (`key_editor_screen.dart:_save`). This is the intended "exam without codes" mode.
- If some answers are empty, a confirmation is shown.
- One key per `(contestId, examCode)`; keys can also be imported from XLSX (column A code, columns B.. answers) and exported.
- Deleting a key asks for confirmation; already graded sheets keep their data.

**Scan and grade.** Exam detail → "Scan answer sheets" → `ScanScreen`:
- loads all keys and the class roster for the contest;
- locks portrait (`scan_screen.dart:167-169`);
- opens the back camera at `ResolutionPreset.veryHigh`, YUV420;
- draws **4 fixed calibration boxes** (size/positions from `MarkerOverlayCalibration`, not draggable);
- every ≤80 ms analyses the preview: each box is checked for a dark square; a box turns green when the live scan would find its marker;
- when all 4 are green for **2 consecutive analysis ticks**, the shutter fires automatically; a manual shutter button and "pick image from files" are also available;
- after capture, the frame and the 4 normalized boxes are sent to `processPhoto`; a spinner blocks further captures;
- success → `GradeResultScreen`; unreadable → snackbar "could not read the sheet, retake" and stay on camera.

**Result and save.** `GradeResultScreen` shows score, per-part rings, chosen answers vs key, and warnings (duplicate student, guessed exam code, common key, unknown student ID, multi-marked questions, blank sheet, irregular answer pattern). Two actions:
- **Retake** → pop back to the camera.
- **Keep result** → saves two PNGs and inserts a `GradedSheet`, then pops back to the camera; the camera resumes preview analysis.

**Results/history.**
- By class: scoreboard; missing students shown as empty cells; tapping opens the sheet.
- By exam: sheet list (student code, name, score, exam code, matched/duplicate warnings). Long-press multi-select delete; delete by student; delete all sheets of an exam; tap → sheet detail.
- Sheet detail: view original/marked images, edit SBD and exam code, relink to a student, regrade against the currently selected key, delete.

**Stats.** Scope: all / one class / outside class. Fixed pass threshold = 5/10 (`stats_tab.dart:33`). Shows KPIs (classes, students, exams, sheets, graded, average, completion), per-exam distributions, hardest questions, attention groups, trend. Export produces a 4-sheet XLSX (§4.5).

**Export/import (current).**
- Answer keys: XLSX import/export.
- Students: XLSX import.
- Results per exam: XLSX export.
- Stats: XLSX export (4 sheets).
- **No whole-database JSON backup and no image export** in the Flutter app; images live only in app documents.

---

## 2. Grading pipeline, step by step

There is **one pipeline** shared by live camera and file-picker input. Differences are only in how the image is obtained and whether the four preview boxes are supplied.

### 2.1 Entry points

| Input | Call | Marker hint |
|---|---|---|
| Live camera capture | `_process(bytes, overlayRects, frameSize)` → `processPhoto` | 4 normalized preview boxes |
| File/gallery image | `_process(bytes)` → `processPhoto` with no boxes | none → full-page detector |
| Tests/tools | `scanPhoto(... knownQuad / overlayQuad ...)` | explicit quad |

`processPhoto` (`scan_flow.dart:286-315`):
1. `_skiaPredecode(bytes)` on the UI isolate: decode with Skia, resize to a target width, "unbake" EXIF rotation into pixels, return RGBA.
2. Run `_scanAndGrade` inside `Isolate.run` with plain data only.
3. `_scanAndGrade` calls `scanPhoto(..., overlayMinQuality: 0.55, requireVerifiedWarp: false)` (`scan_flow.dart:229-263`).

### 2.2 Pre-decode / source preparation

- Skia decodes the PNG/JPEG. Target width = display width when known; otherwise source width, but **capped at 2000 px** (`scan_flow.dart:395, 402-466`). Height follows aspect ratio.
- EXIF orientation (1..8) is applied to the RGBA buffer (`scan_flow.dart:571-602`), so the pipeline's coordinate system is the displayed orientation.
- The pipeline works on a **planar gray** view obtained as **channel 0 of RGBA** (red), not the 299/587/114 luminance (`scan_service.dart:265-284`). The warp/detector/measure path uses this channel-0 data. Only the rect-scan blob locator and the standalone detector's byte path use the luminance formula (see §2.5).
- **There is no blur step and no global binary threshold of the page.** Thresholding is local/adaptive only where described below.

### 2.3 Page scale and layout

1. `stdPage = 1576 × 2205`; `pageScale = min(1, srcWidth / 1576)` (`scan_service.dart:292-298`).
2. Warp target page = `round(1576 × pageScale) × round(2205 × pageScale)`; if `pageScale ≥ 0.999`, exactly 1576×2205.
3. `SheetLayout.forSpec(spec, page: targetPage)` — always the TN40 template, regardless of form type/orientation (`sheet_layout.dart:24-32`).
4. Target quad = the four corner-marker centres on that page (`layout.cornerMarkerCenters`), computed as `(marginX + relX) × page.width/3151`, `(marginY + relY) × page.height/4409`. Note the x and y scales are computed independently and are not exactly equal.

### 2.4 Live camera guidance (before capture)

- Preview analysis is throttled to one pass per 80 ms (`scan_screen.dart:157`).
- The Y plane is rotated to the displayed orientation and downsampled to width 640 for analysis (`scan_screen.dart:362-380`).
- Four boxes come from `MarkerOverlayCalibration.forArea(previewArea).centerFractions` (`preview_overlay.dart:190-261`):
  - measurement space 720 × 1560, box 157 × 203, inner rect `left 0, top 64, right 719, bottom 1177`;
  - left column centres shifted +16 px, right column −16 px; Y unchanged;
  - landscape is an exact transpose; `forArea` picks by preview aspect;
  - cover mapping (`scale = max(screen/frame)`, centred) is used to place the boxes without distortion.
- Per box: crop around the box centre expanded by **1.5×**; find the darkest solid square with:
  - `minFill 0.6`, aspect `0.6..1.65`;
  - side `≥ max(4, 0.12 × shortSide)` and `≤ 0.95 × shortSide` (`scan_screen.dart:435-456`);
  - centroid must fall back inside the original (unexpanded) box.
- All four green → green streak counter; at streak ≥ 2 and armed → capture. The arm flag is dropped immediately before capture to prevent repeated shots (`scan_screen.dart:339-348`).

### 2.5 Finding the four corner markers (quad acquisition)

Order in `scanPhoto` (`scan_service.dart:306-367`):

1. **`knownQuad`** — explicit image-pixel quad; no detection, no orientation search. Not produced by the normal camera flow (crop review unreachable); used by tests/tools.
2. **`overlayRects` present** (live capture): scan inside the four boxes first (`_resolveOverlayRects`, `scan_service.dart:665-786`). If that fails → full-page detector on the channel-0 gray image.
3. **No boxes** (gallery/file): full-page detector first; if it fails and an `overlayQuad` is supplied, resolve orientation and use that quad.
4. Still null → scan returns null → UI asks for a retake.

#### 2.5.1 Rect scan (`_resolveOverlayRects`)

- Orientation variants chosen by comparing image aspect vs preview-frame aspect:
  - same axis: identity and 180°;
  - cross axis: CW and CCW maps `(a,b)→(b,1−a)` / `(1−b,a)`.
- For each of the 4 rects:
  - expand by **1.5×** around its centre, clamp to image;
  - run `locateDarkBlobInRegion` (shared live/scan algorithm, `marker_blob_scan.dart`):
    - sample grid step = `max(1, min(w,h) / 48)`;
    - page level = 75th percentile of sampled gray; black threshold = `pageLevel × 0.5`, clamped to `[30, 200]`;
    - mask pixels below threshold, 4-neighbour BFS components;
    - keep components with area ≥ 8 sampled cells, fill ≥ 0.5, aspect 0.55..1.8;
    - pick best by `distance − 0.01 × area`;
    - return centroid, estimated side, fill.
  - the blob centroid mapped back to preview fractions must lie inside the **original** rect;
  - all four must be found; worst fill must be ≥ **0.04**;
  - max/min marker side ratio must be ≤ **2.4** (markers are printed at one size);
  - quad must span > 1 px in both axes;
  - quads nearly equal (≤ 2 px at every corner) to an excluded quad are skipped.
- Variant with best worst-fill wins. No round-trip verification is done later for this quad: the four pins + fill + uniform size are considered the trust evidence.

#### 2.5.2 Full-page detector (`SheetMarkerDetector`)

Source: `sheet_alignment.dart`.

- Input image must be ≥120 px in both dimensions.
- Downsample factor `f = max(1, floor(width / 640))`; detector works on a ~640 px-wide image.
- Adaptive threshold: integral image; window half-size `max(8, round(expectedSide))`; a pixel is "dark" if `gray < 0.8 × localMean`.
  - `expectedSide = markerSide / pageWidthUnits × downsampledWidth ≈ 87/3151 × 640 ≈ 17.7 px`.
  - Accepted component side: `minSide = max(5, 0.4 × expectedSide)`, `maxSide = max(2×minSide, 3×expectedSide)`.
- 4-neighbour connected components; keep:
  - side within min/max,
  - aspect 0.7..1.4,
  - fill ≥ 0.5.
- Candidate centres are component centres scaled back to source pixels.
- Pick 4 corners from candidates using a convex hull / quadrant selection; the selected quad passes a rectangle-plausibility check (width and height > 1, quad shape ratio roughly 0.8..2.4).
- The detector may also run on the warped page for verification (below), in which case "image" is the warped gray page.

#### 2.5.3 Overlay-quad fallback (`_resolveOverlayQuad`)

Only used when no rects are supplied (tests/tool). It maps the pinned quad to four orientations (same axis: identity/180; cross axis: CW/CCW), mini-warps each to 320×450, and scores 12 template marker positions (`4 corners + 8 extra markers`):

- core radius `r = clamp(markerSide × layout.scale × miniScale / 2, 1, 12)`; ring to `1.9r`;
- score = 0.5 × fraction of core pixels < 110 + 0.5 × fraction of ring pixels > 190;
- accept best if score ≥ `minQuality` (default 0.55; the retry path in tests can use 0.35).

The normal app path does not call this function.

### 2.6 Perspective warp

- Homography maps the 4 detected/pinned marker centres (`tl,tr,br,bl`) to the 4 layout corner centres on the target page.
- The homography is solved as an 8-unknown linear system; a pivot below `1e-9` is treated as singular → null (`sheet_alignment.dart:156`).
- Output is a planar gray page of the target size; sampling is bilinear with clamped source coordinates; rounded pixel indices (`sheet_alignment.dart:602-...`).
- The warp reads the channel-0 (red) source for the app path.

### 2.7 Warp verification and retry ladder

`WarpedMarkerCheck` / `verifyWarpedGrayPlanar` (`scan_service.dart:88-164`):

- Run the full-page detector on the warped page.
- For each of the 4 expected corner centres, find the nearest detected candidate; record its distance.
- Pass only if **all four distances ≤ 6.0 px × pageScale**.
- `knownQuad` → verification skipped.
- Rect-scan quad (`quadFromDetector == false` and `overlayRects != null`) → **trusted, verification skipped**.
- Otherwise (detector quad):
  1. warp and verify;
  2. if failed, build alternate quads:
     - if current quad came from rect scan: full detector + the other orientation of rect scan, excluding the current quad;
     - if current quad came from the detector: rect scan in the other orientation (if rects exist) + overlay-quad fallback;
  3. warp/verify each alternate; first passing one replaces the quad;
  4. if still failed:
     - `requireVerifiedWarp == true` (default for tests/tools) → return null;
     - `requireVerifiedWarp == false` (app `processPhoto`) → **grade the original warp anyway** (best effort).
- This is why a photo taken through the file picker can still be graded when round-trip verification fails.

### 2.8 Bubble density measurement

Source: `omr_image_pipeline.dart`.

For every answer cell and every digit cell (`layout` scaled to the actual warped page):

- cell rect = square centred on the bubble centre with side = bubble diameter (in page units × page scale).
- Clamp to the image; require at least 4 px per side; otherwise density 0.
- Border strip width = `max(1, round(min(cellW, cellH) × 0.08))`.
- Background = mean of the four border strips (top, bottom, left, right), sampled every `sampleStep = 1` px.
- `darkBelow = background − 45`.
- Inner measurement core = central area after removing `insetRatio = 0.28` from each side.
- Density = (# core pixels with gray < darkBelow) / (# sampled core pixels), in 0..1.
- No blur, no morphology, no global threshold. This local-background approach tolerates uneven lighting.

Measured structures:
- 4 answer blocks × 10 rows × 4 columns (A–D); only the first `min(spec.answerChoices, 4)` columns are used.
- SBD digit grid 6 slots × 10 values; exam-code grid 3 slots × 10 values.
- Density arrays are the `DensityBlock` inputs to the decoder.

### 2.9 Decoding

Source: `omr_decoder.dart`.

**Answers** (`decodeAnswers`, `_decodeChoiceRow`):
- question index = `blockIndex × 10 + row` (not the block's `firstQuestionIndex`; same result for TN40).
- choose the highest-density column; tie → lower column (first wins because comparison is strict `>`).
- if best density < **0.30** → blank (`null`).
- map column 0..9 to `A..J`; column beyond J → null.

**Digits** (`decodeDigits`) for each slot row:
- find best column, then `restMean = sum(other 9 densities) / 9`.
- accept digit only if `best ≥ 0.30` **and** `best ≥ 2 × restMean`; otherwise `'?'`.
- result is a string with one char per slot (e.g. `'0?5123'`).

**Code normalization**:
- exam code (`normalizeCode`): trim, uppercase; if all characters are digits, strip leading zeros (`'007' → '7'`, all zeros → `'0'`).
- `isBlankCode`: true when the string contains no digit (`''`, `'???'` are blank).
- student code (`normalizeStudentCode`): trim, uppercase, remove all whitespace; leading zeros are preserved.
- matching (`studentCodeKey` / `sameStudentCode`): compare normalized student codes with leading zeros stripped.

**Multi-mark warning** (`countMultiMarkAnswers`):
- for each question, count cells with density ≥ **0.55**; if at least 2 → count the question.
- does not change the decoded answer (highest still wins) and does not block grading.

### 2.10 Key selection

`gradeScan` (`scan_flow.dart:94-187`):

1. `defaultKey = first key whose examCode.trim() is empty`.
2. `blankExam = isBlankCode(examCodeRaw)`.
3. **In-class, blank exam, no default key** → no key to grade:
   - result = all `null` flags, score 0, `graded = false`, `ungradedReason = examCode`, `usedExamCode = ''`;
   - the student is still matched from the roster; the sheet can be saved and completed later.
4. Otherwise:
   - `directKey = selectKey(keys, examCodeRaw) ?? (blankExam ? defaultKey : null)`;
   - `selectKey` compares normalized exam codes; an empty or `'?'` target returns null;
   - if no direct key, `bestScoringKey` picks the key with the most correct answers (first key wins ties) — the "best guess".
5. `usedBestGuessKey` warning is set only when: in-class, no direct key, a best-guess key exists, it is not the default key, and the normalized exam code is empty or contains `'?'`. Outside-class exams never show the guessed-key warning; they grade with a best-guess key silently.
6. If there are no keys at all, the key sequence is empty; the result is all-null flags and score 0.

### 2.11 Grading and score

Source: `grader.dart`, `scoring_rule.dart`.

- `computeFlags`: for each question index `i`:
  - if `i ≥ keyAnswers.length`, or the key char is not `A..Z`, or the decoded choice is null → flag `null`;
  - otherwise compare the decoded letter and key char case-insensitively → true/false.
- Score = sum of `rule.weightAt(i)` for every `true` flag; rounded to 2 decimals (`(v*100).roundToDouble()/100`).
- **Uniform rule** (non-ministry): every question weight = `maxScore / questionCount`.
- **Ministry rule**: if part counts and part weights are present, part I/II/III weights are divided across their question counts; otherwise the uniform rule applies. Part scores are only computed for ministry when all three part counts are present; each part score is rounded to 2 decimals.
- `correctFlags` are stored as a string of `'1'`, `'0'`, `'?'`; `chosen` as letters with `' '` or `'-'` for blanks.

### 2.12 Student matching and warnings (independent of grading)

- Only for in-class contests and a non-empty normalized SBD: find the first roster student whose normalized code matches (`sameStudentCode`). No match → `student = null`; the sheet is still graded.
- Warnings shown on the result screen include:
  - duplicate SBD among previous sheets of the same contest;
  - unknown/incorrect student ID (in-class, SBD non-empty, no roster match);
  - blank SBD;
  - exam code: not read / guessed key / common key;
  - multi-marked questions count;
  - blank/near-blank answer row and irregular pattern (result screen presentation).

### 2.13 Save artifacts

`scan_screen.dart:745-803`:

- The result screen's save callback runs while the camera screen is still mounted.
- Saves under `Documents/sheets/contest_<id>/`:
  - `orig_<milliseconds>.png` — the warped page (gray page encoded as PNG once);
  - `marked_<milliseconds>.png` — the warped page rendered with correct/wrong/blank marks.
- `saveScannedImages` renders the marked sheet using a **standard-page layout** (`1576×2205`), independent of the warped page scale.
- Inserts a `GradedSheet` with:
  - `examCode = usedExamCode` (empty string when ungraded for missing code);
  - `studentCode = ''` if the SBD grid was empty, else the decoded string (can contain `?`);
  - `chosen`, `correctFlags`, `score`, `keyId = usedKey?.id`, `studentId = student?.id`;
  - `partScores`, image paths, `gradedAt`.
- Does not pop; the result card controls navigation.

---

## 3. Constants and thresholds

### 3.1 Sheet template and layout (`lib/domain/services/sheet_template.dart`, `sheet_layout.dart`)

| Constant | Value | Source |
|---|---|---|
| Frame size | 2311 × 3409 | `sheet_template.dart:81-82` |
| Corner marker side | 87 | `sheet_template.dart:83` |
| Inner small marker side | 63 | `sheet_template.dart:84` |
| Bubble diameter | 80 | `sheet_template.dart:85` |
| Digit value rows | 10 | `sheet_template.dart:86` |
| SBD slots | 6 | `sheet_template.dart:87` |
| Exam-code slots | 3 | `sheet_template.dart:88` |
| SBD column centres (template X) | 308.5, 402.0, 495.5, 589.0, 682.5, 776.0 | `sheet_template.dart:89` |
| Exam-code column centres | 978.5, 1072.0, 1165.5 | `sheet_template.dart:90` |
| Answer group 1 (Q1–10) | cols 1552.0, 1645.5, 1739.0, 1832.5; row0 1008.5; pitch 108.6 | `sheet_template.dart:92-97` |
| Answer group 2 (Q11–20) | cols 405.5, 498.3, 591.2, 684.0; row0 2207.0; pitch 108.7 | `sheet_template.dart:98-103` |
| Answer group 3 (Q21–30) | cols 978.5, 1071.8, 1165.2, 1258.5; row0 2207.0; pitch 108.7 | `sheet_template.dart:104-109` |
| Answer group 4 (Q31–40) | cols 1552.0, 1645.5, 1739.0, 1832.5; row0 2207.0; pitch 108.7 | `sheet_template.dart:110-115` |
| Extra markers | (0,1705), (2311,1705), (871,904.5), (1448,904.5), (871,2101.5), (1448,2101.5), (871,3297), (1448,3297) | `sheet_template.dart:117-128` |
| Digit row 0 Y / pitch | 1008.5 / 108.6 | `sheet_template.dart:132-133` |
| Page margin X / Y | 420 / 500 | `sheet_template.dart:67-68` |
| Template page | 3151 × 4409 | `sheet_template.dart:71-72` |
| Standard OMR page | 1576 × 2205 | `sheet_layout.dart:105` |
| Page x/y scale | independent `page.width/3151`, `page.height/4409` | `sheet_layout.dart:44-45` |
| Choices per block | `min(spec.answerChoices, 4)` | `sheet_layout.dart:53,59` |
| Rows per answer block | 10 (fixed) | `sheet_template.dart:166` |
| `forSpec` geometry | always `tn40Standard`, orientation ignored | `sheet_layout.dart:24-32` |
| `totalQuestionsFor` | ministry = part counts sum; otherwise `spec.questionCount` | `sheet_layout.dart:94-101` |
| Corner target centres | `toPage(0,0)`, `toPage(2311,0)`, `toPage(2311,3409)`, `toPage(0,3409)` | `sheet_layout.dart:143-154` |
| Answer cell rect | centred, side = bubble diameter | `sheet_layout.dart:204-207` |
| Digit cell rect | centred, side = bubble diameter | `sheet_layout.dart:234-237` |

### 3.2 Page scaling and warp (`lib/data/cv/scan_service.dart`)

| Constant | Value | Source |
|---|---|---|
| Standard page | 1576 × 2205 (`omrPageSize`) | `scan_service.dart:19` |
| Page scale | `min(1, srcWidth / 1576)` | `scan_service.dart:293` |
| Target page size | rounded standard × pageScale | `scan_service.dart:294-298` |
| Round-trip tolerance | 6.0 px on the standard page, multiplied by pageScale | `scan_service.dart:89,422,484` |
| Rect scan expansion | 1.5× | `scan_service.dart:720,796` |
| Rect scan min fill | 0.04 | `scan_service.dart:793` |
| Marker size consistency | max side / min side ≤ 2.4 | `scan_service.dart:763` |
| Duplicate quad filter | ≤ 2 px at every corner | `scan_service.dart:874-881` |
| Overlay-quad min quality | 0.55 | `scan_service.dart:861` |
| Marker quality core | gray < 110 | `scan_service.dart:912` |
| Marker quality ring | gray > 190 | `scan_service.dart:914` |
| Marker quality radius | `r = clamp(markerSide×scale/2, 1, 12)`; ring to `1.9r` | `scan_service.dart:896-899` |
| Overlay-quad score | 0.5×core dark + 0.5×ring white | `scan_service.dart:923` |
| Mini warp for orientation probe | 320 × 450 | `scan_service.dart:607-624` |
| Warped PNG preview width | ~800 px | `scan_service.dart:1004-1039` |

### 3.3 Full-page detector (`lib/data/cv/sheet_alignment.dart`)

| Constant | Value | Source |
|---|---|---|
| Detector target width | 640 | `sheet_alignment.dart:200` |
| Minimum image | 120 × 120 | `sheet_alignment.dart:219,256` |
| Downsample factor | `max(1, floor(width/640))` | `sheet_alignment.dart:279` |
| Expected marker side | `87 / 3151 × downsampledWidth` | `sheet_alignment.dart:303` |
| Min component side | `max(5, 0.4 × expectedSide)` | `sheet_alignment.dart:304` |
| Max component side | `max(2 × minSide, 3 × expectedSide)` | `sheet_alignment.dart:305` |
| Local threshold window | half = `max(8, round(expectedSide))` | `sheet_alignment.dart:336` |
| Dark pixel rule | `gray < 0.8 × localMean` | `sheet_alignment.dart:353` |
| Component aspect | 0.7 .. 1.4 | `sheet_alignment.dart:433` |
| Component fill | ≥ 0.5 | `sheet_alignment.dart:436` |
| Quad shape ratio | ~0.8 .. 2.4 | `sheet_alignment.dart:516` |
| Homography pivot guard | 1e-9 | `sheet_alignment.dart:156` |
| Bilinear warp rounding | round to nearest source pixel | `sheet_alignment.dart:663,755` |

### 3.4 Shared dark-blob locator (`lib/data/cv/marker_blob_scan.dart`)

| Constant | Value | Source |
|---|---|---|
| Default min fill | 0.5 | `marker_blob_scan.dart:71` |
| Default aspect | 0.55 .. 1.8 | `marker_blob_scan.dart:72-73` |
| Min area (sampled cells) | 8 | `marker_blob_scan.dart:74` |
| Min region | 8 × 8 px | `marker_blob_scan.dart:80-84` |
| Sampling step | `max(1, min(w,h)/48)` | `marker_blob_scan.dart:87` |
| Page level | 75th percentile of samples | `marker_blob_scan.dart:89-107` |
| Dark threshold | `clamp(pageLevel×0.5, 30, 200)` | `marker_blob_scan.dart:108` |
| Candidate score | distance − 0.01 × area | `marker_blob_scan.dart:179` |

### 3.5 Live preview (`lib/presentation/screens/scan_screen.dart`, `lib/data/cv/preview_overlay.dart`)

| Constant | Value | Source |
|---|---|---|
| Preview analysis width | 640 | `scan_screen.dart:49` |
| Analysis interval | 80 ms | `scan_screen.dart:157` |
| Portrait lock | portraitUp | `scan_screen.dart:167-169` |
| Green streak to auto-capture | 2 ticks | `scan_screen.dart:344-348` |
| Live box expansion | 1.5× | `scan_screen.dart:435` |
| Live blob min fill | 0.6 | `scan_screen.dart:452` |
| Live blob aspect | 0.6 .. 1.65 | `scan_screen.dart:453-454` |
| Live blob min side | `max(4, 0.12 × shortRect)` | `scan_screen.dart:452-456` |
| Live blob max side | `0.95 × shortRect` | `scan_screen.dart:456` |
| Calibration space | 720 × 1560 | `preview_overlay.dart:192-193` |
| Calibration box | 157 × 203 | `preview_overlay.dart:194-195` |
| Inner rect | 0, 64, 719, 1177 | `preview_overlay.dart:196-199` |
| Landscape calibration | transpose: 1560×720, 203×157, inner 64,0,1177,719 | `preview_overlay.dart:204-213` |
| Box size inset | 0 | `preview_overlay.dart:230` |
| Centre shift | ±16 px horizontally | `preview_overlay.dart:237` |
| Cover scale | `max(screenW/frameW, screenH/frameH)` | `preview_overlay.dart:31-39` |

### 3.6 Coverage measurement (`lib/data/cv/omr_image_pipeline.dart`)

| Constant | Value | Source |
|---|---|---|
| Ink delta | 45 gray levels | `omr_image_pipeline.dart:16` |
| Inset ratio | 0.28 | `omr_image_pipeline.dart:17` |
| Border ratio | 0.08 | `omr_image_pipeline.dart:18` |
| Sample step | 1 px | `omr_image_pipeline.dart:19` |
| Min cell side | 4 px | `omr_image_pipeline.dart:209` |
| Border width | `max(1, round(min(cw,ch)×0.08))` | `omr_image_pipeline.dart:211` |
| Dark rule | `gray < background − 45` | `omr_image_pipeline.dart:237` |
| Inset core | 28% each side | `omr_image_pipeline.dart:240` |
| Density | dark / sampled total | `omr_image_pipeline.dart:247-257` |

### 3.7 Decoding and code rules (`lib/domain/services/omr_decoder.dart`)

| Constant / rule | Value | Source |
|---|---|---|
| Mark threshold | 0.30 | `omr_decoder.dart:36` |
| Letter alphabet | A..J | `omr_decoder.dart:41` |
| Answer question index | `blockIndex×10 + row` | `omr_decoder.dart:56` |
| Blank answer | best density < 0.30 | `omr_decoder.dart:89` |
| Digit confidence | best ≥ 0.30 **and** best ≥ 2× mean of other columns | `omr_decoder.dart:131-132` |
| Digit failure char | `?` | `omr_decoder.dart:133` |
| Multi-mark threshold | 0.55, at least 2 cells | `omr_decoder.dart:148,158-159` |
| Exam-code normalization | trim, uppercase; all-digit → strip leading zeros; empty all-zero → `0` | `omr_decoder.dart:169-177` |
| Blank code | contains no digit | `omr_decoder.dart:183` |
| Student-code normalization | trim, uppercase, remove whitespace, keep leading zeros | `omr_decoder.dart:190-194` |
| Student-code comparison | strip leading zeros | `omr_decoder.dart:198-212` |

### 3.8 Grading and flow (`lib/domain/services/grader.dart`, `scoring_rule.dart`, `lib/data/cv/scan_flow.dart`)

| Constant / rule | Value | Source |
|---|---|---|
| Uniform question weight | `maxScore / questionCount` | `scoring_rule.dart:8-16` |
| Ministry weighted rule | part weights split by part counts; else uniform | `scoring_rule.dart:36-69` |
| Flag null conditions | missing key char, non-letter key char, blank chosen | `grader.dart:66-84` |
| Part scores | ministry only, all 3 counts present, each rounded | `grader.dart:90-114` |
| Rounding | `(v×100).roundToDouble()/100` | `grader.dart:117` |
| Key selection | normalized exact exam code; empty/`?` rejected | `grader.dart:120-127` |
| Best-guess key | highest correct count; first wins ties | `grader.dart:132-151` |
| Total questions for grading | `contest.sheetSpec.questionCount` (not layout total) | `scan_flow.dart:103` |
| Common key | first key with empty trimmed exam code | `scan_flow.dart:109` |
| In-class blank code without common key | ungraded, score 0, reason examCode | `scan_flow.dart:114-138` |
| Direct key | matched key, else common key for blank code | `scan_flow.dart:140-141` |
| Fallback key | best-scoring key | `scan_flow.dart:142` |
| Guessed-key warning | in-class + no direct key + not common + code empty/`?` | `scan_flow.dart:146-151` |
| App overlay min quality | 0.55 | `scan_flow.dart:319` |
| App warp verification | best effort (`requireVerifiedWarp: false`) | `scan_flow.dart:249` |
| Pre-decode max width | 2000 px | `scan_flow.dart:395` |
| Stats pass threshold (UI) | 5 (score10) | `stats_tab.dart:33` |

---

## 4. Data model and storage

### 4.1 Entities (`lib/domain/entities`)

- **ClassRoom**: `id`, `name`, `description?`.
- **Student**: `id`, `classId`, `code`, `fullName`.
- **Contest**: `id`, `name`, `examDate`, `classRoomId?`, `questionCount` (40), `answerChoices` (4), `maxScore` (10), `formType` (standard/fifty/hundred20/ministry), `orientation` (portrait/landscape), `partOneCount?`, `partTwoCount?`, `partThreeCount?`, `partOneWeight?`, `partTwoWeight?`, `partThreeWeight?`; `sheetSpec` getter.
- **AnswerKey**: `id`, `contestId`, `examCode`, `answerSequence`, `createdAt?`. Empty `examCode` = common key. Unique `(contestId, examCode)`.
- **GradedSheet**: `id`, `contestId`, `examCode`, `studentCode`, `chosen`, `correctFlags`, `score`, `keyId?`, `studentId?`, `partScores`, `originalImagePath?`, `markedImagePath?`, `infoImagePath?`, `gradedAt`.

### 4.2 SQLite schema (`lib/data/db/schema.dart`)

Drift, schema version 1; DB file `ApplicationSupport/gradevn.sqlite`.

| Table | Columns | Constraints |
|---|---|---|
| `class_rooms` | id PK autoincrement, name text, description text nullable | — |
| `students` | id PK, classId → class_rooms.id, code text, fullName text | FK |
| `contests` | id PK, name, examDate, classId nullable FK, questionCount default 40, answerChoices default 4, maxScore default 10.0, formType int default 0, orientation int default 0, partOneCount/Two/Three nullable, partOneWeight/Two/Three nullable | FK |
| `answer_keys` | id PK, contestId FK, examCode, answerSequence, createdAt default now | unique (contestId, examCode) |
| `graded_sheets` | id PK, contestId FK, keyId nullable FK, studentId nullable FK, examCode, studentCode default '', chosen text, correctFlags text, score real, partOneScore/Two/Three nullable, originalImagePath?, markedImagePath?, infoImagePath?, gradedAt default now | FKs |
| `app_settings` | id PK, key, value | unique key |

Serialized formats:
- `chosen`: letters per question; `' '` or `'-'` = blank.
- `correctFlags`: `'1'` correct, `'0'` wrong, `'?'` no comparison (missing key/answer).
- Scores are real; part scores only for ministry.
- `studentId` may be null even for in-class sheets (SBD missing/unmatched).
- `infoImagePath` is never written by the current flows; the OCR info reader is a no-op.

### 4.3 Files on disk

- Images: `Documents/sheets/contest_<id>/orig_<epochMs>.png` and `marked_<epochMs>.png`.
- `orig` = warped page encoded once; `marked` = rendered with result overlays (standard page layout).
- Sheet deletion removes both images before deleting the DB row (`sheet_cleanup.dart`).
- No other persistent files. XLSX exports go to `Documents/results_<sanitized name>.xlsx` or user-selected paths.

### 4.4 XLSX formats (`lib/data/import_export/xlsx_service.dart`)

**Answer-key import** (`readKeys`, first sheet):
- column A = exam code; columns B.. = answers (one per cell), else a single cell split on whitespace/comma/semicolon and uppercased;
- skips header rows containing `mã`, `code`, `stt`;
- skips empty rows; duplicate `(contest, code)` handled by DB uniqueness.

**Student import** (`readStudents`, first sheet):
- column A = student code; column B = full name;
- skips headers containing `mã`, `sbd`, `code`, `stt`.

**Results export** (`writeResults`, sheet `Results`):
- A1 = `Exam: <name>`;
- row 2 headers: `No.`, `Student ID`, `Exam code`, `Full name`, `Score`, `Part I`, `Part II`, `Part III`;
- data from row 3; missing part scores written as 0;
- the contest-detail export does **not** supply student names (column stays empty).

**Key export** (`writeKeys`, sheet `Exam code`):
- headers `Exam code`, `Answer sequence`; answers joined with spaces.

**Stats export** (`stats_export.dart`): 4 sheets — `Overview`, `Exams`, `Questions`, `Attention` — with Vietnamese labels for attention kinds (incorrect student ID, ungraded, missing submission), percentages rounded, dates ISO, one-decimal numbers.

### 4.5 Statistics definitions (`lib/domain/services/stats.dart`)

- A sheet is "graded" iff `keyId != null`; otherwise "ungraded" (including sheets saved with no key).
- Points are normalized to a 10-point scale: `score / contest.maxScore × 10`, clamped 0..10.
- Histogram: 10 buckets `[0,1) … [9,10]`, using `floor().clamp(0,9)`.
- Per exam: count, graded count, mean/median/min/max (10-scale), pass count at threshold, 10-bucket histogram, per-question correct rate, up to 8 hardest questions.
- Attention groups (always 3, max 3 samples each):
  - in-class sheets whose `studentId` is null;
  - sheets with `keyId == null`;
  - roster students with no matching sheet (by `studentId` or normalized SBD).
- Expected slots = sum of rosters of classes that have exams in scope; completed = students with at least one matched sheet.
- Trend = exams with a non-null average, chronological.

---

## 5. Flutter dependencies and web replacements

### 5.1 UI stack decision: Svelte 5 (not React)

- Both satisfy the brief. Svelte 5 is chosen because it compiles components to small imperative DOM code and has a much smaller runtime baseline; with React you pay for `react` + `react-dom` (~45 KB gzip) before any app code, which matters against the "first screen < 2 s on 4G" and Lighthouse ≥90 target.
- Svelte 5 runes (`$state`, `$derived`, `$effect`) cover the reactive state that Riverpod provides; no extra state library is needed.
- The app is small and screen-oriented, so Svelte's lower abstraction overhead and smaller dependency surface are a better fit than React's ecosystem, which we do not need.
- A ~100-line history-API router is enough; no routing library.

### 5.2 Package mapping

| Flutter package / API | Use in GradeVN | Web replacement |
|---|---|---|
| `flutter_riverpod` | state/providers | Svelte 5 runes + small module stores |
| `drift` + SQLite | persistence | IndexedDB via `idb`; repositories mirror the Dart contracts |
| `path_provider` + `dart:io` files | sheet images, XLSX files | IndexedDB `Blob` records for images; downloads for XLSX |
| `camera` (YUV420 stream) | live scanning | `getUserMedia({video:{facingMode:{ideal:'environment'}, width:{ideal:1920}, height:{ideal:1080}}})`; `<video playsinline muted autoplay>`; draw frames to canvas |
| `image` package | decode/encode, PNG | `createImageBitmap(blob, {imageOrientation:'from-image'})`; canvas `ImageData`; `OffscreenCanvas.convertToBlob` for PNG |
| Skia pre-decode / EXIF unbake | orientation-correct RGBA | browser decodes with EXIF applied; canvas gives display-oriented pixels; keep the 0/180/±90 quad variants for safety |
| `dart:isolate` + `Isolate.run` | off-main-thread grading | Web Worker (module worker); transfer `ImageData`/`ArrayBuffer`; OffscreenCanvas when available, main-thread decode fallback |
| `file_picker` | image/keys/students | `<input type="file">`; keys/students via `File.text()`; images via `createImageBitmap` |
| `syncfusion_flutter_xlsio` + `excel_plus` | XLSX read/write | SheetJS `xlsx` (community build); preserve the exact sheet names/headers above |
| `pdf` + `printing` | present in pubspec, no active flow found | omit in v1; add lazily only if a PDF feature is requested |
| `path` | file paths | string joins / not needed with Blob storage |
| `flutter/services` (orientation, system UI) | portrait lock, status bar | CSS `orientation` manifest, fullscreen/safe-area handling |
| `WidgetsBindingObserver` / lifecycle | camera pause/resume | `visibilitychange`, `pagehide/pageshow`, `freeze/resume` events |
| vibration / haptics | feedback | **not** `navigator.vibrate` on iOS; WebAudio click + visual green/auto-capture feedback |
| share | none in current flows | `navigator.share({files})` with anchor download fallback (XLSX) |

### 5.3 Image processing: pure TypeScript, no OpenCV.js

The pipeline is small and fully specified: local-mean threshold + 4-neighbour BFS, homography solve, bilinear resampling, local border statistics. All are straightforward typed-array code. OpenCV.js would add ~8–10 MB of WASM (slow first load, Safari memory pressure, extra cache complexity) for no algorithmic benefit. Plan:

- `src/core/` — pure TS, no DOM: geometry, homography, warp, density, decoder, grader, key selection, stats.
- `src/workers/` — worker entry: receives RGBA + dimensions + spec + optional rects; returns chosen answers, digits, score, densities, timings, and intermediate preview images for debug mode.
- Decode via `createImageBitmap` in the worker when supported; otherwise decode on the main thread and transfer `ImageData`.
- OffscreenCanvas for the marked-sheet render in the worker when available; fallback to a main-thread canvas.
- All thresholds remain ratios/constants equal to the Dart values, independent of camera resolution; source width only affects `pageScale` exactly as in Flutter.

### 5.4 Proposed module mapping

| Dart source | TS module |
|---|---|
| `domain/services/sheet_template.dart`, `sheet_layout.dart` | `src/core/sheetTemplate.ts`, `src/core/sheetLayout.ts` |
| `data/cv/sheet_alignment.dart` | `src/core/markerDetector.ts` (threshold, components, quad) |
| `data/cv/marker_blob_scan.dart` | `src/core/blobLocate.ts` |
| `data/cv/scan_service.dart` | `src/core/scanPhoto.ts` (quad ladder, warp, verify) |
| `data/cv/omr_image_pipeline.dart` | `src/core/density.ts` |
| `domain/services/omr_decoder.dart` | `src/core/omrDecoder.ts` |
| `domain/services/grader.dart`, `scoring_rule.dart` | `src/core/grader.ts`, `src/core/scoringRule.ts` |
| `data/cv/scan_flow.dart` | `src/core/gradeScan.ts` (pure), `src/workers/processPhoto.ts` |
| `domain/services/stats.dart` | `src/core/stats.ts` |
| `data/import_export/*` | `src/core/xlsx.ts` (SheetJS) |
| `data/cv/preview_overlay.dart` | `src/camera/overlay.ts` |
| `presentation/screens/*` | `src/ui/screens/*` |

---

## 6. Parity risks and how they will be measured

1. **Channel choice matters.** The app's warp/detector/density path uses channel 0 (red), while the live rect blob locator uses 299/587/114 luminance. The TS port must use the same channel per stage; using luminance everywhere can shift borderline densities by several points.
2. **JPEG/PNG decode differences.** Skia vs Safari decoders may differ by ±1–2 gray levels due to color management/chroma upsampling. Mitigation: exact fixtures use PNG (no JPEG loss); photo fixtures are graded with tolerance and an explicit density delta report. Densities near 0.30/0.55 are the fragile cases.
3. **Homography/bilinear rounding.** Port the same equations, sample indices, and rounding; compare per-cell densities and chosen answers, not just final scores. A one-pixel sampling shift on an 80-unit bubble is usually <1% density but can flip borderline bubbles.
4. **Warp target size.** `round(1576×pageScale)` and independent x/y scales must match; do not force a fixed 1576×2205 target for lower-resolution video.
5. **Camera frame geometry.** In Flutter the preview is a cover-scaled camera image with four fixed boxes; Safari's video element may crop/letterbox differently. The overlay must be laid out in the same video-pixel coordinate system and converted with the same cover math; test with camera-test page in step 2.
6. **Orientation.** Flutter rotates YUV planes and unbakes EXIF; browser `drawImage(video)` already gives display-oriented frames, and `createImageBitmap(..., from-image)` handles photos. The quad orientation variants (identity/180/CW/CCW) still need to be ported and exercised.
7. **`requireVerifiedWarp: false`.** The app grades a failed round-trip warp best-effort. If the web port returns null here, it will reject sheets the Android app accepts. Keep the same ladder.
8. **Trusted rect quad.** If the four rect blobs pass fill/size checks, the app skips round-trip verification. Do not add verification in the web port; it would reject the same sheets as the Flutter bug fixed in R17.
9. **Detector sampling.** The 640-wide downsample takes every `f`-th pixel (`grayAt(dx*f, dy*f)`), not an average. Reproduce this; averaging changes components and thresholds.
10. **No key / best-guess behavior.** Outside-class exams silently use the best-scoring key; in-class only warns. This is intentional product behavior, not a bug; preserve it unless the user decides otherwise.
11. **Stats and export semantics** depend on `keyId`, `maxScore`, and 10-point normalization; keep exactly (including the deleted-key edge case in §7).
12. **Performance.** Flutter measured warp as the dominant cost and scaled the target page to the source. In JS, the equivalent win is doing warp + density on typed arrays in a worker, not on canvases. Measure stage timings in debug mode on a real iPhone; target comparable or faster than the Android release.

---

## 7. Defects / limitations found (report only — no fixes without approval)

These were verified in the Flutter source. They affect what "matching the Flutter app" means.

1. **Only one sheet geometry exists.** `SheetLayout.forSpec` always uses `tn40Standard`; form types 50/120/ministry and landscape orientation have no own coordinates (`sheet_layout.dart:24-32`). Selecting them produces a 40-question TN40 layout.
2. **Question count above 40 is not supported geometrically.** `SheetLayout` still has 4×10 rows; `answerCellRect` throws `RangeError` outside the blocks; decoded answers beyond 40 stay null. `gradeScan` uses `spec.questionCount`, which can disagree with the layout's 40 rows.
3. **Answer choice E cannot be graded.** The key editor offers A–E, but the template has only 4 columns and `SheetLayout` clamps to `min(answerChoices, 4)`. An E key can never match.
4. **Ministry totals can disagree.** Grading question count = `sheetSpec.questionCount`, while the sheet layout/count helper uses the sum of the three parts. For ministry contests the two values can differ.
5. **Marked-sheet renderer highlights only the first choice column.** `renderMarkedSheet` tints correct/wrong on column 0 only; digit `'?'` tints every value cell orange. This is a display bug, not a grading bug.
6. **Results XLSX never contains full names.** The contest-detail export constructs `ResultRow` without `studentName`, so the `Full name` column is blank.
7. **Student-info OCR is stubbed** (`studentInfoOcr` no-op) and `infoImagePath` is never written.
8. **Settings screen is a placeholder.**
9. **Crop-review path is unreachable**; failed scans can only be retaken.
10. **No JSON/full backup** in Flutter; only keys/students/results/stats XLSX. Images are app-local and not exportable.
11. **Stats treats `keyId == null` as ungraded.** Deleting a key does not clear `keyId` on old sheets, so those sheets still count as graded even though no key remains for regrading. The reverse (saved with score 0 and no key) counts as ungraded.
12. **Exam-code leading zeros are lost in matching.** `normalizeCode('007') == '7'`, so codes `007` and `7` collide. Student codes preserve leading zeros, so this asymmetry is intentional-looking but worth confirming.
13. **Guessed key outside class is silent.** The best-scoring key fallback is used without a warning for outside-class contests.
14. **Multi-mark does not block.** The decoder still picks the highest-density bubble; the warning is informational only.
15. **`SheetProjection` is unused dead code.**
16. **Flutter UI is English**, while the web brief requires Vietnamese. Strings such as key-editor titles are already localized; others are hard-coded English.

---

## 8. Questions to resolve before code

1. **Data migration.** Flutter has no JSON backup. Options:
   - (a) add a read-only JSON+images export to the Flutter app(s) — this **modifies** the protected original, so it needs explicit permission;
   - (b) start the web app empty;
   - (c) build a one-time web migration tool that reads a copy of the SQLite DB + image folder selected by the user.
   Recommendation: (c) for existing data plus native JSON export/import in the web app; (a) only if you authorize touching the Flutter project.
2. **Language.** Vietnamese-only UI (brief), or Vietnamese + English toggle? The Flutter app is English today.
3. **Unsupported form types.** Keep the 50/120/ministry/landscape options (same shared geometry, same limitations) or hide them until real templates exist?
4. **Known bugs.** For each item in §7, replicate exactly for parity or fix in the web version? My recommendation: keep grading identical, fix only pure presentation/export bugs (5, 6, 8, 9) and the E-choice/key-editor inconsistency (3) after your approval.
5. **Stats/scoreboard scope in v1.** Include the full Stats tab + scoreboard, or ship grading/results first?
6. **Images in backup.** Include original/marked PNGs in JSON export (large, slow) or export metadata only with an optional "include images" toggle?
7. **Theme.** The current app is dark neon only. The brief says "support system dark mode". Should the web app follow system light/dark (with neon accents), or stay dark-only for brand consistency?
8. **Exam without code / common key** is a real Flutter feature. Confirm the web app should keep it (I assume yes).
9. **Real test device and deploy access.** Which iPhone model/iOS version, and do you have GitHub + Vercel accounts ready for the trial deploy?
10. **HEIC.** iPhones may hand the file input a HEIC image. Safari decodes HEIC in `createImageBitmap` on iOS, but not all desktop browsers do. Should the fallback convert/reject HEIC with a clear message, or do you need a WASM decoder (extra bundle)?

---

## 9. Fixture and test plan (for step 3, after approval)

- Reuse `gradevn/test/fixtures/generated/standard40.png`, `noisy40.png` and the expected JSON from the Flutter tests as the first exact-parity cases.
- Add fixtures from real phone photos (the 10A1 sheets mentioned in project memory) with expected `chosen`, `correctFlags`, `score`, `studentCode`, `examCode`, key id.
- Unit tests: template/layout coordinates, decoder thresholds (including tie and 2× digit rule), normalization, key selection, scoring (uniform + ministry), stats.
- Pipeline tests: rect scan, full detector, warp verification ladder, densities per cell with tolerances, final decoded answers.
- Report a parity table: Flutter vs web for every fixture (answers, digits, score, density max delta). Fail on any answer mismatch; document density deltas.
- Debug fixtures: thresholded preview, detected quad overlays, warped page, per-cell density heatmap for the `?debug=1` panel.

---

## 10. Proposed steps after confirmation

1. Skeleton: Vite + Svelte 5 + TS strict, PWA manifest/service worker, `vercel.json`, camera-test page (resolution/permission/orientation report), deploy a blank installable build.
2. Port `src/core/` in this order: template/layout → decoder/grader/scoring → density → blob locate/detector → homography/warp → scanPhoto ladder → gradeScan. Vitest green against fixtures before any UI.
3. Worker pipeline + debug panel + live camera overlay; test on the real iPhone; compare stage timings and grades.
4. Screens, IndexedDB repositories, image storage, XLSX import/export, JSON backup.
5. Stats/scoreboard, Vietnamese copy, offline/update UX, Lighthouse, README/deploy guide.

No project code beyond this document will be written until you confirm the spec and answer the questions above.
