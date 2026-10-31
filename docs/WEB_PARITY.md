# GradeVN Web — Parity with the Flutter app

Mục tiêu: thuật toán chấm của bản web cho cùng kết quả với bản Flutter trên cùng
một ảnh phiếu. Tài liệu này ghi lại phần **đã đo được**, phần **khác có chủ đích**
và phần **chưa thể kiểm chứng** (chưa có iPhone thật trong môi trường phát triển).

Nguồn Dart tham chiếu: `C:\Marker-td\lib\data\cv`, `lib\domain\services`.
Bản gốc Flutter không bị sửa; bản sao lưu: `C:\Marker-td-backup-20261030`.

## 1. Kết quả đo trên fixture

Fixture PNG do phía Flutter sinh và giá trị kỳ vọng lấy từ test Dart
(`test/omr_pipeline_test.dart`, `test/fixtures/fixture_builder.dart`).
Bản TS đọc PNG bằng `sharp`, chạy đúng các tầng đã port và so từng trường.

| Fixture | SBD | Mã đề | Đáp án | Điểm | Flutter | Web |
| --- | --- | --- | --- | --- | --- | --- |
| `standard40.png` | `000413` | `001` | 40 câu, trống câu 6 và 18 | 9.25 | 37 đúng | Khớp tuyệt đối |
| `noisy40.png` | `000042` | `007` | 40 câu, không trống | 9.75 | 39 đúng | Khớp tuyệt đối |

Các test liên quan (`npm test`, tổng 81 test / 12 file):

- `tests/core/fixturePipeline.test.ts` — SBD, mã đề, toàn bộ dãy đáp án, `score`,
  `correctCount`, `partScores`; kiểm tra thêm kênh 0 cho cùng kết quả với luma.
- `tests/core/scanFlow.test.ts` — chọn khoá theo mã đề, khoá chung `''`,
  fallback "khoá đoán tốt nhất", SBD sai/trống, multi-mark, không có khoá.
- `tests/core/scanService.test.ts` — ba đường vào pipeline (`knownQuad`,
  detector đầy đủ, bốn ô ghim `overlayRects`) đều ra đúng dãy đáp án fixture.
- `tests/core/alignment.test.ts` — warp/homography và quad.
- `tests/camera/overlayGeometry.test.ts` — 11 test cover/letterbox.
- `tests/camera/liveMarkerScan.test.ts` — 9 test quét mốc từng ô: đủ 4 tâm,
  lệch khỏi ô gốc, mốc nhỏ/dẹt, ngưỡng tương phản p75×0.5, chuỗi toạ độ
  màn hình → khung dọc/ngang.
- `tests/camera/pinnedOverlayFallback.test.ts` — 4 test quad ghim lúc chụp:
  chỉ ngưỡng 0.5 tái hiện detector bắt vật tối ngoài giấy; mặc định quét lại
  p75×0.8 cho quad khớp 4 mốc; mốc đậm giữ 0.5; `resolveOverlayRects` chỉ trả
  quad ở 0.8 khi bật dự phòng.
- `tests/workers/gradeDiagnostics.test.ts` — 1 test worker trả
  `pinnedThresholdFactor` và quad ghim qua `GradeSuccessResponse`.
- `tests/camera/vote.test.ts` — 5 test bỏ phiếu đa khung.
- `tests/storage/stats.test.ts`, `tests/storage/xlsx.test.ts` — thống kê và cấu
  trúc workbook.

Sai lệch điểm ảnh đo được trên hai fixture: **0** (kết quả cuối trùng hoàn toàn).
Không có sai lệch density nào làm đổi đáp án trên fixture.

## 2. Khác biệt có chủ đích so với Flutter

