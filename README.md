# ⌨ KeebHub — Sàn TMĐT bàn phím cơ custom

Đồ án Thương mại điện tử: sàn mua bán kit, switch, keycap, stabilizer và **dịch vụ gia công bàn phím custom**, có Custom Builder kiểm tra tương thích linh kiện, theo dõi tiến độ gia công theo từng công đoạn, thanh toán VNPay và trợ lý AI.

Giao diện dựng theo bộ thiết kế trong thư mục `design/` (KeebHub UI kit).

**Công nghệ:** Node.js · Express 4 · EJS · MongoDB (Mongoose 8) · express-session · Passport (Google/Facebook) · Nodemailer · Multer · Chart.js · VNPay sandbox API 2.1.0

---

## 1. Chạy nhanh

> 📘 Hướng dẫn cài đặt chi tiết từng bước cho thành viên nhóm (cài Node.js, MongoDB, clone, cấu hình `.env`, xử lý lỗi): xem **[HUONG-DAN-CAI-DAT.md](HUONG-DAN-CAI-DAT.md)**.

Yêu cầu: **Node.js ≥ 18** và **MongoDB** (cài [MongoDB Community](https://www.mongodb.com/try/download/community) hoặc dùng MongoDB Atlas miễn phí).

```bash
git clone https://github.com/<tai-khoan>/keebhub.git
cd keebhub
npm install
cp .env.example .env        # Windows: copy .env.example .env
npm run seed                # tạo dữ liệu mẫu (XOÁ dữ liệu cũ trong DB)
npm run dev                 # hoặc: npm start
```

Mở <http://localhost:3000>.

### Tài khoản demo (sau khi `npm run seed`)

| Vai trò | Email | Mật khẩu | Ghi chú |
|---|---|---|---|
| Admin | `admin@keebhub.vn` | `Admin@123` | Đăng nhập tại `/admin/login` |
| Seller (xưởng gia công) | `switchhouse@keebhub.vn` | `Seller@123` | Có đơn custom chờ nhận |
| Seller (xưởng gia công) | `keeblab@keebhub.vn` | `Seller@123` | |
| Seller (bán lẻ) | `akko@keebhub.vn`, `keycapdongnam@keebhub.vn` | `Seller@123` | |
| Seller chờ duyệt | `newshop@keebhub.vn` | `Seller@123` | Để demo admin duyệt shop |
| Khách hàng | `khach@keebhub.vn` | `Khach@123` | Có lịch sử đơn, đơn đang gia công |
| Khách bị khoá | `spam@keebhub.vn` | `Khach@123` | Demo khoá tài khoản |

Dữ liệu mẫu gồm ~30 sản phẩm, 5 gói gia công, ~180 đơn hàng trải đều 90 ngày (để biểu đồ có số liệu), đánh giá và hỏi đáp.

---

## 2. Cấu hình `.env`

Mọi tích hợp bên ngoài đều **tự chuyển sang chế độ demo** nếu để trống, nên web chạy được ngay mà không cần key.

| Biến | Dùng cho | Để trống thì |
|---|---|---|
| `MONGODB_URI` | Kết nối MongoDB | mặc định `mongodb://127.0.0.1:27017/keebhub` |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | Gửi email xác nhận đăng ký, quên mật khẩu, đặt hàng | Email được lưu ở **Hộp thư dev** `/dev/mails` |
| `VNP_TMNCODE`, `VNP_HASHSECRET` | Thanh toán VNPay sandbox | Dùng trang **Mô phỏng VNPay** |
| `GOOGLE_CLIENT_ID/SECRET` | Đăng nhập Google | Nút Google báo chưa cấu hình |
| `FACEBOOK_APP_ID/SECRET` | Đăng nhập Facebook | Nút Facebook báo chưa cấu hình |
| `GEMINI_API_KEY` hoặc `ANTHROPIC_API_KEY` | Chat AI | Trợ lý trả lời theo luật + tìm sản phẩm trong CSDL |

**Gmail SMTP:** bật xác minh 2 bước → tạo *App password* tại <https://myaccount.google.com/apppasswords> → điền `SMTP_USER=email@gmail.com`, `SMTP_PASS=<app password 16 ký tự>`.

**VNPay sandbox:** đăng ký tại <https://sandbox.vnpayment.vn/devreg/> để nhận `vnp_TmnCode` và `vnp_HashSecret` qua email. Thẻ test (ngân hàng NCB): `9704198526191432198` · tên `NGUYEN VAN A` · ngày phát hành `07/15` · OTP `123456`.
Return URL: `http://localhost:3000/payment/vnpay_return` · IPN URL: `/payment/vnpay_ipn` (cần domain public, ví dụ dùng ngrok).

**Google OAuth:** Google Cloud Console → Credentials → OAuth client ID (Web) → Authorized redirect URI `http://localhost:3000/auth/google/callback`.
**Facebook Login:** developers.facebook.com → tạo app → Facebook Login → Valid OAuth Redirect URI `http://localhost:3000/auth/facebook/callback`.

---

## 3. Chức năng

### Nhóm bắt buộc

| Chức năng | Vị trí |
|---|---|
| Đăng ký (gửi email xác nhận) | `/auth/register` → email chứa link `/auth/verify/:token` (hiệu lực 24h), gửi lại email |
| Đăng nhập / Đăng xuất | `/auth/login`, nút Đăng xuất ở menu tài khoản |
| Lấy lại mật khẩu | `/auth/forgot` → email link `/auth/reset/:token` (30 phút) |
| Xem chi tiết sản phẩm | `/p/:slug` — ảnh, thông số, tab Tương thích, Đánh giá, Hỏi đáp |
| Quản lý giỏ hàng | `/cart` — gom theo shop, tăng/giảm/xoá, build custom hiển thị Build Sheet |
| Đặt hàng | `/checkout` — tách đơn theo shop, kiểm tra tồn kho & tương thích |
| Thanh toán trực tuyến | VNPay (ký HMAC-SHA512, return URL + IPN), thanh toán lại khi lỗi |
| Lịch sử mua hàng | `/account/orders` — lọc theo trạng thái, chi tiết đơn & timeline |
| Biểu đồ cột theo khoảng ngày | Seller `/seller/revenue`, Admin `/admin/revenue` — chọn **từ ngày → đến ngày**, gom theo ngày/tháng |
| Biểu đồ tròn | Cơ cấu theo loại đơn, danh mục, trạng thái đơn |
| Admin quản lý cơ bản | Người dùng (khoá/mở, xác minh), shop (duyệt/khoá), sản phẩm (kiểm duyệt/ẩn/xoá), đơn hàng (can thiệp trạng thái) |
| Seller quản lý cơ bản | Sản phẩm (thêm/sửa/ẩn/xoá, upload ảnh), tồn kho, đơn hàng, doanh thu & phí |

### Chức năng đặc trưng của đề tài

1. **Quản lý dịch vụ custom (seller)** — `/seller/services`: tạo gói gia công (giá, số ngày, công đoạn, có hàn/lube), bật/tắt, công suất xưởng.
2. **Tiếp nhận yêu cầu gia công** — `/seller/custom`: đơn từ Custom Builder vào hàng chờ, shop nhận hoặc từ chối (có lý do, tự hoàn tiền) trong 24h.
3. **Cập nhật tiến độ gia công** — `/seller/progress`: hoàn thành từng công đoạn kèm ghi chú và **ảnh thực tế**; khách xem tiến độ % ở trang đơn hàng. Xong công đoạn cuối → tự chuyển "Đang giao".
4. **Tùy chỉnh cấu hình custom (customer)** — `/builder`: 5 bước Kit → Switch → Keycap & Stab → Gói gia công → Xem lại; lưu cấu hình (`/account/builds`), đặt hàng.
5. **Kiểm tra độ tương thích** — `utils/compat.js`: 8 quy tắc 3 mức **Chặn / Cảnh báo / Gợi ý** (chân switch 3/5 pin, số lượng switch, kiểu mount stab, layout keycap, LED north-facing + Cherry, kit hàn cần gói có hàn, gợi ý lube, thiếu stab). Linh kiện không lắp vừa bị khoá kèm lý do. Admin chỉnh mức độ/thông báo tại `/admin/compat`.

### Chức năng tự chọn (đã làm cả 11)

Đăng nhập Google · Đăng nhập Facebook · Cập nhật thông tin cá nhân (`/account`, đổi avatar, mật khẩu, địa chỉ) · Cập nhật trạng thái đơn hàng (seller/admin) · Trả lời bình luận (Hỏi đáp sản phẩm + phản hồi đánh giá) · Tìm kiếm gian hàng (`/shops`, và gợi ý shop khi tìm kiếm) · Đánh giá sản phẩm đã mua (kèm ảnh, chỉ khi đơn đã giao) · Hủy đơn hàng (hoàn kho, tự chuyển chờ hoàn tiền, admin xác nhận hoàn) · Sản phẩm bán chạy ở trang chủ · Sản phẩm gợi ý (theo danh mục/layout khách đã xem & mua) · Chat AI hỗ trợ (nút "Hỏi Keeby", Gemini/Claude hoặc chế độ luật).

---

## 4. Cấu trúc thư mục

```
keebhub/
├── server.js              # khởi tạo Express, session, route
├── config/                # passport (Google/Facebook), multer upload
├── middleware/auth.js     # nạp user, phân quyền customer/seller/admin
├── models/                # User, Shop, Category, Product, CustomService, CompatRule, Build, Order, Review, Comment
├── routes/                # home, auth, cart(+checkout), payment(VNPay), account, builder, seller, admin, api(chat)
├── utils/                 # compat (tương thích), vnpay, mailer, stats (thống kê), ai (chat), svg (ảnh minh hoạ)
├── views/                 # EJS: shop/, auth/, cart/, account/, builder/, seller/, admin/, pages/, partials/
├── public/                # css/style.css (gom từ design), css/app.css, js/, vendor/chart.js
├── seed/seed.js           # dữ liệu mẫu
└── design/                # bộ thiết kế UI/UX gốc (HTML + SVG)
```

Luồng trạng thái đơn: `Chờ xác nhận → Đã xác nhận → Đang giao → Đã giao → Hoàn thành` (đơn thường) và `Chờ xác nhận (chờ shop nhận) → Đang gia công → Đang giao → Đã giao → Hoàn thành` (đơn custom). Đơn custom chỉ thanh toán VNPay.

Doanh thu tính trên đơn không huỷ và đã thanh toán (VNPay) hoặc COD; phí sàn 5%.

## 5. Ghi chú

- Ảnh sản phẩm: nếu shop chưa upload, hệ thống tự vẽ ảnh minh hoạ SVG theo màu khai báo (giống phong cách bộ thiết kế).
- Ảnh upload lưu ở `public/uploads/` (không đưa lên git).
- Lệnh `npm run seed` **xoá toàn bộ** database trong `MONGODB_URI` trước khi tạo dữ liệu mẫu.
