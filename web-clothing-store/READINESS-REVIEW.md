# Đánh giá nền tảng trước khi triển khai attack chain

## Baseline local đã khắc phục checkout retry và dependency — 29/10/2026

Đã áp dụng migration bổ sung orders.checkout_key + UNIQUE(user_id, checkout_key)
và cập nhật đồng bộ backend/frontend Docker. Cùng mã checkout trả lại đơn cũ,
kể cả sau khi giỏ được thêm hàng; không tạo đơn thứ hai hoặc xóa giỏ mới. Client
giữ mã qua lỗi/tải lại trong cùng tab, xóa khi thành công. Đơn cũ giữ key NULL.
Đã backup SQL/ảnh, restore và chạy migration hai lần trên bản sao; đối chiếu
hash toàn bộ dữ liệu cũ và ảnh trước/sau áp dụng. Không xóa/reset DB/volume.

Đã vá multer 2.5.0, body-parser 2.4.0, qs 6.17.1; audit runtime của cả backend
và frontend bằng 0 tại lượt này. Kiểm thử: **79/79 unit/HTTP/UI, 19/19 MySQL,
7/7 danh mục, 6 kịch bản availability và 9 kiểm tra khóa/response-loss/migration
đều đạt**, 52 file đúng cú pháp. Browser fixture checkout thành công; bốn service
chính healthy, readiness 200, nguồn runtime/lockfile khớp workspace.

Phiên bản lưu: **nt120-local-20261029-v1**, chưa commit/push. Phạm vi nghiệm thu
là baseline demo local theo các giới hạn đã ghi; không tuyên bố toàn website
ổn định tuyệt đối hoặc sẵn sàng production. Import seed giữ nguyên theo yêu cầu;
tên/ảnh đơn cũ dùng sản phẩm hiện tại theo lựa chọn của người dùng.
Xem [kết quả cuối và checklist đầy đủ](test-artifacts/final-baseline-results.md),
[manifest phiên bản](test-artifacts/final-baseline-manifest.json).

## Khóa thật và mất phản hồi checkout — 29/10/2026

Đã kiểm chứng trên MySQL tạm riêng: server lock-wait timeout trả HTTP 409 sau
1032 ms; deadlock InnoDB thật chọn checkout làm victim và API trả 409. Cả hai
giữ nguyên giỏ/kho, không tạo đơn dở; giải phóng khóa rồi checkout lại thành công.

Proxy làm rơi HTTP response sau khi backend commit và phát 201: DB vẫn có một
đơn. Gửi lại khi giỏ trống trả 400, không tạo đơn thứ hai. **Nếu giỏ được thêm
hàng trước khi gửi lại cùng yêu cầu checkout cũ, API tạo đơn mới (201).** Hiện
chưa có idempotency key để phân biệt retry và ý định đặt mới; điều kiện retry
an toàn chưa đạt. Không tự sửa nghiệp vụ/schema trong lượt kiểm tra này.

Test `npm.cmd run test:recovery:mysql` cố ý trả exit 2 khi tái hiện khoảng trống
đó; không kết luận toàn bộ kiểm thử đạt. Container riêng đã dừng; không thay đổi
dữ liệu hoặc container webapp. Xem [kết quả và log](test-artifacts/checkout-recovery-results.md).

## Áp dụng backend và xác minh Docker — 29/10/2026

Đã build và recreate riêng backend bằng Compose `up -d --build --no-deps backend`
theo yêu cầu tiếp tục của người dùng. Bốn service chính đều healthy; DB, frontend,
gateway không được recreate. Backend mới: `/ready` 200 với status ready;
catalog 200 có 8 sản phẩm; test-db kết nối thật trả 0, chạy với DB_PORT=1 chỉ
trong tiến trình thử trả 1. Inspect xác nhận healthcheck thực dùng `/ready`.
Chính image mới được chạy riêng với network none và DB không tồn tại: readiness
503 trong 99 ms, catalog 503 trong 7 ms, không lộ nội bộ. Không pause DB website.
Mục "chưa deploy" ở báo cáo đợt sửa bên dưới được thay thế bởi cập nhật này.

Build/npm audit phát hiện 3 advisory dependency backend runtime còn cần đánh giá:
body-parser (high, GHSA-27r3-jxmh-p828), multer (high, GHSA-q7qp-rjg7-q26m),
qs (moderate, GHSA-6pq8-jhm2-2vcw). Đây là kết quả audit package, chưa phải bằng
chứng tất cả đường khai thác đều reachable trong ứng dụng. Chưa sửa dependency
hay chạy audit fix. Chưa chốt toàn bộ baseline. Xem
[biên bản triển khai và phần còn mở](test-artifacts/backend-deployment-20261029.md).

## Sửa readiness, exit code và timeout DB — 29/10/2026