1. **Quét mốc live và tự chụp.** Web port đúng `rectReads` trong
   `_analyzeMarkerFrame` của APK: mỗi nhịp 80 ms (`PROBE_INTERVAL_MS = 80`)
   lấy khung preview thu về rộng 640 px (`PROBE_MAX_WIDTH`), mỗi ô mở rộng
   1.5× rồi tìm blob tối bằng đúng tham số live của APK — `minFill 0.6`,
   aspect 0.6..1.65, `minSidePx = max(4, 0.12×cạnh ngắn ô)`,
   `maxSidePx = 0.95×cạnh ngắn ô`, ngưỡng đen = phân vị 75 của cửa sổ × 0.5
   kẹp 30..200 (`src/core/markerBlobScan.ts`). Ô chỉ xanh khi tâm blob nằm
   trong ô gốc; nhịp live không dùng detector toàn trang, giống APK (R11).
   Cả 4 ô xanh 2 nhịp liên tiếp (`AUTO_CAPTURE_STREAK = 2`) thì tự chụp —
   luôn bật, không có nút riêng; sau đó phải có nhịp rời 4/4 mới bật lại
   (`autoArmed` như APK), tránh vòng chụp lặp. Ô trượt ngưỡng chuẩn
   `p75×0.5` được quét lại một lần ở `p75×0.8` (giữ nguyên mọi luật blob)
   để nhận mốc xám in trên màn hình; kết quả ghi `usedFallback` /
   `strictReason` trong chẩn đoán. Khi chụp, 4 ô ghim cũng quét chuẩn
   `p75×0.5` trước; nếu **cả nhóm** không ra quad thì quét lại cả nhóm ở
   `p75×0.8` trước khi rơi xuống detector toàn trang — cùng lý do tương phản,
   và là đường sửa lỗi “detector bắt vật tối ngoài giấy làm 2 góc dưới”
   (`allowPinnedFallback`, mặc định bật; `pinnedThresholdFactor` ghi trong
   chẩn đoán và dòng kết quả). APK không có bước quét lại này (Dart cố định
   0.5), xem mục 12 của `IOS_LIVE_DETECTION.md`.
   Vẽ ô cũng theo APK: ô vuông trắng mờ 0.32 (0.55 khi đọc được), viền xanh
   `#2E7D32` dày 3, không số/không chấm (`src/camera/render.ts`).
   Khi chụp, web vẫn lấy 3 khung (`CAPTURE_FRAMES = 3`) rồi bỏ phiếu chữ ký
   (SBD + mã đề + đáp án) xuất hiện nhiều nhất; hoà thì ưu tiên khung qua
   kiểm chứng mốc, sau đó khung sớm nhất (`src/camera/vote.ts`). Đây vẫn là
   khác biệt có chủ đích so với APK (một ảnh): chỉ ảnh hưởng phiếu sát ngưỡng
   khi các khung không đồng thuận, không đổi toán chấm. Đường chọn ảnh/tải
   lên chỉ có một khung như APK.
2. **Định hướng khung hình.** Trình duyệt vẽ `video` theo hướng hiển thị. Các
   hàm `resolveOverlayQuad`/`resolveOverlayRects` thử cặp biến đổi identity/180°
   khi trục ảnh và khung cùng hướng, hoặc biến đổi 90° khi khác hướng
   (`src/core/scanService.ts`). Việc xoay điện thoại được xử lý ở overlay; chưa
   đo trên iPhone thật.
3. **Giải mã ảnh và EXIF.** Web ưu tiên
   `createImageBitmap(file, { imageOrientation: 'from-image' })`, lùi về
   `createImageBitmap(file)` rồi `<img>`; cả ba đường đều để trình duyệt áp EXIF
   khi vẽ canvas (`src/camera/imageInput.ts`). Flutter tự xoay YUV và bỏ EXIF.
   PNG fixture khớp tuyệt đối; ảnh JPEG từ iPhone có thể lệch ±1–2 mức xám do
   quản lý màu/chroma upsampling giữa Skia và Safari — **chưa đo** vì chưa có
   ảnh thật từ thiết bị.
