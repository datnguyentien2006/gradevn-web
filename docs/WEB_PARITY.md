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

Các test liên quan (`npm test`, tổng 47 test):

- `tests/core/fixturePipeline.test.ts` — SBD, mã đề, toàn bộ dãy đáp án, `score`,
  `correctCount`, `partScores`; kiểm tra thêm kênh 0 cho cùng kết quả với luma.
- `tests/core/scanFlow.test.ts` — chọn khoá theo mã đề, khoá chung `''`,
  fallback "khoá đoán tốt nhất", SBD sai/trống, multi-mark, không có khoá.
- `tests/core/scanService.test.ts` — ba đường vào pipeline (`knownQuad`,
  detector đầy đủ, bốn ô ghim `overlayRects`) đều ra đúng dãy đáp án fixture.
- `tests/core/alignment.test.ts` — warp/homography và quad.
- `tests/camera/overlayGeometry.test.ts` — 11 test cover/letterbox.
- `tests/camera/vote.test.ts` — 5 test bỏ phiếu đa khung.
- `tests/storage/stats.test.ts`, `tests/storage/xlsx.test.ts` — thống kê và cấu
  trúc workbook.

Sai lệch điểm ảnh đo được trên hai fixture: **0** (kết quả cuối trùng hoàn toàn).
Không có sai lệch density nào làm đổi đáp án trên fixture.

## 2. Khác biệt có chủ đích so với Flutter

1. **Bắt khung hình và bỏ phiếu (live camera).** Flutter chấm một ảnh mỗi lần.
   Web chờ 4 mốc ổn định 3 tick (`STABLE_TICKS = 3`), chụp 3 khung
   (`CAPTURE_FRAMES = 3`), chấm từng khung rồi chọn chữ ký (SBD + mã đề + đáp án)
   xuất hiện nhiều nhất; hoà thì ưu tiên khung qua kiểm chứng mốc, sau đó khung
   sớm nhất (`src/camera/vote.ts`). Đường chọn ảnh/tải ảnh lên chỉ có một khung,
   nên kết quả là kết quả chấm đơn thuần như Flutter.
   *Hệ quả:* với phiếu sát ngưỡng, ảnh chụp live có thể khác Android nếu các
   khung không đồng thuận; UI hiển thị tỉ lệ đồng thuận và số khung đọc được.
   Phần toán chấm điểm không đổi.
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

## 4. Chưa kiểm chứng được trong môi trường này

- Chưa chạy trên iPhone thật (chưa có thiết bị kết nối): độ phân giải camera
  thực, EXIF ảnh thật, HEIC, wake lock, xoay máy, background/foreground.
  Hành vi từ chối quyền camera, ẩn/foreground (stream dừng rồi mở lại) và xoay
  ngang đã được kiểm tra trong Chromium headless với camera giả 1920×1080@20 fps,
  0 exception JS — nhưng chưa phải Safari iOS.
- Chưa deploy Vercel thật (không có tài khoản/credentials trong phiên làm việc).
- Lighthouse và test offline chạy trên Chrome headless với mobile emulation,
  không phải Safari iOS. Service worker và precache đã được kiểm tra offline
  bằng CDP (xem README), nhưng hành vi iOS có thể khác ở giới hạn bộ nhớ cache.

Khi có thiết bị, quy trình đo đề xuất: mở `#/camera-test`, ghi lại
`width×height@fps`, chụp cùng một phiếu bằng GradeVN Android và web, so SBD,
mã đề, 40 đáp án, điểm; lưu ảnh gốc để đo density nếu có sai lệch.
