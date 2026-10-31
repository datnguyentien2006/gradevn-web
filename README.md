# GradeVN Web (PWA)

Bản web iPhone-first của GradeVN — chấm phiếu trắc nghiệm bằng camera, chạy hoàn
toàn trên thiết bị, không có máy chủ. Thuật toán chấm port 1:1 từ bản Flutter;
dự án gốc `C:\Marker-td` được giữ nguyên, không sửa.

- Spec logic: [`docs/LOGIC_SPEC.md`](docs/LOGIC_SPEC.md)
- Đối chiếu Flutter vs web: [`docs/WEB_PARITY.md`](docs/WEB_PARITY.md)

## Trạng thái

| Bước | Nội dung | Trạng thái |
| --- | --- | --- |
| 0 | Phân tích Flutter, viết `docs/LOGIC_SPEC.md` | Xong |
| 1 | Khung dự án + PWA + trang kiểm tra camera | Xong |
| 2 | Port `src/core/` + fixture tests | Xong, khớp Dart |
| 3 | Pipeline trong Web Worker, camera overlay, debug | Xong (chưa test iPhone thật) |
| 4 | Màn hình, IndexedDB, import/export XLSX + JSON | Xong, đã E2E |
| 5 | Stats, tiếng Việt, offline/update, tối ưu, README | Xong |

Đã kiểm chứng trong phiên phát triển:

- `npx tsc --noEmit`: sạch. `npm run check`: 0 lỗi, 0 cảnh báo.
- `npm test`: 9 file, **56 test pass**, gồm hai fixture PNG khớp tuyệt đối với
  Dart (`standard40`: SBD 000413, mã đề 001, 9.25/10; `noisy40`: 000042, 007,
  9.75/10) và 9 test quét mốc live port từ APK.
- E2E trên trình duyệt: tạo key → quét fixture → lưu phiếu → xem kết quả/stats →
  sửa SBD và chấm lại → reload vẫn còn dữ liệu → backup/restore → xuất XLSX.
- Build production: JS chính **207.50 kB (67.98 kB gzip)**; XLSX tách chunk lazy
  **427.62 kB**; worker 31.94 kB; CSS **42.76 kB (7.82 kB gzip)**; eruda
  **506.26 kB**, chỉ tải khi mở `?debug=1`.
- Lighthouse 11.7.1 (mobile emulation, đo trên bản preview production trước thay
  đổi quét mốc live): Performance **99**, Accessibility **100**, Best Practices
  **100**, PWA **100**; FCP 1.3 s, LCP 1.8 s, TBT 30 ms, CLS 0.061.
- Offline bằng CDP: service worker active, precache đủ `index.html`, JS/CSS,
  worker, XLSX, icon; điều hướng `#/stats` khi `navigator.onLine === false` vẫn
  render đầy đủ.
- Kiểm tra DoD bằng CDP (headless Chrome, bản preview production): từ chối quyền
  camera → fallback tiếng Việt đúng + 3 nút, bấm "Thử lại camera" không crash;
  camera giả 1920×1080@20 fps → ẩn tab làm track `ended`, quay lại foreground mở
  stream mới; xoay ngang 844×390 không tràn ngang. 0 exception JS ở cả hai kịch
  bản. Đây là kiểm chứng hành vi trong Chromium — chưa thay thế iPhone Safari thật.
- Quét mốc live bằng camera giả Y4M 1080×1920/1920×1080 dựng mốc đúng layout:
  4 ô xanh ở cỡ mốc 30–120 px và khung ngang; 0/4 (không xanh giả) khi mốc quá
  gần/quá xa, lệch khỏi ô hoặc quá nhạt; tự chụp vào kết quả 3/3 khung, không
  chụp lặp sau khi quét lại. Chi tiết ma trận ở `docs/WEB_PARITY.md` mục 4.
- Audit vùng chạm bằng CDP trên bản preview, dữ liệu mẫu (2 lớp, 2 kỳ thi, 5
  phiếu): 11 màn hình + 2 bottom sheet ở **390×844** và **375×667** đều
  **0 phần tử < 44×44 px, 0 tràn ngang, 0 exception JS**; riêng màn nhập đáp án
  có 233 phần tử tương tác, tất cả đạt 44×44. Cũng là kiểm chứng Chromium.

**Chưa làm được trong môi trường này:** deploy Vercel thật (cần tài khoản Vercel
của bạn) và test camera trên iPhone thật. Hai việc này nằm trong checklist cuối.