Theo yêu cầu người dùng, giữ nguyên phần import seed; chỉ sửa ba mục DB availability.
Đã bổ sung `/ready` 200/503 phụ thuộc DB và chuyển backend Compose healthcheck
sang endpoint này; `test-db.js` đóng pool và trả exit code 0/1 đúng; pool giới hạn
10 active/50 queued, chờ lấy kết nối 1 s, mỗi truy vấn/lệnh transaction 3 s,
readiness query 1 s. Hủy waiter hết hạn và đóng socket timeout/đến trễ; API trả
503 khi DB không sẵn sàng. Không tự retry write/COMMIT.

Kiểm thử lại: **74/74 test thường, 15/15 MySQL nghiệp vụ, 7/7 MySQL danh mục,
6/6 kịch bản availability, 49 file đúng cú pháp**. MySQL riêng bị pause cho
readiness 503 ~1,0 s và catalog 503 ~3,0 s; unpause trở về 200. Đã kiểm chứng queue
đầy không thực thi write hết hạn và rollback transaction bị timeout trên MySQL thật.
Xem [kết quả, giới hạn và log](test-artifacts/availability-results.md),
[hướng dẫn chạy lại](backend/test/README.md).

Bản sửa nằm trong workspace; chưa rebuild/deploy backend hiện có. `/` giữ vai trò
liveness, không dùng để kết luận DB sẵn sàng. Không sửa seed, dữ liệu website,
không commit/push. Các kết quả cũ bên dưới về thiếu timeout/readiness/exit code
là lịch sử trước bản sửa này, còn hiệu lực trên image cũ cho đến khi cập nhật.

## Sửa danh mục trùng và migration volume Docker — 28/10/2026

**Đã hoàn tất và áp dụng vào database Docker hiện có trong phạm vi lỗi danh mục.**
Phiên bản schema logic: `20261028_categories_name_unique`; index thực
`uq_categories_name(name)` đã xác minh UNIQUE toàn cột, không prefix. Backend
thực kết nối `db:3306` / `web-clothing-store`, MySQL 8.0.46, UUID
`290bb158-c262-11f1-bd83-5a080e03a6aa`. Nguyên nhân: volume cũ chưa được migration;
`schema.sql` có UNIQUE nhưng script khởi tạo không chạy lại trên volume cũ.
Controller đã có nhánh 1062/ER_DUP_ENTRY → 409, nên không sửa logic auth hay controller.

Đã đọc source, schema/index/FK thật và mọi nơi tham chiếu danh mục. Chỉ có
`products.category_id → categories.id`, ON DELETE SET NULL. Cột tên giữ nguyên
`utf8mb4_general_ci`; không áp collation default `utf8mb4_unicode_ci` lên bảng cũ.
Migration giữ MIN(id), chuyển mọi FK trước khi xóa ID dư, kiểm tra toàn bộ hàng
nghiệp vụ trong bộ nhớ, nhận biết unique index tương đương và chạy lại an toàn.

Đã dừng backend, bật `read_only` sau khi kiểm tra phiên/event/database phụ, chứng
minh tài khoản ứng dụng bị MySQL từ chối ghi categories/products. Dùng khóa bảng
cho DML, giữ fence qua COMMIT và ALTER. **DDL có implicit commit; không có cam
kết rollback toàn bộ migration bằng một transaction.** Nếu thất bại, giữ fence
và dịch vụ dừng để rà soát/chạy lại. Năm database phụ không đổi theo hash dữ liệu.

Backup trước thay đổi đã restore vào database riêng, đối chiếu dữ liệu/cột/
collation/index/FK/DDL và thử migration hai lần thành công rồi mới áp dụng live.
Backup được giữ tại:

```text
D:\Project\NT120\web-clothing-store-backups\categories-2026-10-28T14-42-07-038Z.sql
SHA-256 c2e4f12b6b21c9e9ca64e8c569ca6e77bbeda943addc68f3f52fc5642ce89bc0
```

Có file `.sha256` và `.report.json` cùng đường dẫn; thư mục private ACL, nằm
ngoài Git, không in secret hoặc dữ liệu người dùng. Đã chạy lại thành công lệnh
khôi phục được tài liệu hóa. [Quy trình migration và khôi phục đầy đủ](database/migrations/README.md).

| Đối chiếu dữ liệu | Trước | Sau và sau dọn fixture |
|---|---:|---:|
| Danh mục / nhóm trùng | 4 / 1 | 3 / 0 |
| Sản phẩm / liên kết danh mục / mồ côi | 4 / 4 / 0 | 4 / 4 / 0 |
| Đơn / chi tiết đơn / giỏ / người dùng | 11 / 16 / 1 / 6 | 11 / 16 / 1 / 6 |

Giữ ID 1, xóa ID dư 4; ID 4 không có sản phẩm tham chiếu nên live chuyển 0 liên
kết. Toàn bộ dữ liệu hàng khác khớp kỳ vọng, không chỉ so số lượng. Backend đã
restart, read_only đã trả OFF và cả bốn container ứng dụng healthy. Không rebuild
hoặc triển khai những thay đổi source khác đang chờ trong workspace.

