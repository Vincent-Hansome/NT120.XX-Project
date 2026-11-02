# MỘC — Web Clothing Store

Website bán quần áo dùng Node.js, Express, EJS và MySQL 8.0. Người dùng có thể đăng ký, đăng nhập, quản lý giỏ hàng, đặt hàng, xem lịch sử và gửi yêu cầu hỗ trợ. Admin quản lý sản phẩm, ảnh, danh mục và phản hồi hỗ trợ.

README mô tả cấu hình **demo HTTP local**, cập nhật ngày **02/11/2026**.
Baseline ngày 29/10 và chức năng hỗ trợ ngày 02/11 đã được kiểm thử riêng;
chưa chèn attack chain. Xem [báo cáo baseline](test-artifacts/final-baseline-results.md)
và [kết quả hỗ trợ khách hàng](test-artifacts/support/RESULTS.md).

## Hỗ trợ khách hàng — 02/11/2026

- Khách đã đăng nhập mở `/support`, nhập tiêu đề (tối đa 150 ký tự) và nội dung
  (tối đa 4.000 ký tự), gửi yêu cầu rồi theo dõi phản hồi/trạng thái của chính mình.
- Admin mở `/admin/support` từ trang quản trị, đọc yêu cầu, trả lời và chọn
  **Đã tiếp nhận / Đang xử lý / Đã giải quyết**. Mỗi yêu cầu có một phản hồi quản
  trị có thể cập nhật; chưa có hội thoại nhiều tin nhắn, đính kèm hay thông báo email.
- Có liên kết Hỗ trợ trên menu, footer và tài khoản. Danh sách phân trang 20 yêu cầu.
- Nội dung được lưu dưới dạng văn bản và hiển thị bằng `textContent`; giữ CSRF,
  kiểm tra quyền admin và kiểm tra chủ sở hữu ở backend. Chưa chèn lỗi cho lab XSS.

Database mới được tạo bảng `support_tickets` từ `database/schema.sql`. Với
database/volume đã có dữ liệu, build image rồi chạy migration trước khi cập nhật
backend/frontend; không chạy lại schema hoặc seed:

```powershell
docker compose --env-file docker/.env -f docker/docker-compose.yml build backend frontend
docker compose --env-file docker/.env -f docker/docker-compose.yml run --rm --no-deps backend node scripts/migrate-support.cjs
docker compose --env-file docker/.env -f docker/docker-compose.yml up -d --no-deps backend frontend
```

API mới, tiếp tục dùng cookie HttpOnly và CSRF của ứng dụng:

| Phương thức | Endpoint | Quyền và mục đích |
|---|---|---|
| POST | `/api/support/tickets` | Khách gửi `{subject, message}`; owner lấy từ phiên |
| GET | `/api/support/tickets?before=<id>` | Danh sách của chính khách; `before` tùy chọn |
| GET | `/api/support/tickets/:id` | Chi tiết của chính khách; yêu cầu của người khác trả 404 |
| GET | `/api/support/admin/tickets?before=<id>` | Admin xem hộp thư khách hàng |
| PATCH | `/api/support/admin/tickets/:id` | Admin cập nhật `{status, reply}`; ít nhất một trường |

`status` là `open`, `in_progress` hoặc `resolved`. `reply` có tối đa 4.000 ký tự;
bỏ trường này sẽ giữ phản hồi cũ. Không dùng chuỗi rỗng để xóa phản hồi.
Các GET danh sách trả `{tickets, nextCursor}`. Request ghi cần Origin hợp lệ
và `X-CSRF-Token` như các API hiện tại.

Kiểm thử từ `backend`: `npm.cmd test` và `npm.cmd run test:support:mysql`.
Bộ thứ hai tự tạo rồi xóa container MySQL thử riêng, không sử dụng `.env`/DB
ứng dụng. Để kiểm thử trình duyệt, đặt `SUPPORT_UI_SMOKE=1` và cung cấp package
Playwright qua `PLAYWRIGHT_MODULE` nếu chưa có trong môi trường Node. Chrome
headless được dùng mặc định; có thể chọn channel bằng `SUPPORT_BROWSER_CHANNEL`.

## 1. Kiến trúc

