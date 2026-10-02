# KeebHub — Bộ thiết kế UI/UX

Sàn thương mại điện tử bàn phím cơ custom. Thiết kế dựa trên sơ đồ Use Case
`UseCase_KeyboardMarketPlace.drawio` (4 actor, 30 use case).

- **53 màn hình**: 43 desktop 1440px + 10 mobile 390px
- **Định dạng**: `.html` (xem bằng Chrome) và `.svg` (kéo thả vào Figma)
- **Phong cách**: light theme, kiểu e-commerce điện tử

---

## Cách đưa vào Figma

1. Mở Figma → tạo file mới
2. Mở thư mục `svg\` trong File Explorer
3. Chọn hết file → kéo thả vào canvas Figma
4. Chọn tất cả frame → chuột phải → **Tidy up**

Không cần plugin. Mỗi file thành một frame với layer hình và text sửa được.

Font trong SVG là **Arial**. Muốn đổi sang Be Vietnam Pro: `Ctrl+A` → panel
Text bên phải → đổi font một lần cho toàn bộ.

---

## Danh sách màn hình

### Nền tảng

| File | Nội dung |
|---|---|
| `00-design-system` | Bảng màu, typography, spacing, button, form, badge, product card |
| `01-wireframes` | Wireframe low-fi 7 màn khách hàng core |

### Khách hàng — desktop (17)

| File | Use case |
|---|---|
| `02-trang-chu` | Điểm vào, CTA Custom Builder |
| `03-danh-muc` | UC02 — duyệt theo danh mục |
| `04-tim-kiem` | UC02 — tìm kiếm & lọc kỹ thuật |
| `05-chi-tiet-san-pham` | UC03, tab Tương thích lấy từ UC27 |
| `06-custom-builder` | **UC04** + «include» UC27, UC28 |
| `07-gio-hang` | UC05 — nhóm theo shop, Build Sheet |
| `08-checkout` | UC06 + Payment Gateway |
| `09-thanh-toan-ket-qua` | UC06 — kết quả giao dịch |
| `10-dang-nhap` `11-dang-ky` `12-quen-mat-khau` | UC01 |
| `13-tai-khoan` | UC09 |
| `14-don-hang-cua-toi` | UC07 |
| `15-chi-tiet-don-hang` | UC07 + tiến độ gia công từ UC22 |
| `16-danh-gia` | UC08 |
| `17-khieu-nai` | UC29 |
| `18-trang-shop` | UC30 |

### Seller / Shop (12)

| File | Use case |
|---|---|
| `19-shop-dashboard` | Tổng quan |
| `20-shop-don-hang` | UC17 |
| `21-shop-xac-nhan-custom` | **UC21** — nhận/từ chối đơn custom trong 24h |
| `22-shop-tien-do-gia-cong` | **UC22** — cập nhật từng công đoạn kèm ảnh |
| `23-shop-san-pham` `24-shop-them-san-pham` | UC18 |
| `25-shop-ton-kho` | UC19 + UC28 |
| `26-shop-dich-vu-custom` | UC20 — gói gia công, công suất xưởng |
| `27-shop-danh-gia` | UC23 |
| `28-shop-bao-cao-su-co` | UC24 |
| `29-shop-doanh-thu` | UC25 |
| `30-shop-ho-so` | UC30 |

### Admin (9)

| File | Use case |
|---|---|
| `31-admin-dashboard` | Tổng quan hệ thống |
| `32-admin-nguoi-dung` | UC13 |
| `33-admin-tai-khoan-shop` | UC11 |
| `34-admin-kiem-duyet` | UC14 |
| `35-admin-danh-muc-ky-thuat` | **UC10** — thuộc tính + quy tắc tương thích cho UC27 |
| `36-admin-huy-hoan-tien` | **UC16 + UC26** — màn phân xử tranh chấp |
| `37-admin-su-co` | UC12 (nhận từ UC24) |
| `38-admin-doanh-thu` | UC15 |
| `39-admin-dang-nhap` | Đăng nhập quản trị, 2FA |

### Phụ (3)

`40-huong-dan` · `41-chinh-sach` · `42-404`

### Mobile 390px (10)

`43-mb-trang-chu` · `44-mb-tim-kiem` · `45-mb-chi-tiet-san-pham` ·
`46-mb-custom-builder` · `47-mb-gio-hang` · `48-mb-checkout` ·
`49-mb-don-hang` · `50-mb-tien-do-don` · `51-mb-tai-khoan` · `52-mb-dang-nhap`

---

## Bảng màu

| Vai trò | Mã |
|---|---|
| Nền trắng / surface | `#FFFFFF` / `#F7F8FA` |
| Viền | `#E4E7EC` |
| Chữ chính / phụ | `#101828` / `#475467` |
| **Thương hiệu** (điều hướng, nút chính) | `#1B62F5` |
| **Accent** (giá tiền, nút mua) | `#FF5A1F` |
| Thành công / cảnh báo / lỗi | `#079455` / `#DC6803` / `#D92D20` |
| Sao đánh giá | `#FDB022` |

Nguyên tắc: nền sáng chiếm ~90% diện tích. Cam **chỉ** dùng cho giá tiền và
nút mua hàng, để mắt người dùng luôn biết chỗ nào bấm ra tiền.

Font: **Be Vietnam Pro** (bản HTML) / **Arial** (bản SVG).

---

## Luồng demo end-to-end

Ba màn dưới đây dùng chung một đơn hàng `#KH-284193` (khách Lê Tùng Dương,
shop SwitchHouse, Build `#B-7742`) nên demo liền mạch được:

1. `15-chi-tiet-don-hang` — khách xem tiến độ gia công 60%, 3/5 công đoạn
2. `22-shop-tien-do-gia-cong` — shop cập nhật công đoạn 4, up ảnh
3. `36-admin-huy-hoan-tien` — admin phân xử khi khách đòi huỷ

Hồ sơ sự cố `#SC-0342` (PCB lỗi) xuất hiện ở cả `28-shop-bao-cao-su-co` và
`37-admin-su-co`, và là căn cứ để admin ra quyết định ở màn số 3.

---

## Điểm khác biệt so với sàn TMĐT thường

- **Custom Builder 5 bước** với kiểm tra tương thích thời gian thực. Linh kiện
  không lắp vừa bị khoá kèm lý do kỹ thuật cụ thể, không chỉ báo lỗi chung chung.
- **Giữ chỗ tồn kho 15 phút** khi khách đang build, tránh tranh chấp linh kiện.
- **Timeline gia công theo công đoạn** kèm ảnh thợ chụp: rã hàn → lube →
  cân stab → lắp ráp → đóng gói.
- **COD bị chặn với đơn gia công** — hàng làm riêng không bán lại được.
- **Quy tắc tương thích 3 mức** (Chặn / Cảnh báo / Gợi ý) do admin cấu hình.