Kiểm thử: **64/64 test thường; 7/7 test MySQL mới**, gồm schema cũ có sản phẩm
tham chiếu cả hai ID, chuyển FK phụ, giữ nguyên giỏ/đơn/sản phẩm, không mồ côi,
chạy lại no-op, collation thật và chặn ghi giữa DML COMMIT/DDL. API workspace
và API Docker thực qua fixture riêng đều xác nhận: tạo trùng **409**, sửa thành
tên đang có **409**, hai request đồng thời **201/409**, tên khác **201**, cập
nhật không đổi **200**. Fixture admin/danh mục đã dọn, hash hàng nghiệp vụ trước
và sau smoke khớp; bộ đếm AUTO_INCREMENT có thể tăng do fixture.
Log trong [test-artifacts/category-migration](test-artifacts/category-migration/RESULTS.md).

Giới hạn: chưa kiểm thử cutover phục hồi dịch vụ, backup off-host/PITR/RTO/RPO,
tải cao hoặc crash giữa DDL; backup SQL chưa mã hóa. Không nghiệm thu lại toàn
bộ website/TLS/browser E2E. Không xóa/reset DB/volume, không seed, không tắt FK,
không đổi authentication/authorization/CSRF, không triển khai attack chain và
không commit/push. Những phần báo cáo cũ bên dưới là lịch sử; phần cập nhật này
chỉ thay thế các nhận định cũ về lỗi danh mục và backup/migration trong phạm vi này.

## Kiểm thử lại độc lập — 26/10/2026

Đã chạy lại trên workspace: **64/64 test thường, 15/15 test MySQL thật và 39 file JS/CJS kiểm tra cú pháp đều đạt**. Browser Edge xác nhận đăng nhập → quick-add (hết hàng/thành công) → tăng số lượng giỏ → checkout → chi tiết đơn 24,68 ₫. Không sửa mã ứng dụng hay dữ liệu stack gốc.

**Stack localhost:3000 vẫn chưa trả revision trong catalog, nên không áp dụng kết quả nghiệm thu workspace cho bản đang chạy đó.** Chưa hoàn tất backup/restore, tải cao, migration, TLS và browser E2E đầy đủ; chưa chốt toàn bộ checklist. Xem [kết quả và giới hạn của lượt kiểm tra mới](test-artifacts/recheck/RESULTS.md), [log test thường](test-artifacts/recheck/unit-tests.txt), [log MySQL](test-artifacts/recheck/mysql-tests.txt).

## Kết quả sau đợt sửa nghiệp vụ và HTTP response — 26/10/2026

**Đã hoàn tất phạm vi 8 mục sửa được yêu cầu trên mã workspace và môi trường test riêng. Chưa chốt toàn bộ website là baseline ổn định hoặc sẵn sàng production.** Bản sửa chưa được đưa lên stack hiện tại; không commit/push/deploy. Các ghi nhận trước đợt sửa được lưu nguyên bên dưới dưới nhãn lịch sử, không mô tả trạng thái mã mới.

Đã đọc README, báo cáo cũ và source hiện tại; không tìm thấy AGENTS.md áp dụng trong các thư mục cha/repository đã kiểm tra. Báo cáo được đối chiếu với mã, không coi các suy luận trước đó là bằng chứng dữ liệu thật đã bị sai. Workspace có thay đổi từ trước, gồm các thay đổi bảo vệ và nhiều node_modules đã staged xóa; không khôi phục hay sửa các phần ngoài phạm vi. Không dùng tài khoản, giỏ, đơn hoặc tồn kho của stack hiện tại để thử.

### Hành vi đã sửa