4. **HEIC.** Safari iOS có thể giải mã HEIC qua `createImageBitmap`/`<img>`;
   nếu không, web báo lỗi rõ ràng và hướng dẫn chụp bằng camera hoặc chọn
   JPEG/PNG. Không nhúng bộ giải mã HEIC WASM (tăng bundle), đây là khác biệt
   so với ảnh JPEG/PNG thuần.
5. **Hiển thị phiếu đã chấm.** Ảnh "marked" được vẽ lại bằng Canvas
   (`src/camera/render.ts`) thay vì painter của Flutter. Đây là ảnh trực quan,
   không tham gia tính điểm; bố cục có thể không giống từng pixel.
6. **Lưu trữ và dữ liệu.** Flutter dùng SQLite + thư mục ảnh; web dùng
   IndexedDB (cùng tên store/trường để dễ đối chiếu) và có thêm backup JSON
   (tuỳ chọn kèm ảnh base64) — Flutter không có. Khôi phục web **thay thế toàn
   bộ** dữ liệu hiện tại.
7. **Chế độ đề thử.** `src/camera/practice.ts` là tiện ích web-only: nhập tay
   mã đề + 40 đáp án và lưu localStorage để thử camera, không ghi vào kỳ thi.
   Không ảnh hưởng dữ liệu hay kết quả chấm thật.
8. **Ngôn ngữ.** UI web là tiếng Việt; Flutter hiện tại là tiếng Anh.
9. **Cập nhật ứng dụng.** Web có toast "có bản mới" (Workbox prompt) và nút
   cập nhật; Flutter cập nhật qua APK/TestFlight. Không ảnh hưởng logic chấm.
10. **Bố cục chạm (touch target).** Web chuẩn hoá mọi phần tử tương tác tối
    thiểu **44×44 px** theo HIG: bàn phím số SBD/mã đề đổi từ 4 cột sang 5 cột
    để mỗi phím đủ 44 px ngang, các liên kết chữ trong Hướng dẫn được nới vùng
    chạm bằng `min-height` + margin âm (không đổi vị trí thị giác), nút nhỏ
    `.icon-button.small` 38→44, ô đáp án 40→44. Đây là khác biệt trình bày so
    với Flutter, không liên quan tới toạ độ hay thuật toán chấm.
    Đã audit bằng CDP với dữ liệu mẫu ở 390×844 và 375×667: 11 màn hình + 2
    bottom sheet, 0 phần tử < 44×44, 0 tràn ngang, 0 exception JS (Chromium).

## 3. Giới hạn kế thừa nguyên từ Flutter (không tự sửa)

Các điểm dưới đây đã tồn tại trong bản Flutter và được giữ để đảm bảo parity.
Muốn sửa cần quyết định của chủ dự án vì sẽ làm web khác Android.

1. Chỉ có một hình học phiếu TN40; form 50/120/ministry và landscape vẫn dùng
   layout 40 câu.
2. Câu hỏi > 40 không có toạ độ; đáp án vượt 40 bị bỏ.
3. Lựa chọn E không chấm được (template chỉ có 4 cột A–D) dù key editor cho A–E.
4. Ministry có thể lệch số câu giữa phần chấm và phần layout.
5. OCR thông tin học sinh vẫn là stub; khớp học sinh chỉ dựa vào SBD.
6. Xoá bộ đáp án không xoá `keyId` trên phiếu cũ; Stats vẫn coi là "đã chấm".
7. Mã đề `007` và `7` được chuẩn hoá thành cùng một khoá (SBD thì giữ số 0 đầu).
8. Khoá đoán tốt nhất ngoài lớp không cảnh báo; multi-mark chỉ cảnh báo, vẫn
   chọn ô đậm nhất.