```text
Trình duyệt — http://localhost:3000
    │
    ▼
Nginx gateway :80 (publish host :3000)
    │
    ▼
Frontend Express/EJS :3000
    │ proxy /api và /uploads
    ▼
Backend Express :3001
    │
    ▼
MySQL :3306 (chỉ trong Docker network)
```

| Service | Container | Truy cập từ máy chủ |
|---|---|---|
| gateway | webapp_gateway | http://localhost:3000 |
| frontend | webapp_frontend | Qua gateway, không publish cổng riêng |
| backend | webapp_backend | http://127.0.0.1:3001 |
| db | webapp_db | Không publish cổng MySQL |

Backend trong Docker dùng `DB_HOST=db`. Frontend dùng API cùng origin `/api`; không cần mua domain để chạy local. Gateway hiện publish cổng 3000 trên các interface máy chủ, nên máy khác trong LAN có thể truy cập nếu firewall cho phép.

## 2. Thư mục chính

```text
backend/               API, transaction, migration runner và kiểm thử
  src/                 Controller, middleware, cấu hình, helper
  scripts/             Công cụ migration
  test/                Kiểm thử thường và MySQL riêng
  uploads/             Ảnh upload, bind mount vào /app/uploads
frontend/              Express, EJS và JavaScript giao diện
database/              schema.sql, seeders và tài liệu migration
docker/                Dockerfile, Compose và cấu hình mẫu
gateway/               Cấu hình Nginx
test-artifacts/        Log, báo cáo và manifest baseline
READINESS-REVIEW.md     Lịch sử rà soát và kết quả
```

Database gồm bảy bảng: `users`, `categories`, `products`, `cart_items`, `orders`,
`order_items`, `support_tickets`.

## 3. Chuẩn bị môi trường

Cần Docker Desktop đang chạy. Git dùng để lấy/lưu code. Node.js 24 và npm cần khi chạy kiểm thử hoặc công cụ trực tiếp trên máy; chạy toàn bộ ứng dụng bằng Docker không cần cài MySQL/XAMPP.

Các lệnh PowerShell bên dưới chạy từ thư mục gốc dự án:

```powershell
cd D:\Project\NT120\web-clothing-store
docker --version
docker compose version
```

### Tạo cấu hình lần đầu

Chỉ tạo `docker/.env` nếu chưa có, tránh ghi đè cấu hình đang sử dụng:

```powershell
if (-not (Test-Path .\docker\.env)) {
    Copy-Item .\docker\.env.example .\docker\.env
}
notepad .\docker\.env
```

Điền các biến sau vào file:

| Biến | Giá trị hoặc ý nghĩa |
|---|---|
| NODE_ENV | `development` cho cấu hình HTTP local này |
| MYSQL_ROOT_PASSWORD | Mật khẩu root MySQL do bạn tự đặt |
| DB_NAME | `web-clothing-store` |
| DB_USER | Tài khoản ứng dụng, khác root |
| DB_PASSWORD | Mật khẩu tài khoản ứng dụng |
| JWT_SECRET | Chuỗi bí mật ngẫu nhiên, đủ dài |
| CSRF_TRUSTED_ORIGINS | Ví dụ `http://localhost:3000,http://127.0.0.1:3000` |

Nếu truy cập qua LAN, thêm đúng origin `http://<IP-máy-chủ>:3000` vào danh sách, phân cách bằng dấu phẩy. Thay IP minh họa trong file mẫu bằng IP thực tế.

Schema và seed hiện dùng cố định tên `web-clothing-store`; không chỉ đổi `DB_NAME` sang tên khác rồi kỳ vọng khởi tạo đúng. Với volume MySQL đã tồn tại, thay mật khẩu trong `.env` không tự đổi mật khẩu tài khoản trong database.

Không commit `.env`, mật khẩu, SQL backup hoặc dữ liệu riêng lên GitHub. File mẫu `.env.example` có thể đưa vào Git.

## 4. Khởi động lần đầu

```powershell
docker compose --env-file docker/.env -f docker/docker-compose.yml up -d --build
docker compose --env-file docker/.env -f docker/docker-compose.yml ps
```

Đợi cả bốn service chuyển sang `healthy`, sau đó mở **http://localhost:3000**.