| Phạm vi | Hành vi sau sửa và bằng chứng |
|---|---|
| Giỏ hàng | Mọi add/update/delete và checkout khóa hàng users của chủ giỏ trong transaction, kể cả giỏ trống. Add đọc lượng hiện tại và kiểm tra stock dưới khóa sản phẩm; update kiểm tra stock dưới cùng khóa. Hai lần thêm giữ đủ cả hai phần tăng, không tạo dòng trùng. Vượt stock/INT trả 409; quantity đầu vào không hợp lệ trả 400; đối tượng thiếu trả 404. Cart không giữ chỗ tồn kho; checkout luôn kiểm tra lại. |
| Admin tồn kho | GET/list trả revision SHA-256 của nội dung sản phẩm, có stock. PUT so sánh revision với hàng hiện tại khi đang giữ FOR UPDATE. Không cần thêm cột hay migration. Form cũ trả 409, không ghi đè stock/metadata; giao diện giữ bản nháp, tải danh sách mới và yêu cầu bấm Sửa để xem lại. Thiếu revision trả 428; sai định dạng trả 400; form mới/no-op trả 200. Đây là dấu nội dung, không phải số phiên bản tăng dần: nếu toàn bộ nội dung quay về đúng trạng thái cũ thì token lại giống nhau, nhưng không ghi đè một stock khác hiện tại. |
| Checkout | Tính bằng BigInt theo đơn vị 1/100. Tổng tối đa 99.999.999,99 theo orders.total DECIMAL(10,2); vượt giới hạn trả 422 và giữ giỏ/kho. total response là chuỗi hai chữ số thập phân. Giỏ trống 400; thiếu hàng 409; deadlock/lock timeout 409 để thử lại. Sản phẩm được khóa theo id tăng dần; không oversell trong các ca đã chạy. |
| Transaction | getConnection nằm trong luồng bắt lỗi. Helper commit/rollback và release trong finally; rollback thất bại thì hủy connection thay vì trả về pool. Lỗi MySQL thật được kích hoạt sau khi ghi order, item và trừ stock: rollback không để lại đơn/item dở, khôi phục stock và giữ toàn bộ giỏ. Có test vòng đời acquire/BEGIN/work/COMMIT/ROLLBACK lỗi. |
| CRUD catalog | Update kiểm tra tồn tại dưới khóa, không dùng changedRows để kết luận 404; no-op hợp lệ trả 200. Delete không tìm thấy trả 404. Upload mới được dọn nếu validation, 404, xung đột hoặc DB thất bại. Test upload MySQL dùng thư mục tạm riêng. Category FK thay đổi trong thao tác được xử lý thành lỗi 400 phù hợp. |
| Xóa sản phẩm đã bán | Giữ nguyên FK bảo vệ lịch sử. MySQL từ chối xóa được ánh xạ 409 với thông báo giữ lịch sử; không thêm cascade vào orders/order_items. Đã xác nhận order, item, product và giỏ khách khác còn nguyên sau yêu cầu xóa. |
| Đổi mật khẩu | Tiếp tục tăng token_version, xóa cookie sau khi DB thành công, trả reauthenticate=true. Form thành công chuyển /login?reason=password-changed; trang đăng nhập giải thích các phiên đã bị thu hồi. Mật khẩu sai/DB lỗi không báo thành công. |
| API client / HTTP errors | Error giữ status và data, kể cả lỗi lấy CSRF/non-JSON gateway. Quick-add chỉ chuyển login với 401; lỗi hết hàng, CSRF, 5xx và mạng hiển thị tại trang, cho thử lại và xóa lỗi cũ khi thử lại. Chi tiết sản phẩm cũng chỉ yêu cầu login khi 401. JSON không hợp lệ 400; vượt giới hạn JSON 100 KiB hiện có 413; lỗi nội bộ 500 chung, không phản chiếu body, SQL hay stack. Tiền trên giao diện hiển thị tối đa hai chữ số thập phân. |

Authentication, authorization, CSRF, SQL tham số hóa, output encoding và các giới hạn/kiểm tra/chuẩn hóa upload được giữ. Không thêm chức năng attack chain hay thay đổi cơ chế bảo vệ để phục vụ test.

### Kiểm thử đã chạy và kết quả