9. Crop-review không có; quét lỗi chỉ chụp lại.
10. Ngưỡng tương phản live giống APK nên cùng một giới hạn: ngưỡng đen là
    phân vị 75 của cửa sổ × 0.5 kẹp 30..200. Đo trên ảnh người dùng gửi
    (`web_01.jpg`, phiếu hiển thị trên màn hình laptop): mốc xám trung bình
    133–147, nền trang 185–210 → ngưỡng ~93–105, mốc không xuống dưới ngưỡng
    nên cả 4 ô báo 0/4 dù mắt thấy mốc nằm trong ô. APK cũng báo 0/4 trên cùng
    ảnh đó; in giấy đen thật thì qua. Web **không hạ ngưỡng mặc định**; thay
    vào đó ô trượt được quét lại một lần ở `p75×0.8` (live) và cả nhóm 4 ô
    ghim được quét lại ở `p75×0.8` khi chụp, có ghi chẩn đoán. Đây là khác
    biệt có chủ đích so với APK, không sửa Dart; chi tiết ở mục 11–12 của
    `IOS_LIVE_DETECTION.md`.

## 4. Chưa kiểm chứng được trong môi trường này

- Chưa chạy trên iPhone thật (chưa có thiết bị kết nối): độ phân giải camera
  thực, EXIF ảnh thật, HEIC, wake lock, xoay máy, background/foreground.
  Hành vi từ chối quyền camera, ẩn/foreground (stream dừng rồi mở lại) và xoay
  ngang đã được kiểm tra trong Chromium headless với camera giả 1920×1080,
  0 exception JS — nhưng chưa phải Safari iOS.
- Ma trận live camera (Chromium headless, camera giả Y4M 30 fps, ảnh dọc
  1080×1920 / ngang 1920×1080, mốc đen dựng đúng tâm 4 ô sau cover mapping,
  điện thoại 428×926 / 926×428):
  - mốc 70 px (dọc), 120 px (gần), 30 px (xa), 100 px (ngang): cả 4 ô xanh,
    trạng thái "Đủ 4 mốc — giữ yên"; cảnh dọc 70 px có 20.342 pixel xanh trên
    overlay.
  - mốc 190 px (quá gần, vượt `maxSidePx`), 16 px (quá xa, dưới `minSidePx`),
    lệch ngang 0.67 chiều rộng ô (tâm blob ngoài ô gốc): 0/4, không viền
    xanh — không có xanh giả.
  - mốc xám 146 trên nền 210: theo ngưỡng APK là 0/4; nay ô trượt tự quét
    lại `p75×0.8` nên xanh, kèm `usedFallback: true` (xem mục 11 của
    `IOS_LIVE_DETECTION.md`).
  - ảnh giả toàn trang 210 với 4 mốc xám 140 đúng tâm ô (16% cạnh ô), khung
    ngang 638×570: live 4/4 nhờ quét lại 0.8, tự chụp 3/3 khung; dòng kết quả
    ghi “quét trong 4 ô ghim · ô ghim quét lại p75×0.8”, và round-trip có thể
    thay bằng detector quad đạt kiểm chứng (0.5 px). Xem mục 12.5 của
    `IOS_LIVE_DETECTION.md`.
  - tự chụp (4 mốc 70 px, không cần nút): vào màn kết quả "3/3 khung · đồng
    thuận 100%", 0 đúng / 0 sai / 40 trống (khung dựng chỉ có mốc); bấm "Chụp
    phiếu khác" về live "Giữ yên — sẵn sàng chụp", không tự chụp lặp.
  - tải `standard40.png` qua input file trong trình duyệt: 9.25,
    37 đúng / 1 sai / 2 trống — khớp fixture.
- Chưa deploy Vercel thật (không có tài khoản/credentials trong phiên làm việc).
- Lighthouse và test offline chạy trên Chrome headless với mobile emulation,
  không phải Safari iOS. Service worker và precache đã được kiểm tra offline
  bằng CDP (xem README), nhưng hành vi iOS có thể khác ở giới hạn bộ nhớ cache.

Khi có thiết bị, quy trình đo đề xuất: mở `#/camera-test`, ghi lại
`width×height@fps`, chụp cùng một phiếu bằng GradeVN Android và web, so SBD,
mã đề, 40 đáp án, điểm; lưu ảnh gốc để đo density nếu có sai lệch.