## Kiến trúc

```text
src/
  core/      # thuật toán thuần TS, không DOM: template, layout, detector,
             # homography/warp, density, decoder, grader, scoring, scanFlow
  workers/   # omr.worker.ts + client/protocol (OffscreenCanvas + fallback)
  camera/    # getUserMedia, overlay, chọn ảnh, EXIF/HEIC, bỏ phiếu đa khung
  storage/   # IndexedDB (idb), repositories, stats, XLSX, backup JSON
  ui/        # màn hình Svelte 5, router hash, toast, install banner
tests/       # unit + fixture (standard40, noisy40)
docs/        # LOGIC_SPEC.md, WEB_PARITY.md
```

- Svelte 5 vì runtime nhỏ, không virtual DOM, hợp UI tĩnh nhiều màn hình.
- Không dùng OpenCV.js: pipeline gốc chỉ cần grayscale, threshold, blob scan,
  homography và sampling — port tay sang TS nhẹ hơn nhiều và chạy được trong
  worker. Ảnh không rời thiết bị.
- IndexedDB có schema tương ứng SQLite của Flutter (`classRooms`, `students`,
  `contests`, `answerKeys`, `gradedSheets`, `images`, `settings`).

## Chạy local

```bash
npm install
npm run dev
```

Mở URL Vite in ra (mặc định `http://localhost:5173`). Thêm `?debug=1` để bật
eruda và bảng debug camera/pipeline. Camera thật trên điện thoại cần HTTPS —
dùng bản Vercel, hoặc một tunnel HTTPS trỏ về máy dev.

Build và chạy thử bản production:

```bash
npm run build
npm run preview
```

## Kiểm thử

```bash
npm test          # 56 test
npm run check     # svelte-check
npx tsc --noEmit  # type-check
```

Fixture nằm ở `tests/fixtures/generated` (PNG) và `tests/fixtures/expected`
(JSON lấy từ test Dart). Test chấm đúng các tầng: SBD, mã đề, từng đáp án,
`score`, `correctCount`, `partScores`, cùng ba đường vào pipeline.

## Deploy lên Vercel (miễn phí)

### 1. Đưa code lên GitHub

`C:\Gradevn-web` đã là git repo (nhánh `main`, remote `origin` trỏ tới
`github.com/datnguyentien2006/gradevn-web`). Commit thay đổi rồi push; nếu remote
chưa tồn tại, tạo repo mới trên GitHub trước:

```bash
cd /c/Gradevn-web
git add .
git commit -m "GradeVN Web PWA"
git push -u origin main
```

`node_modules`, `dist`, `dev-dist` đã nằm trong `.gitignore`. Không đưa
`C:\Marker-td` vào repo này.

### 2. Import vào Vercel