- Backend `npm.cmd test`: **64/64 đạt**. Giữ đủ 38 test cũ (điều chỉnh fake DB cho transaction và payload revision mới, không dùng fake để kết luận về InnoDB), bổ sung HTTP 400/413/500, API status, quick-add, bản nháp/revision admin, form đổi mật khẩu và vòng đời connection. Suite MySQL mặc định được loại khỏi lệnh này; chạy riêng bằng lệnh kế tiếp.
- Backend `npm.cmd run test:mysql`: **15/15 đạt**, không skip. MySQL **8.0.46**, InnoDB, STRICT_TRANS_TABLES, REPEATABLE-READ. Container `nt120-baseline-mysql-20261026` có `mounts=[]` và tmpfs `/var/lib/mysql`, cổng `127.0.0.1:13316`, DB `nt120_baseline_test`; không kết nối DB hiện hữu. Fixture mới cho mỗi ca, không seed/copy dữ liệu thật, không DROP/reset database hay xóa volume.
- Cạnh tranh thật: hai add khi giỏ trống/đã có hàng; add vượt món cuối; update tuyệt đối cùng add; hai khách checkout món cuối; hai checkout cùng giỏ; add trong lúc checkout; update trước checkout; update/delete trong lúc checkout giữ khóa; admin cũ trong lúc checkout giữ khóa sản phẩm. Các điểm chờ dùng query thật và đợi request cạnh tranh gửi câu khóa trước khi giải phóng transaction đầu, không giả lập SQL.
- Biên: số lượng 0/âm/lẻ/quá INT; INT tối đa rồi thêm tiếp; giá 0; 0,10 × 3 và 0,10 + 0,20; tổng đúng 99.999.999,99; tổng 100.000.000,00 và lớn hơn. Kiểm tra phản hồi lẫn trạng thái giỏ, orders/order_items và stock.
- Constraint/rollback/upload: FK xóa sản phẩm đã có đơn, category ON DELETE SET NULL, UNIQUE tên danh mục, no-op update, thiếu đối tượng, upload thất bại ở 400/404/409/500 và upload thành công. Trigger chỉ tác động fixture trong DB test để tạo lỗi giữa transaction. Thư mục upload tạm được dọn đúng các file test đã tạo.
- Browser Edge qua frontend/proxy thật tại `localhost:13330`: đăng nhập khách, quick-add hết hàng giữ trang và hiện lỗi, quick-add thành công, đổi số lượng giỏ, checkout, lịch sử/chi tiết đơn (24,68 ₫), đăng nhập admin, form cũ 409 giữ bản nháp sau checkout cạnh tranh, form tải mới lưu thành công và stock vẫn 2. Sau khi đổi mật khẩu fixture qua API, cookie cũ bị từ chối; quick-add 401 chuyển login; trang thông báo đăng nhập lại hiển thị đúng.
- Form đổi mật khẩu được kiểm thử sự kiện submit/redirect/thất bại bằng DOM harness. Thay mật khẩu, xóa cookie, thu hồi phiên và đăng nhập mật khẩu mới đã kiểm thử API với MySQL thật. Không submit thay mật khẩu trực tiếp bằng thao tác browser. Lỗi quick-add 403/5xx/mạng được kiểm thử bằng harness; browser trực tiếp xác nhận 401/409/thành công.
- `node --check`: **39 file JS/CJS đạt**. `git diff --check` trên các file thuộc đợt sửa đạt; không chuẩn hóa các file ngoài phạm vi có CRLF/thay đổi từ trước.
- Bằng chứng: `test-artifacts/baseline/unit-tests.txt`, `mysql-tests.txt`, `admin-conflict.jpg`, `password-login-notice.jpg`. Các lỗi ER_SIGNAL_EXCEPTION trong log là lỗi fixture cố ý để xác nhận rollback, không phải lỗi suite.
- Sau kiểm thử đã dừng storefront test và MySQL test tmpfs, đóng tab kiểm thử; không xóa volume. Bốn container gốc vẫn running/healthy, uptime liên tục qua đợt sửa. Hướng dẫn khởi động lại môi trường test nằm trong README của bộ test.

### File chính và cách chạy lại

- Backend: `controllers/cartController.js`, `orderController.js`, `productController.js`, `categoryController.js`, `userController.js`; `utils/transaction.js`, `money.js`, `productRevision.js`; `app.js`; `config/db.js`, `uploads.js`; `middlewares/uploadMiddleware.js`.
- Frontend: `public/js/api.js`, `public/js/store.js`, `views/admin/products.ejs`.
- Test: `backend/test/authentication.test.js`, `mysql.test.js`, `client.test.js`, `transaction.test.js`, `run-mysql.cjs`, `serve-ui.cjs`, `README.md`; `backend/package.json`.
- Hướng dẫn môi trường tách biệt và hợp đồng API mới: [backend/test/README.md](backend/test/README.md). Cần phối hợp frontend/backend khi triển khai sau này vì PUT sản phẩm bắt buộc revision và checkout total là chuỗi decimal. Không có migration mới, không sửa schema/seed của dữ liệu hiện tại trong đợt này.

### Giới hạn và việc còn lại

1. Kết quả xác nhận phạm vi nghiệp vụ/HTTP trên mã workspace và fixture test, không xác nhận toàn bộ website ổn định, không chứng minh hết lỗ hổng. Không load/stress/soak test, không thử mọi lịch xen kẽ hay lỗi mạng mất phản hồi COMMIT.
2. Chưa kiểm thử triển khai bản sửa qua Nginx/TLS của stack thật; không rebuild/restart stack hiện tại. Chưa nghiệm thu HTTPS, readiness DB/schema, cấu hình DB_NAME với tên SQL cố định, dependency advisory mới nhất, backup/restore hoặc nâng cấp volume cũ. Các mục 8–10 của bản rà soát cũ vẫn là việc riêng chưa xử lý trong phạm vi này.
3. Tên/ảnh lịch sử đơn vẫn join products; đổi metadata có thể làm tên/ảnh đơn cũ thay đổi. Đợt này bảo toàn bản ghi đơn bằng 409 khi xóa, chưa thêm snapshot lịch sử bất biến hay soft delete.
4. Chưa có browser E2E tự động đầy đủ cho mọi trang/thiết bị, upload qua hộp thoại native, hoặc submit đổi mật khẩu trực tiếp trong browser. DOM harness là kiểm thử sự kiện JavaScript, không thay thế mọi kiểm chứng trình duyệt. Không áp dụng kết quả test development/test HTTP cho cookie Secure production.
5. Vẫn có cảnh báo Node DEP0060 từ đường proxy test; không nâng dependency ngoài phạm vi. Giỏ không giữ chỗ tồn kho là chính sách hiện tại, nên checkout có thể trả 409 nếu khách khác mua trước.
6. Cần người dùng rà soát toàn bộ thay đổi chưa commit trước khi chốt baseline. Không tự commit, push, deploy hay triển khai attack chain.