MySQL chỉ chạy `schema.sql` và seed khi data directory mới hoàn toàn. Volume đã có dữ liệu sẽ không tự chạy lại các file này.

Seed tạo tài khoản demo local:

| Vai trò | Email | Mật khẩu demo |
|---|---|---|
| Admin | admin@webapp.lab | 123456 |
| User | hacker@webapp.lab | 123456 |

Đây là tài khoản mẫu trong seed, không bảo đảm còn đúng ở database đã thay đổi mật khẩu. Không dùng thông tin demo cho môi trường công khai.

## 5. Kiểm tra hoạt động và xem log

```powershell
# Backend có đang chạy không?
curl.exe -i http://127.0.0.1:3001/

# Backend có truy vấn được database không?
curl.exe -i http://127.0.0.1:3001/ready

# Kiểm tra API qua gateway
curl.exe -i http://localhost:3000/api/products

# Kiểm tra kết nối bằng CLI; thành công trả mã 0, lỗi trả mã 1
docker compose --env-file docker/.env -f docker/docker-compose.yml exec backend node test-db.js
$LASTEXITCODE

# Theo dõi log; Ctrl+C để thoát theo dõi
docker compose --env-file docker/.env -f docker/docker-compose.yml logs --tail 100 -f backend
```

`GET /` là kiểm tra tiến trình, có thể vẫn trả 200 khi database lỗi. `GET /ready` chạy `SELECT 1`, trả 200 hoặc 503; chưa kiểm tra toàn bộ schema/migration. Gateway `/health` chỉ kiểm tra Nginx.

## 6. Cập nhật code và migration

### Chỉ thay đổi code, không đổi schema

```powershell
docker compose --env-file docker/.env -f docker/docker-compose.yml up -d --build --no-deps backend frontend
docker compose --env-file docker/.env -f docker/docker-compose.yml ps
```

Sau cập nhật, tải lại trình duyệt bằng `Ctrl+F5`. Nếu có thay đổi schema, thực hiện migration phù hợp trước khi mở lại ứng dụng.

### Database cũ chưa có checkout_key

Bản hiện tại yêu cầu `orders.checkout_key` và UNIQUE `(user_id, checkout_key)`. Database tạo mới từ schema hiện tại đã có sẵn. Database cũ cần migration bổ sung; không import lại schema/seed lên dữ liệu đang dùng.

Trước khi chạy: sao lưu database và uploads, khôi phục thử sang MySQL riêng và diễn tập migration. Trong thời gian migration, dừng các tiến trình ghi dữ liệu. Sau khi đã xác nhận backup và diễn tập thành công:

```powershell
docker compose --env-file docker/.env -f docker/docker-compose.yml build backend frontend
docker compose --env-file docker/.env -f docker/docker-compose.yml stop backend frontend
docker compose --env-file docker/.env -f docker/docker-compose.yml run --rm --no-deps backend node scripts/migrate-checkout.cjs
```

Chỉ khi migration kết thúc thành công mới chạy:

```powershell
docker compose --env-file docker/.env -f docker/docker-compose.yml up -d --no-deps backend frontend
```

Migration giữ đơn cũ với khóa NULL và hỗ trợ chạy lại. MySQL DDL có implicit commit; lỗi giữa chừng cần kiểm tra trạng thái thực trước khi tiếp tục. Migration danh mục có quy trình riêng, gắn với deployment đã rà soát, không chạy tùy tiện trên database khác.

Xem [hướng dẫn migration, backup và phục hồi](database/migrations/README.md).

## 7. Hành vi nghiệp vụ và API

### Xác thực và phân quyền

JWT nằm trong cookie `token` HttpOnly. Backend đọc cookie, không dùng hướng dẫn Bearer token của README cũ. Request thay đổi dữ liệu cần origin được tin cậy và header `X-CSRF-Token`; lấy CSRF token tại `GET /api/auth/csrf`. Trình duyệt được giao diện xử lý tự động.

Đổi mật khẩu thu hồi phiên cũ, xóa cookie và yêu cầu đăng nhập lại. Giỏ hàng và đơn hàng được giới hạn theo chủ sở hữu. Các thao tác quản trị yêu cầu quyền admin.