1. Đăng nhập [vercel.com](https://vercel.com) bằng tài khoản GitHub.
2. **Add New → Project → Import** repo `gradevn-web`.
3. Framework Preset: **Vite** (Vercel tự nhận).
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`
   - Node.js: 20.x hoặc 22.x (không cần biến môi trường).
4. **Deploy**. Vercel cấp HTTPS tự động — bắt buộc để Safari cho phép camera.

Cách CLI (nếu thích):

```bash
npm i -g vercel
vercel login
cd /c/Gradevn-web
vercel --prod
```

### 3. Cấu hình đã có sẵn trong repo

`vercel.json` đã khai báo:

- SPA rewrite mọi route không phải file tĩnh về `/index.html`;
- `assets/*` cache `immutable` 1 năm (tên có hash);
- `sw.js` và `index.html` `no-cache`;
- `.webmanifest` trả `Content-Type: application/manifest+json`;
- icon cache 7 ngày.

Sau deploy nên kiểm tra nhanh:

```bash
curl -I https://<app>.vercel.app/sw.js
curl -I https://<app>.vercel.app/manifest.webmanifest
curl -I https://<app>.vercel.app/assets/<file>.js
```

Kỳ vọng: `sw.js` có `Cache-Control: no-cache...`, manifest đúng content-type,
asset có `immutable`.

## Cài lên iPhone

1. Mở link Vercel bằng **Safari** (không phải Chrome/Facebook).
2. Nút **Chia sẻ** → **Thêm vào Màn hình chính** → **Thêm**.
3. Mở GradeVN từ biểu tượng: chạy standalone, toàn màn hình, có safe-area.
4. Lần đầu cấp quyền camera; nếu từ chối, app hiện hướng dẫn và vẫn cho chọn
   ảnh từ thư viện.
5. Sau lần mở đầu tiên, thử **chế độ máy bay**: tắt mạng, mở lại app, quét và
   xem kết quả. Mọi thứ phải chạy offline.
6. Khi có bản mới, app hiện toast cập nhật — bấm để tải lại.

## Gỡ lỗi trên iPhone (không cần Mac)

- Mở `https://<app>.vercel.app/?debug=1`: bật eruda (console, network, element).
- **Cài đặt → Kiểm tra camera**: hiển thị `width×height@fps` thực của track,
  chụp thử và xem ảnh.
- Trong màn quét, bảng debug hiển thị thời gian từng tầng, ảnh threshold,
  4 mốc, ảnh đã nắn và các bubble đã đọc.
- **Cài đặt → Bật bảng gỡ lỗi eruda** mở lại app với `?debug=1`.
- Khi app lỗi sau cập nhật, đóng hẳn app rồi mở lại; nếu vẫn lỗi, xoá site data
  trong Safari Settings → Advanced → Website Data (sẽ mất dữ liệu chưa backup).

## Dữ liệu và sao lưu

- Toàn bộ dữ liệu nằm trong IndexedDB trên máy; không có API/máy chủ.
- App gọi `navigator.storage.persist()`; nếu chưa được cấp, Cài đặt hiện
  "Tạm thời" và nút xin lưu trữ bền vững. iOS vẫn có thể thu hồi dung lượng
  khi máy thiếu chỗ — hãy backup định kỳ.
- **Cài đặt → Xuất bản sao lưu JSON**: tùy chọn kèm ảnh phiếu; chia sẻ qua
  Files/AirDrop hoặc tải xuống. **Phục hồi** thay thế toàn bộ dữ liệu hiện tại.
- Xoá toàn bộ dữ liệu yêu cầu gõ `XOA` để xác nhận.

## Khác biệt so với bản Flutter

Chi tiết đo được ở [`docs/WEB_PARITY.md`](docs/WEB_PARITY.md). Tóm tắt:

- Hai fixture PNG cho kết quả trùng tuyệt đối; chưa có ảnh chụp thật từ iPhone
  để đo sai lệch màu/EXIF.
- Quét mốc live port đúng từng ô của APK (80 ms, khung 640 px, cửa sổ 1.5×,
  cùng ngưỡng); tự chụp khi cả 4 ô xanh 2 nhịp liên tiếp. Web vẫn chụp 3 khung
  và bỏ phiếu đa số; Flutter chấm một khung. Đường chọn ảnh là một khung.
- HEIC phụ thuộc khả năng giải mã của Safari; không nhúng decoder WASM.
- Các giới hạn logic của Flutter (chỉ TN40, không chấm E, OCR stub, `keyId`
  treo sau khi xoá khoá, mã đề mất số 0 đầu khi so khớp...) được giữ nguyên để
  đảm bảo parity, không tự sửa.

## Checklist nghiệm thu trên iPhone thật

- [ ] Mở link Vercel trong Safari; cài vào Màn hình chính; chạy fullscreen.
- [ ] `#/camera-test` báo độ phân giải/fps thực tế.
- [ ] Tạo lớp, import học sinh XLSX, tạo kỳ thi, nhập đáp án.
- [ ] Quét cùng một phiếu bằng Android và web; so SBD, mã đề, đáp án, điểm.
- [ ] Lưu phiếu, xem chi tiết, xuất XLSX qua bảng chia sẻ iOS.
- [ ] Chế độ máy bay: mở lại app, quét và xem kết quả offline.
- [ ] Từ chối quyền camera → chọn ảnh từ thư viện vẫn chấm được.
- [ ] Xoay máy, chuyển sang app khác rồi quay lại khi đang quét.
- [ ] Deploy bản mới → toast cập nhật → bấm tải lại, dữ liệu còn nguyên.

## Bảo tồn dự án Flutter

- `C:\Marker-td` không bị chỉnh sửa trong quá trình port.
- Bản sao lưu: `C:\Marker-td-backup-20261030`.
- Bản web chỉ đọc mã Dart và port thuật toán; không copy tài nguyên nhị phân
  ngoài fixture PNG phục vụ test.