---

## Bản rà soát trước đợt sửa — lưu nguyên để đối chiếu

**Các kết luận, số test và trạng thái lỗi bên dưới là lịch sử trước đợt sửa; trạng thái hiện tại được mô tả ở phần cập nhật phía trên.**

Ngày: 26/10/2026. Kết luận: **CHƯA ĐẠT điều kiện chốt baseline ổn định**.

## Cập nhật sau khi bật Docker

Kiểm tra lại ngày 26/10/2026 sau khi người dùng bật Docker:

- Cả db, backend, frontend và gateway đều running/healthy. `backend node test-db.js` truy vấn MySQL thành công.
- So sánh SHA-256: backend server.js và toàn bộ src; frontend server.js, views và public đều khớp giữa workspace và container đang chạy.
- Qua gateway localhost:3000: `/`, `/products`, `/login`, `/api/products`, `/api/categories`, `/api/auth/csrf` trả 200. `/api/users/me`, `/api/orders`, `/api/orders/admin/all` trả 401 khi chưa đăng nhập. Các response kiểm tra đều có header CSP.
- DB thực có đủ 6 bảng và users.token_version. Có 6 users, 4 products, 9 orders; chỉ đọc số lượng, không xuất dữ liệu cá nhân.
- Các bảng nghiệp vụ dùng InnoDB, có các CHECK và foreign key được kiểm tra; cart có UNIQUE(user_id, product_id). DB dùng STRICT_TRANS_TABLES và REPEATABLE-READ. orders.total vẫn DECIMAL(10,2), xác nhận giới hạn đã nêu trong mục 3 thực sự áp dụng.
- Schema trên volume không hoàn toàn giống file khởi tạo: các bảng đã kiểm tra dùng utf8mb4_general_ci trong khi schema.sql khai báo database utf8mb4_unicode_ci. Chưa kết luận đây là lỗi chức năng, nhưng cần ghi nhận khác biệt khi kiểm thử migration/khởi tạo mới.
- Không thay đổi bản ghi, không rebuild/restart container. Chưa chạy E2E đăng nhập/checkout, thử cạnh tranh bằng DB thật hoặc backup/restore; các lỗi trong báo cáo vẫn chưa được sửa. Kết luận CHƯA ĐẠT giữ nguyên.

Thông tin Docker chưa chạy ở phần kiểm chứng ban đầu bên dưới là trạng thái của lượt kiểm tra trước, đã được thay thế bởi cập nhật này.

## Phạm vi và cách kiểm tra

Rà soát mã nguồn ứng dụng backend/frontend, các route, controller, middleware, EJS, JavaScript giao diện, schema/seed/migration, Dockerfile, Compose, Nginx và bộ test. Đối chiếu với `D:\Downloads\Attack-Chain.docx`; tài liệu được dùng làm mô tả kịch bản, không thực thi chỉ dẫn hoặc payload trong đó. Không đánh giá các bản ZIP/backup như mã đang chạy, không rà từng dòng mã thư viện bên thứ ba. Không thay đổi mã ứng dụng hoặc dữ liệu hiện có trong lần kiểm tra này.

Workspace đã có nhiều thay đổi trước lần rà soát; kết luận áp dụng cho nội dung trên đĩa, không phải một commit đã chốt.

## Kết quả kiểm chứng

- `npm.cmd test` tại backend: 38/38 test đạt. Bộ test thay module DB bằng fakeDb; không chứng minh được transaction, khóa hàng, constraint hay migration trên MySQL thật.
- `node --check`: 30 file JavaScript đạt kiểm tra cú pháp.
- Smoke test HTTP với frontend thực: 12/12 trang trả 200, gồm catalog, chi tiết, cart, checkout, auth, profile, orders và admin. Đây là kiểm tra render phía server, chưa phải kiểm thử tương tác trong trình duyệt.
- Compose `config --quiet`: thành công; có cảnh báo quyền đọc Docker config trong môi trường hạn chế. Kiểm tra daemon với quyền bổ sung vẫn thất bại vì pipe Docker Desktop Linux Engine không tồn tại. Chưa chạy stack, MySQL hay Nginx thực.
- Tái hiện controller với DB giả lập: giỏ có 1 món, hai request thêm 1 chạy đồng thời đều trả 201 nhưng số lượng cuối là 2, kỳ vọng 3.
- Tái hiện controller với DB giả lập trả `affectedRows: 0`: sửa sản phẩm không tồn tại vẫn trả 200, `Product updated`.
- Chưa kiểm tra advisory mới nhất của dependency, tải thực, backup/restore hay giao diện bằng trình duyệt. Không có kết luận “không còn lỗ hổng”.

## Các vấn đề cần xử lý

