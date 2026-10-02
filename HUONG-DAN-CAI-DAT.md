# Hướng dẫn cài đặt và chạy KeebHub (thủ công)

Tài liệu dành cho các thành viên nhóm **clone code từ GitHub về máy và chạy bằng lệnh**, không dùng file `start-keebhub.bat`.

> Hướng dẫn viết cho **Windows 10/11**. Dùng macOS/Linux thì xem ghi chú ở mục 10.
> Thời gian cài lần đầu: khoảng 20–30 phút.

---

## Mục lục

1. [Cài phần mềm cần thiết](#1-cài-phần-mềm-cần-thiết)
2. [Kiểm tra cài đặt](#2-kiểm-tra-cài-đặt)
3. [Lấy quyền truy cập repo và clone code](#3-lấy-quyền-truy-cập-repo-và-clone-code)
4. [Cài thư viện](#4-cài-thư-viện)
5. [Tạo file cấu hình `.env`](#5-tạo-file-cấu-hình-env)
6. [Tạo dữ liệu mẫu](#6-tạo-dữ-liệu-mẫu)
7. [Chạy web](#7-chạy-web)
8. [Cấu hình tuỳ chọn: Google, Facebook, Email, VNPay, Chat AI](#8-cấu-hình-tuỳ-chọn)
9. [Chạy kiểm thử tự động](#9-chạy-kiểm-thử-tự-động)
10. [Ghi chú cho macOS / Linux](#10-ghi-chú-cho-macos--linux)
11. [Quy trình làm việc nhóm với Git](#11-quy-trình-làm-việc-nhóm-với-git)
12. [Lỗi thường gặp](#12-lỗi-thường-gặp)

---

## 1. Cài phần mềm cần thiết

| Phần mềm | Phiên bản | Tải tại | Ghi chú khi cài |
|---|---|---|---|
| **Git** | mới nhất | <https://git-scm.com/download/win> | Cứ bấm Next, giữ mặc định |
| **Node.js** | **22 LTS** (tối thiểu 18) | <https://nodejs.org/en/download> | Chọn bản **LTS**, file `.msi`. Không cần tick "Tools for Native Modules" |
| **MongoDB Community Server** | 7 hoặc 8 | <https://www.mongodb.com/try/download/community> | Chọn *Windows x64 – msi*. Ở bước cài chọn **Complete** và **giữ tick "Install MongoDB as a Service"** để MongoDB tự chạy khi bật máy. Có thể tick thêm *MongoDB Compass* để xem dữ liệu |
| **VS Code** (khuyên dùng) | mới nhất | <https://code.visualstudio.com> | Để mở code và terminal |

> **Không muốn cài MongoDB?** Có thể dùng **MongoDB Atlas** (cloud, miễn phí): tạo cluster M0 → *Connect* → *Drivers* → copy chuỗi `mongodb+srv://...` và dán vào `MONGODB_URI` ở bước 5. Nhớ thêm IP của bạn (hoặc `0.0.0.0/0`) vào *Network Access*.

Cài xong **đóng hết cửa sổ terminal / VS Code rồi mở lại** để Windows nhận PATH mới.

---

## 2. Kiểm tra cài đặt

Mở **Command Prompt** (gõ `cmd` ở Start) hoặc terminal trong VS Code, chạy lần lượt:

```bat
git --version
node -v
npm -v
```

Kết quả mong đợi (số phiên bản có thể khác):

```
git version 2.4x.x.windows.1
v22.x.x
10.x.x
```

Kiểm tra MongoDB đang chạy:

```bat
sc query MongoDB
```

Thấy dòng `STATE : 4 RUNNING` là được. Nếu là `STOPPED` thì chạy `net start MongoDB` (mở cmd bằng **Run as administrator**), hoặc mở `services.msc` → tìm **MongoDB Server** → **Start**.

---

## 3. Lấy quyền truy cập repo và clone code

Repo đang để **private** nên cần trưởng nhóm cấp quyền trước:

1. **Trưởng nhóm** vào <https://github.com/23130073-Letungduong/keebhub> → **Settings** → **Collaborators** → **Add people** → nhập username GitHub của từng thành viên.
2. **Thành viên** mở email (hoặc <https://github.com/notifications>) → **Accept invitation**.

Sau đó clone về (ví dụ để trong `D:\DoAn`):

```bat
cd /d D:\
mkdir DoAn
cd DoAn
git clone https://github.com/23130073-Letungduong/keebhub.git
cd keebhub
```

Lần đầu `git clone` repo private, Windows sẽ hiện cửa sổ **Git Credential Manager** → chọn **Sign in with your browser** → đăng nhập GitHub → **Authorize**. Từ lần sau không cần đăng nhập lại.

---

## 4. Cài thư viện

Đang ở thư mục `keebhub`:

```bat
npm install
```

Lệnh này đọc `package.json` / `package-lock.json` và tải thư viện vào thư mục `node_modules` (khoảng 1–3 phút). Thư mục `node_modules` **không** đưa lên GitHub, mỗi máy tự cài.

---

## 5. Tạo file cấu hình `.env`

File `.env` chứa cấu hình và mật khẩu riêng nên **không có trên GitHub**. Tạo từ file mẫu:

```bat
copy .env.example .env
```

Mở `.env` bằng VS Code (`code .env`) và sửa tối thiểu 2 dòng:

```ini
MONGODB_URI=mongodb://127.0.0.1:27017/keebhub
SESSION_SECRET=chuoi-ngau-nhien-bat-ky-cua-ban-123
```

- `MONGODB_URI`: giữ nguyên nếu cài MongoDB trên máy; dùng Atlas thì dán chuỗi `mongodb+srv://...`.
- `SESSION_SECRET`: gõ một chuỗi ngẫu nhiên bất kỳ (dài khoảng 30 ký tự).
- Các dòng còn lại **để trống vẫn chạy được**: email sẽ hiện ở *Hộp thư dev* `/dev/mails`, thanh toán dùng trang *Mô phỏng VNPay*, chat AI chạy chế độ trả lời theo luật. Muốn bật thật xem mục 8.

> ⚠️ **Tuyệt đối không commit file `.env` lên GitHub** (đã có sẵn trong `.gitignore`). Muốn chia sẻ key thì gửi riêng qua Zalo/Messenger.

---

## 6. Tạo dữ liệu mẫu

```bat
npm run seed
```

Kết quả cuối sẽ báo đã tạo người dùng, shop, sản phẩm, đơn hàng… Lệnh này **xoá toàn bộ dữ liệu cũ** trong database `keebhub` rồi tạo lại, nên chỉ chạy lần đầu hoặc khi muốn làm mới dữ liệu demo.

### Tài khoản demo

| Vai trò | Email | Mật khẩu | Trang đăng nhập |
|---|---|---|---|
| Admin – Lê Tùng Dương | `admin@keebhub.vn` | `Admin@123` | <http://localhost:3000/admin/login> |
| Seller – Trần Minh Khang (SwitchHouse) | `switchhouse@keebhub.vn` | `Seller@123` | <http://localhost:3000/auth/login> |
| Seller – Phan Văn Gia Bảo (KeebLab) | `keeblab@keebhub.vn` | `Seller@123` | <http://localhost:3000/auth/login> |
| Khách – Trần Hữu Thắng | `khach@keebhub.vn` | `Khach@123` | <http://localhost:3000/auth/login> |

Seller khác: `akko@`, `keycapdongnam@`, `newshop@` (shop chờ duyệt) — đều `@keebhub.vn`, mật khẩu `Seller@123`.
Khách khác: `user1@` … `user12@keebhub.vn`, mật khẩu `Khach@123`; `spam@keebhub.vn` là tài khoản bị khoá.

---

## 7. Chạy web

```bat
npm run dev
```

- `npm run dev` dùng **nodemon**: sửa code `.js` là server tự khởi động lại (khi sửa file `.ejs`/`.css` chỉ cần F5 trình duyệt).
- Hoặc `npm start` để chạy bình thường.

Thấy 2 dòng sau là thành công:

```
✓ Đã kết nối MongoDB: mongodb://127.0.0.1:27017/keebhub
✓ KeebHub chạy tại http://localhost:3000
```

Mở trình duyệt vào **<http://localhost:3000>**. Giữ cửa sổ terminal mở trong lúc dùng web; bấm **Ctrl + C** để tắt.

---

## 8. Cấu hình tuỳ chọn

Tất cả đều ghi vào file `.env`, sửa xong phải **tắt web (Ctrl + C) và chạy lại** `npm run dev`.

### 8.1. Đăng nhập Google và Facebook

App Google/Facebook đã được trưởng nhóm tạo sẵn. Các thành viên **không cần tạo app mới**, chỉ cần:

1. Xin trưởng nhóm 4 giá trị (gửi riêng, không đăng lên GitHub) và dán vào `.env`:
   ```ini
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   FACEBOOK_APP_ID=...
   FACEBOOK_APP_SECRET=...
   ```
2. Vì app đang ở chế độ thử nghiệm, **trưởng nhóm phải thêm tài khoản của từng thành viên**:
   - **Google:** <https://console.cloud.google.com> → project *keebhub* → **APIs & Services** → **OAuth consent screen** (Audience) → **Test users** → **Add users** → nhập Gmail của thành viên.
   - **Facebook:** <https://developers.facebook.com/apps> → app *KeebHub* → **App roles** → **Roles** → **Add People** → chọn **Testers** → nhập tên/ID Facebook của thành viên. Thành viên vào <https://developers.facebook.com/requests> để chấp nhận.
3. Web phải chạy đúng địa chỉ `http://localhost:3000` (không đổi `PORT`), vì địa chỉ callback đã đăng ký là `http://localhost:3000/auth/google/callback` và `.../auth/facebook/callback`.

### 8.2. Gửi email thật (Gmail)

1. Bật **Xác minh 2 bước** cho tài khoản Gmail.
2. Vào <https://myaccount.google.com/apppasswords> → tạo **App password** (16 ký tự).
3. Điền vào `.env`:
   ```ini
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=email-cua-ban@gmail.com
   SMTP_PASS=abcdefghijklmnop
   ```

### 8.3. VNPay sandbox

1. Đăng ký tài khoản test tại <https://sandbox.vnpayment.vn/devreg/> → VNPay gửi email có `vnp_TmnCode` và `vnp_HashSecret`.
2. Điền `VNP_TMNCODE` và `VNP_HASHSECRET` vào `.env` (giữ nguyên `VNP_URL`, `VNP_RETURN_URL`).
3. Thẻ test (ngân hàng **NCB**): số thẻ `9704198526191432198`, tên `NGUYEN VAN A`, ngày phát hành `07/15`, OTP `123456`.

### 8.4. Chat AI

Điền **một trong hai**:

```ini
GEMINI_API_KEY=...        # lấy tại https://aistudio.google.com/apikey
ANTHROPIC_API_KEY=...     # lấy tại https://console.anthropic.com
```

---

## 9. Chạy kiểm thử tự động

MongoDB phải đang chạy. Tại thư mục `keebhub`:

```bat
npm test
```

- Bộ kiểm thử gồm **217 ca**, chạy khoảng 1–2 phút, kết quả cuối là `ℹ pass 217` / `ℹ fail 0`.
- Kiểm thử dùng database riêng **`keebhub_test`** và cổng **3100**, **không** ảnh hưởng dữ liệu demo ở database `keebhub`, cũng không cần tắt web đang chạy.
- Dùng MongoDB Atlas thì đặt thêm biến môi trường trước khi chạy: `set TEST_MONGODB_URI=mongodb+srv://.../keebhub_test` (tên database bắt buộc chứa chữ `test`).
- Chi tiết từng ca xem file Excel *KeebHub-Danh-sach-ca-kiem-thu.xlsx*.

---

## 10. Ghi chú cho macOS / Linux

- **Node.js:** cài bản LTS từ nodejs.org (hoặc `brew install node@22`).
- **MongoDB (macOS):**
  ```bash
  brew tap mongodb/brew
  brew install mongodb-community
  brew services start mongodb-community
  ```
- Lệnh tạo `.env` dùng `cp .env.example .env` thay cho `copy`.
- Các lệnh còn lại (`npm install`, `npm run seed`, `npm run dev`, `npm test`) giống hệt Windows.

---

## 11. Quy trình làm việc nhóm với Git

**Mỗi lần bắt đầu làm** — lấy code mới nhất:

```bat
git checkout main
git pull
npm install
```

(`npm install` chỉ cần khi có người thêm thư viện mới, chạy thừa cũng không sao.)

**Làm tính năng mới** — tạo nhánh riêng để không đè code của nhau:

```bat
git checkout -b ten-ban/ten-tinh-nang
:: ... sửa code ...
git add .
git commit -m "Mo ta ngan gon thay doi"
git push -u origin ten-ban/ten-tinh-nang
```

Sau đó lên GitHub bấm **Compare & pull request** để nhóm xem lại rồi **Merge** vào `main`.

Lần đầu commit trên máy mới, Git sẽ yêu cầu khai báo tên và email:

```bat
git config --global user.name "Ho Ten Cua Ban"
git config --global user.email "email-github-cua-ban@gmail.com"
```

Lưu ý:
- Trước khi push nên chạy `npm test` để chắc chắn không làm hỏng chức năng cũ.
- Không commit `.env`, `node_modules`, ảnh trong `public/uploads` (đã chặn sẵn bằng `.gitignore`).

---

## 12. Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách sửa |
|---|---|---|
| `'node' / 'npm' / 'git' is not recognized...` | Terminal mở trước khi cài xong | Đóng hẳn terminal/VS Code rồi mở lại. Vẫn lỗi thì khởi động lại máy |
| PowerShell báo `npm.ps1 cannot be loaded because running scripts is disabled` | Chính sách chạy script của PowerShell | Dùng **Command Prompt** thay PowerShell, hoặc chạy 1 lần: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `✗ Không kết nối được MongoDB` / `ECONNREFUSED 127.0.0.1:27017` | MongoDB chưa chạy | `net start MongoDB` (cmd quyền admin) hoặc Start trong `services.msc` |
| `EADDRINUSE: address already in use :::3000` | Đã có web khác chạy cổng 3000 (ví dụ quên tắt cửa sổ cũ) | Tắt cửa sổ cũ, hoặc chạy `netstat -ano \| findstr :3000` rồi `taskkill /PID <số PID> /F` |
| Trình duyệt báo `ERR_CONNECTION_REFUSED` | Web chưa chạy hoặc đã bị tắt | Kiểm tra terminal còn chạy `npm run dev` và đã hiện dòng "KeebHub chạy tại..." |
| `remote: Repository not found` khi clone | Chưa được thêm làm collaborator hoặc chưa Accept | Xem lại mục 3 |
| Google báo `Error 403: access_denied` | Gmail chưa được thêm vào Test users | Trưởng nhóm thêm theo mục 8.1 |
| Google báo `redirect_uri_mismatch` | Web không chạy ở `http://localhost:3000` | Giữ `PORT=3000`, `BASE_URL=http://localhost:3000` |
| Bấm "Đăng nhập Google/Facebook" báo chưa cấu hình | Thiếu key trong `.env` | Dán key theo mục 8.1, rồi chạy lại web |
| Đăng ký xong không thấy email | Chưa cấu hình SMTP | Vào <http://localhost:3000/dev/mails> để xem email |
| Giao diện không đổi sau khi `git pull` | Trình duyệt giữ bản cũ | Tắt web, chạy lại, rồi bấm **Ctrl + F5** |
| `npm install` báo lỗi mạng / timeout | Mạng chặn hoặc chậm | Thử lại, đổi mạng khác, hoặc chạy `npm cache clean --force` rồi `npm install` |
| Đăng nhập admin ở trang thường báo sai mật khẩu | Admin chỉ đăng nhập ở trang riêng | Vào <http://localhost:3000/admin/login> |

---

### Tóm tắt nhanh (cho lần sau)

```bat
:: Lần đầu
git clone https://github.com/23130073-Letungduong/keebhub.git
cd keebhub
npm install
copy .env.example .env
npm run seed
npm run dev

:: Các lần sau
cd keebhub
git pull
npm install
npm run dev
```