| Nhóm | Endpoint chính |
|---|---|
| Xác thực | POST `/api/auth/register`, POST `/api/auth/login`, GET `/api/auth/csrf` |
| Tài khoản | GET/PUT `/api/users/me`, POST `/api/users/logout` |
| Sản phẩm | GET/POST `/api/products`, GET/PUT/DELETE `/api/products/:id` |
| Danh mục | GET/POST `/api/categories`, PUT/DELETE `/api/categories/:id` |
| Giỏ hàng | GET/POST `/api/cart`, PUT/DELETE `/api/cart/:id` |
| Đơn hàng | GET/POST `/api/orders`, GET `/api/orders/:id` |
| Hỗ trợ của khách | GET/POST `/api/support/tickets`, GET `/api/support/tickets/:id` |
| Hỗ trợ của admin | GET `/api/support/admin/tickets`, PATCH `/api/support/admin/tickets/:id` |

### Giỏ hàng, checkout và gửi lại request

Transaction và khóa MySQL bảo vệ cập nhật giỏ, tồn kho và đơn hàng. Tiền được tính bằng số nguyên chính xác; tổng trả về là chuỗi hai chữ số thập phân. Tổng vượt giới hạn `DECIMAL(10,2)` trả 422 và giữ nguyên giỏ/tồn kho.

`POST /api/orders` yêu cầu header **Idempotency-Key là UUID v4**:

- Thiếu khóa: 428; khóa sai định dạng: 400.
- Cùng người dùng và khóa đã tạo đơn: trả lại cùng phản hồi 201, mã đơn và tổng tiền; không tạo thêm đơn, không xóa giỏ mới.
- Lần đặt hàng mới cần khóa mới.
- Giao diện giữ khóa đang chờ trong sessionStorage theo người dùng và tab; giữ qua lỗi mạng/tải lại, xóa sau khi nhận thành công.

Xóa storage hoặc đổi tab có thể mất khóa đang chờ. Trước lần commit thành công đầu tiên, retry dùng giỏ hiện tại; đây không phải bản chụp giá/giỏ bất biến.

### Form admin và upload

Sản phẩm có `revision` lấy từ API, không phải cột cần migration. PUT phải gửi revision hiện tại: thiếu 428, sai định dạng 400, dữ liệu đã đổi 409. Cập nhật không đổi giá trị vẫn thành công. Giao diện giữ bản nháp khi xung đột.

Tên danh mục được bảo vệ bằng UNIQUE. Xóa sản phẩm đã bán trả 409 để giữ lịch sử đơn. Upload được kiểm tra nội dung ảnh, giới hạn dung lượng và dọn file khi thao tác thất bại. Ảnh nằm trong `backend/uploads`, được truy cập qua `/uploads`.

Các phản hồi thường gặp: 400 dữ liệu sai; 401 chưa đăng nhập; 403 thiếu quyền/CSRF/origin; 404 không tìm thấy hoặc không thuộc người dùng; 409 xung đột; 413 quá dung lượng; 415 loại file không hỗ trợ; 422 tổng tiền vượt giới hạn; 428 thiếu điều kiện; 429 quá số lần gọi; 500 lỗi nội bộ; 503 database/dịch vụ không sẵn sàng.

## 8. Kiểm thử

Dùng Node.js 24. Trên PowerShell dùng `npm.cmd` nếu `npm.ps1` bị chặn. Từ thư mục gốc:

```powershell
npm.cmd --prefix backend ci
npm.cmd --prefix frontend ci
npm.cmd --prefix backend test
```

Các suite MySQL phải chạy trên môi trường thử riêng. Đọc [hướng dẫn chuẩn bị và chạy kiểm thử](backend/test/README.md) trước khi chạy hai suite nghiệp vụ/danh mục; chúng cần container thử và trạng thái MySQL sẵn sàng:

```powershell
npm.cmd --prefix backend run test:mysql
npm.cmd --prefix backend run test:categories:mysql
```

Ba suite sau tự tạo MySQL tạm riêng bằng Docker để kiểm tra lỗi database,
khóa/gửi lại checkout và chức năng hỗ trợ, rồi dọn container của chúng:

```powershell
npm.cmd --prefix backend run test:availability:mysql
npm.cmd --prefix backend run test:recovery:mysql
npm.cmd --prefix backend run test:support:mysql
```