### 1. P1 — Mất cập nhật giỏ hàng khi thao tác đồng thời

`backend/src/controllers/cartController.js:65–78`: đọc quantity rồi ghi newQty bằng câu UPDATE riêng, không transaction/khóa hay phép cộng nguyên tử. Hai request có thể cùng đọc quantity cũ và ghi cùng kết quả. Đã tái hiện bằng fake DB; cần bổ sung test MySQL thật. Sửa bằng thao tác nguyên tử hoặc transaction với khóa và kiểm tra stock nhất quán. UNIQUE chỉ ngăn trùng dòng, không ngăn mất cập nhật.

### 2. P1 — Sửa sản phẩm có thể ghi đè tồn kho đã được checkout trừ

`backend/src/controllers/productController.js:182`: form sửa sản phẩm luôn ghi lại stock tuyệt đối. Nếu admin mở form khi stock=10, checkout giảm còn 9, rồi admin chỉ đổi tên và lưu form cũ, stock lại thành 10. Khóa trong checkout không bảo vệ một form đã tải trước đó. Đây là đường đi xác định từ mã, chưa thử trên DB thật. Cần quản lý điều chỉnh tồn kho riêng hoặc kiểm tra phiên bản/xung đột cập nhật.

### 3. P2 — Tổng đơn hàng hợp lệ ở đầu vào có thể vượt kiểu dữ liệu

`backend/src/controllers/orderController.js:35–39` và `database/schema.sql:87`: giá sản phẩm được phép tới 99,999,999.99, nhưng tổng đơn cũng chỉ DECIMAL(10,2). Mua 2 món ở mức giá đó vượt giới hạn; controller không kiểm tra trước khi INSERT, dẫn tới lỗi DB/500 trong chế độ strict. Cần quy định giới hạn tổng đơn, trả lỗi rõ ràng hoặc migration kiểu dữ liệu phù hợp; dùng phép tính tiền chính xác. Transaction có rollback nên đây không phải bằng chứng dữ liệu đã bị ghi dở.

### 4. P2 — CRUD báo thành công dù đối tượng không tồn tại

`productController.js:191–202`, `categoryController.js:56–68`: không kiểm tra affectedRows/existence cho update/delete. Đã tái hiện update product. Khi update có upload, còn có thể giữ file không gắn với sản phẩm nào. Cần trả 404 cho đối tượng không tồn tại và dọn file tương ứng; vẫn cho phép cập nhật không đổi giá trị trên đối tượng có thật.

### 5. P2 — Xóa sản phẩm đã có đơn hàng trả lỗi máy chủ

`productController.js:201` xóa trực tiếp; `order_items.product_id` có foreign key không cascade. Với sản phẩm đã bán, MySQL sẽ từ chối và controller trả 500 chung. Cần 409 có thông báo phù hợp hoặc cơ chế ngừng bán/soft delete, giữ lịch sử đơn. Hiện lịch sử lấy tên/ảnh từ products nên thay tên sản phẩm cũng làm đổi tên hiển thị của đơn cũ; nên lưu snapshot nếu cần lịch sử bất biến.

### 6. P2 — Giao diện không xử lý đúng sau đổi mật khẩu

`userController.js:69` tăng token_version, khiến phiên hiện tại hết hiệu lực. `frontend/public/js/store.js` chỉ báo đổi mật khẩu thành công, không hướng dẫn đăng nhập lại. Các thao tác tiếp theo, kể cả logout, có thể nhận 401. Cần chuyển về đăng nhập hoặc có chính sách cấp lại phiên rõ ràng.

### 7. P2 — Lỗi thêm giỏ bị đánh đồng với chưa đăng nhập

`frontend/public/js/store.js:37`: mọi lỗi quick-add đều chuyển về /login, kể cả hết hàng, 403 CSRF hoặc lỗi máy chủ. API wrapper hiện bỏ mất HTTP status khi tạo Error. Cần giữ status và chỉ chuyển đăng nhập cho 401; hiển thị thông báo tồn kho/hệ thống ngay tại trang.

### 8. P2 — Cấu hình DB cho phép chọn tên nhưng SQL cố định tên

Compose dùng DB_NAME, trong khi schema và seed đều `USE web-clothing-store`. Điền DB_NAME khác có thể làm ứng dụng kết nối database không có bảng và user ứng dụng không có quyền vào database đã seed. Cần thống nhất tên hoặc quy trình khởi tạo tham số hóa; xác nhận cả khởi tạo mới lẫn volume cũ.

### 9. P2 — Cấu hình production chưa có đường HTTPS hoàn chỉnh trong stack

Backend production yêu cầu trusted origin HTTPS và cookie Secure; gateway hiện chỉ listen 80. Compose còn mặc định NODE_ENV=production nhưng fallback origin HTTP, khiến backend từ chối khởi động nếu không ghi đè đúng. Development HTTP theo file mẫu là một chế độ riêng. Nếu chạy production, cần xác minh nơi kết thúc TLS và origin thực, không chỉ đổi NODE_ENV.