Không đổi cấu hình test để trỏ vào `webapp_db`. Không chạy đồng thời suite danh mục với migration hoặc backup diễn tập trên cùng server thử.

Kết quả ghi nhận ngày 29/10/2026, không phải cam kết cho mọi thay đổi sau đó:

| Kiểm tra | Kết quả |
|---|---|
| Test thường/HTTP/giao diện giả lập | 79/79 |
| Nghiệp vụ trên MySQL thật | 19/19 |
| Migration danh mục | 7/7 |
| DB availability | 6/6 kịch bản |
| Recovery, deadlock và migration checkout | 9 kiểm tra đạt |
| Cú pháp JS/CJS | 52 file đạt |
| npm audit runtime | Backend 0, frontend 0 cảnh báo tại lần kiểm tra |

Log và ảnh trình duyệt: [báo cáo baseline](test-artifacts/final-baseline-results.md). Phạm vi có kiểm thử trình duyệt một số luồng chính, chưa phải toàn bộ browser E2E.

Ngày **02/11/2026**, đã chạy lại **79/79 kiểm thử hồi quy** và hoàn thành
**16 nhóm kiểm tra hỗ trợ** trên MySQL/Chrome, gồm gửi yêu cầu, phản hồi,
trạng thái, owner/admin, CSRF, hiển thị văn bản và giao diện mobile.
Chi tiết: [kết quả hỗ trợ khách hàng](test-artifacts/support/RESULTS.md).

## 9. Dữ liệu, backup và khôi phục

### Lưu mã nguồn lên GitHub