### 10. P2 — Kiểm tra sức khỏe chưa chứng minh DB/schema sẵn sàng

Healthcheck backend chỉ gọi `/`, trả JSON mà không truy vấn DB. `backend/test-db.js` không nạp dotenv khi chạy trực tiếp và dùng process.exit() mặc định thành công cả sau lỗi kết nối đã bắt. Cần readiness kiểm tra DB/schema, công cụ kiểm tra trả exit code khác 0 khi thất bại, và quy trình áp dụng migration token_version cho volume cũ. Migration hiện có là một lần chạy, không tự áp dụng khi restart.

### 11. Khoảng trống kiểm thử trước khi chốt baseline

Chưa có test checkout với MySQL thật, rollback, hai người mua món cuối, hai checkout cùng tài khoản, add/update cart trong lúc checkout, cập nhật tồn kho cạnh tranh, tổng tiền vượt giới hạn, migration và restore. Test hiện tại không có fakeDb.getConnection để thực hiện luồng createOrder thành công. Cần kiểm tra malformed JSON/body quá lớn: handler cuối app hiện ép mọi lỗi về 500, kể cả lỗi đầu vào vốn nên là 400/413.

## Các nền tảng bảo vệ đã hiện diện

- Login dùng query tham số và bcrypt; không thấy đường ghép input trực tiếp vào SQL login.
- JWT HS256 có thời hạn, HttpOnly, Secure trong production, token_version; quyền được đọc lại từ DB.
- Cart/order của khách được lọc theo req.user.id; chi tiết đơn kiểm tra owner trước khi lấy items. Admin routes có requireAdmin.
- CSRF kiểm tra origin và token; Nginx có CSP giới hạn script cùng origin. CSP này chỉ có ở gateway.
- Trường text giao diện phần lớn được escape hoặc gán textContent; tên khách trong trang admin được escape. Việc dùng innerHTML có escape không tự nó chứng minh Stored XSS.
- Upload có giới hạn, kiểm tra định dạng, decode/re-encode raster và tên file ngẫu nhiên.
- Checkout có transaction, FOR UPDATE và điều kiện stock >= quantity; đây là nền tốt nhưng cần test trên MySQL.

## Đối chiếu Attack-Chain.docx

| Kịch bản tài liệu | Hiện trạng | Đánh giá khả năng chuẩn bị lab |
|---|---|---|
| SQLi → bypass login → IDOR/BOLA → lộ dữ liệu | Có login `/api/auth/login`, cookie `token`, order `/api/orders/:id`; login tham số hóa + bcrypt, order kiểm tra owner. Không có `/api/users/:id/orders`; orders không lưu địa chỉ như ví dụ. | Có nền user/order phù hợp để thiết kế bài lab sau khi sửa baseline, nhưng chain hiện không được xác nhận tồn tại. Cần thống nhất endpoint và dữ liệu giả trong kịch bản. |
| Stored XSS → admin session riding → hành động đặc quyền / nâng quyền lâu dài | Không có ticket/review do khách gửi, không có API đổi role/tạo admin/API key. Admin có CRUD catalog và xem đơn. CSP và encoding hiện chặn nhiều điều kiện của ví dụ. | Chưa đủ chức năng để tái hiện nguyên kịch bản. Cần mô tả rõ nội dung khách có thể lưu và hành động admin đích. Sửa catalog không đồng nghĩa với nâng quyền lâu dài. |
| IDOR → CSRF tùy chọn | Không có payment method/paymentMethodId như tài liệu; có CSRF protection. | Không phù hợp nguyên trạng. |

## Điều kiện nghiệm thu trước bước attack chain

1. Sửa các lỗi nghiệp vụ/response trên; bổ sung kiểm thử hồi quy cho từng lỗi.
2. Chạy stack thực và test DB tích hợp trên dữ liệu thử riêng; xác nhận transaction và cạnh tranh không gây sai giỏ, đơn, tồn kho.
3. Chạy đầy đủ luồng trình duyệt: đăng ký → đăng nhập → giỏ → đặt hàng → lịch sử; admin CRUD/upload; đổi mật khẩu → đăng nhập lại; quyền khách/admin và dữ liệu chéo tài khoản.
4. Xác nhận migration, backup và restore với volume thử; ghi phiên bản schema và cấu hình được nghiệm thu.
5. Chốt commit baseline sạch sau khi rà soát những thay đổi đang có. Tách môi trường lab và dữ liệu giả khỏi baseline. Gateway hiện bind `3000:80` trên mọi interface, nên cấu hình phạm vi truy cập lab phù hợp trước khi cố ý đưa lỗ hổng vào.
6. Chốt lại kịch bản theo chức năng thực có, giữ các test bảo vệ baseline để so sánh trước/sau. Chưa triển khai attack chain trong đợt rà soát này.