Git repository nằm tại **`D:\Project\NT120`**, bên ngoài thư mục ứng dụng.
Remote `origin` hiện trỏ tới
[Vincent-Hansome/NT120.XX-Project](https://github.com/Vincent-Hansome/NT120.XX-Project).
Nhánh đang dùng trước lần backup này là `baseline-before-attack-chain-20261021`.
Tạo nhánh mới để lưu phiên bản có hỗ trợ khách hàng và giữ nguyên nhánh baseline.

Chạy trong PowerShell, lần đầu cho phiên bản này:

```powershell
Set-Location 'D:\Project\NT120'
git status --short
git remote -v
git switch -c codex/customer-support-20261102
git add -- .gitignore web-clothing-store
git diff --cached --stat
git diff --cached --name-only
```

Kiểm tra danh sách đã stage, bảo đảm không có `.env` thực, mật khẩu, SQL dump,
uploads hoặc thư mục backup. Lệnh `git add` ở trên chỉ chọn ứng dụng và quy tắc
ignore, không chọn `.slides-build` hay các log rời ở thư mục gốc.
Sau khi kiểm tra, tạo commit và đẩy nhánh lên GitHub:

```powershell
git commit -m "Add customer support tickets and update documentation"
git push -u origin codex/customer-support-20261102
```

Nếu đã tạo nhánh này trước đó, dùng `git switch codex/customer-support-20261102`
thay cho `git switch -c ...`. Những lần cập nhật tiếp theo trên nhánh này:

```powershell
Set-Location 'D:\Project\NT120'
git add -- .gitignore web-clothing-store
git diff --cached --stat
git diff --cached --name-only
git commit -m "Update clothing store project"
git push
```

Các lệnh trên backup **mã nguồn, schema/migration và tài liệu**. Database đang
chạy, ảnh upload và cấu hình `.env` cần bản sao riêng theo phần bên dưới để
khôi phục đầy đủ ứng dụng. Các lệnh commit/push này là hướng dẫn để bạn tự chạy.

### Sao lưu dữ liệu local

MySQL lưu trong named volume `db_data` (deployment đã kiểm tra có tên thực `docker_db_data`). Upload lưu bằng bind mount `backend/uploads`. Chỉ giữ image hoặc code chưa đủ để khôi phục dữ liệu.

```powershell
# Xem nơi lưu dữ liệu thực tế
docker inspect webapp_db --format '{{json .Mounts}}'
docker inspect webapp_backend --format '{{json .Mounts}}'

# Dừng mà giữ container/dữ liệu
docker compose --env-file docker/.env -f docker/docker-compose.yml stop

# Chạy lại
docker compose --env-file docker/.env -f docker/docker-compose.yml start
```

`docker compose ... down` không có `-v` giữ named volume, nhưng cần dùng lại đúng Compose project để gắn đúng volume. Không dùng `down -v`, xóa volume hoặc chạy seed lại như cách sửa lỗi ứng dụng.

Backup cần SQL nhất quán, ảnh uploads, cấu hình bí mật được giữ kín và phiên bản code/image tương ứng. Xác minh SHA-256, restore vào database riêng, đối chiếu dữ liệu/ảnh, diễn tập migration và thử ứng dụng trước khi chuyển sang bản phục hồi. Không import đè database đang dùng.

Baseline **nt120-local-20261029-v1** đã lưu ngoài repository tại:

```text
D:\Project\NT120\web-clothing-store-backups\checkout-2026-10-29T05-31-28-357Z
```

Gồm `baseline-source.zip`, `baseline-images.tar`, checksum, SQL, uploads và cấu hình riêng. SQL này được lấy trước migration checkout, nên khi restore để dùng code hiện tại cần áp dụng migration checkout và migration hỗ trợ `scripts/migrate-support.cjs`. Snapshot này chưa chứa các yêu cầu hỗ trợ phát sinh sau ngày lưu. Không đưa thư mục backup hoặc cấu hình bí mật lên GitHub.

Manifest của snapshot nằm tại [final-baseline-manifest.json](test-artifacts/final-baseline-manifest.json). README đang đọc được cập nhật sau snapshot v1; snapshot v1 giữ nguyên để bảo toàn checksum, chưa bao gồm lần sửa README này.

## 10. Xử lý lỗi thường gặp

| Hiện tượng | Cách kiểm tra |
|---|---|
| Pull image báo TLS handshake timeout/EOF | Kiểm tra kết nối Docker Desktop tới Docker Hub, proxy/VPN/DNS rồi thử `docker pull node:24-alpine`; lỗi HTTPS của registry không yêu cầu website local dùng HTTPS |
| Lỗi origin/CSRF 403 | Dùng đúng địa chỉ đã khai báo trong `CSRF_TRUSTED_ORIGINS`, cập nhật container backend nếu đổi cấu hình |
| Thiếu bảng/cột/index | Xác nhận đúng DB và migration; file init không tự chạy lại trên volume cũ |
| Backend unhealthy hoặc 503 | Xem log backend/db và thử `/ready`; `/` trả 200 chưa chứng minh DB hoạt động |
| Ảnh 404 | Kiểm tra file trong `backend/uploads` và đường dẫn `/uploads`; backup SQL không chứa nội dung ảnh |
| Giao diện còn code cũ | Build lại frontend/backend cần thiết, kiểm tra container và tải `Ctrl+F5` |

## 11. Phạm vi nghiệm thu và tài liệu

Đã nghiệm thu cho demo local theo các bằng chứng nêu trên. Những giới hạn giữ lại:

- Charset dữ liệu seed khi import chưa sửa theo lựa chọn người dùng; nhập tiếng Việt qua web đã được kiểm tra.
- Giá trong chi tiết đơn được lưu tại thời điểm mua; tên và ảnh sản phẩm của đơn cũ vẫn lấy từ sản phẩm hiện tại.
- Chỉ đo tải đọc nhỏ 100 request/10 đồng thời; chưa có kiểm thử tải kéo dài hoặc cam kết thông lượng checkout.
- Đã thử mất HTTP response sau commit; chưa tiêm lỗi mất MySQL COMMIT ACK ở mức kết nối.
- Chưa nghiệm thu HTTPS/production, phục hồi ngoài máy hoặc PITR/binlog; readiness không thay thế kiểm tra migration.

Tài liệu liên quan:

- [Rà soát readiness](READINESS-REVIEW.md)
- [Kết quả baseline và checklist 10 mục](test-artifacts/final-baseline-results.md)
- [Chạy kiểm thử hồi quy](backend/test/README.md)
- [Migration và phục hồi](database/migrations/README.md)
- [Kiểm chứng và triển khai hỗ trợ khách hàng](test-artifacts/support/RESULTS.md)

Nếu làm lab attack chain tiếp theo, dùng bản sao môi trường và dữ liệu riêng, giữ baseline này để đối chiếu và khôi phục.
