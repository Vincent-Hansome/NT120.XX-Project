# Migrations

## Checkout idempotency — 29/10/2026

Implementation: `backend/scripts/migrate-checkout.cjs` (also exported from
`20261029_checkout_idempotency.cjs`). Adds nullable ASCII UUID column
`orders.checkout_key` and UNIQUE(user_id, checkout_key). Historical orders keep
NULL. No existing rows are deleted/rewritten. Existing compatible columns/indexes
are detected; incompatible definitions stop the migration. Each DDL statement
commits implicitly; rerun after reviewing an interrupted migration.

Deployment order: build both images, take a verified database/uploads backup,
rehearse migration on a restore, apply migration, then update backend/frontend
together. `node scripts/migrate-checkout.cjs` runs inside the backend image using
injected DB settings. `test-artifacts/deploy-checkout.cjs --apply` is an explicit
local helper tied to this project's container names; it pauses the backend,
backs up/compares all original rows and images, rehearses twice on a separate
restore, migrates and updates backend/frontend. It does not reset database/volume.

Verified backup before this migration:
`D:\Project\NT120\web-clothing-store-backups\checkout-2026-10-29T05-31-28-357Z`.
SQL, SHA-256, uploads, private docker.env, previous image IDs and verification.json
are kept outside Git with private ACL. Restoring that SQL into a new database
must be followed by this additive migration before using the new application.
Never import over the active DB as an unreviewed recovery shortcut. Preserve
the current database and validate a separate restore before any recovery cutover.

## Migration danh mục — 28/10/2026

Phiên bản logic: **`20261028_categories_name_unique`**. Trạng thái được xác định bằng
index UNIQUE toàn bộ một cột `categories.name`, không phụ thuộc tên index và không
dựa vào file khởi tạo hoặc một marker chưa đối chiếu DB.

## Nguyên nhân và database đã xác nhận

`schema.sql` có `name UNIQUE`, nhưng các script trong `/docker-entrypoint-initdb.d`
chỉ chạy lúc khởi tạo data directory mới. Volume cũ chỉ có PRIMARY KEY trên `id`.
Controller hiện có đã bắt `ER_DUP_ENTRY`/1062 và trả 409; không cần sửa controller.
Kiểm tra trước khi INSERT riêng lẻ không giải quyết được hai request cạnh tranh.

Backend Docker thực dùng `DB_HOST=db`, port 3306, database `web-clothing-store`,
container `webapp_db`, MySQL **8.0.46**, UUID
`290bb158-c262-11f1-bd83-5a080e03a6aa`. `categories.name` là
`varchar(100) NOT NULL COLLATE utf8mb4_general_ci`. Database default là
`utf8mb4_unicode_ci`; migration giữ nguyên cả hai, không thêm quy tắc chuẩn hóa.

Đã đọc mọi index/FK của sáu bảng, source tham chiếu và các cột có tên category.
Chỉ `products.category_id` tham chiếu `categories.id`, qua `fk_products_category`,
`ON DELETE SET NULL`, `ON UPDATE NO ACTION`. `cart_items` và `order_items` liên kết
đến sản phẩm, không trực tiếp đến danh mục. Không có trigger, view, routine hay
event trong DB đích. Năm database phụ đã được kiểm tra; không có phiên kết nối
khác hoặc event được bật khi bắt đầu maintenance. Hash dữ liệu các DB phụ trước
và sau migration khớp.

## Thuật toán và giới hạn giao dịch

File thực thi: [20261028_categories_name_unique.cjs](20261028_categories_name_unique.cjs).

1. Yêu cầu đúng database, đúng server UUID và `@@global.read_only=1`. Runner dừng
   backend, kiểm tra không còn phiên MySQL khác, kiểm tra event và các database
   phụ đã rà soát, rồi bật `read_only`. Dùng chính tài khoản ứng dụng để xác nhận
   ghi categories và products bị MySQL từ chối. Không chạy đồng thời với tác vụ
   quản trị khác: tài khoản có `CONNECTION_ADMIN`/`SUPER` có thể vượt `read_only`.
2. Lấy advisory lock theo phiên bản/database. Dùng `SET autocommit=0` rồi
   `LOCK TABLES ... WRITE` trên các bảng nghiệp vụ; không gọi `BEGIN` sau khóa.
3. `GROUP BY name` sử dụng collation thực của cột, không `LOWER`, `TRIM`, BINARY
   hoặc đổi collation. Với mỗi nhóm, giữ `MIN(id)` cùng nguyên văn tên của hàng đó.
4. Khám phá mọi FK đến categories, chuyển từng liên kết đến ID giữ lại, rồi xóa
   ID dư. Kiểm tra toàn bộ hàng/cột của mọi bảng trong bộ nhớ, so với trạng thái
   kỳ vọng chỉ khác các ID/liên kết này. Không ghi giá trị người dùng ra log.
5. Commit phần DML. Sau đó mới `ALTER TABLE categories ADD UNIQUE INDEX
   uq_categories_name(name)` nếu chưa có unique index tương đương. UNIQUE prefix,
   composite và expression không được coi là tương đương.
6. Kiểm tra index và số nhóm trùng, mở khóa, rồi runner đối chiếu với bản rehearsal
   trước khi tắt `read_only` và khởi động lại backend.

**Không có một transaction rollback toàn bộ migration.** MySQL DDL có implicit
commit. Nếu ALTER thất bại, phần chuyển liên kết/xóa trùng đã commit vẫn tồn tại;
giữ maintenance, xác minh nguyên nhân và chạy lại để hoàn tất index. Runner để
backend dừng và fence bật nếu lỗi xảy ra sau khi bật fence. Nếu lỗi xuất hiện
trước bước đó thì fence có thể chưa bật. Luôn kiểm tra trạng thái thực trước khi
khôi phục dịch vụ. `apply --resume-fenced` chỉ dùng sau khi đã rà soát lỗi và xác
nhận đó là fence của chính lần chạy đang tiếp tục.

Migration dừng để rà soát nếu có metadata danh mục ngoài id/name, trigger, bảng
không phải InnoDB, bảng không có id, FK composite/khác schema/khác categories.id,
liên kết mồ côi, cột category chưa khai báo FK, hoặc xung đột UNIQUE lúc chuyển
liên kết. Không tự hợp nhất dữ liệu mâu thuẫn và không vô hiệu hóa foreign key.
Việc đối chiếu toàn bộ dữ liệu trong bộ nhớ phù hợp DB nhỏ hiện tại; cần thiết kế
đối chiếu theo lô trước khi dùng cho DB lớn.

Tài liệu MySQL: [implicit commit](https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html),
[LOCK TABLES](https://dev.mysql.com/doc/refman/8.0/en/lock-tables.html),
[read_only](https://dev.mysql.com/doc/refman/8.0/en/server-system-variables.html#sysvar_read_only).

## Backup và bằng chứng chạy thật

Backup được tạo khi backend đã dừng và fence đã bật, trước mọi thay đổi dữ liệu:

```text
D:\Project\NT120\web-clothing-store-backups\categories-2026-10-28T14-42-07-038Z.sql
```

Dung lượng **8649 byte**, SHA-256:

```text
c2e4f12b6b21c9e9ca64e8c569ca6e77bbeda943addc68f3f52fc5642ce89bc0
```

Cùng thư mục có `.sql.sha256` và `.sql.report.json` (metadata/hash/số lượng,
không có dữ liệu hàng). Thư mục backup nằm trong quy tắc Git ignore đã có từ
trước, ACL bỏ kế thừa và chỉ cấp quyền cho Windows identity hiện tại. Dump là
SQL chứa dữ liệu nghiệp vụ; không đưa vào log hoặc commit. Credential Docker
chỉ được đọc trong bộ nhớ, chuyển qua stdin/environment bên trong container.

Backup dùng `mysqldump --single-transaction`, không DROP/CREATE DATABASE/USE,
không seed; dump sáu bảng theo thứ tự cha trước con. Các dòng tắt/bật FK và
UNIQUE checks do mysqldump sinh ra được loại khỏi file. Restore giữ FK bật suốt
quá trình. Đã restore dữ liệu và cấu trúc vào DB riêng
`nt120_category_restore_1793198527041`, đối chiếu hash toàn bộ hàng,
column type/default/charset/collation, index, FK và DDL của mọi bảng.
MySQL có thể biểu diễn thêm `CHARACTER SET utf8mb4` tường minh ở cột vốn đã có
`COLLATE utf8mb4_...`; fingerprint DDL bỏ riêng phần chữ dư này, còn metadata
charset/collation vẫn phải khớp chính xác. Không sửa charset/collation trong DB.

Migration trên bản restore và lần chạy thứ hai đều đạt trước khi áp dụng live.
Đã chạy lại chính lệnh khôi phục bên dưới, tạo DB riêng
`nt120_category_restore_1793198949992`, và xác nhận dữ liệu cũ khớp lại.
Một backup thử trước đó lúc `14:35:27Z` được giữ riêng; dùng backup có report
và checksum ở trên để thực hiện quy trình đã kiểm chứng.

| Dữ liệu | Trước | Sau, đã dọn fixture |
|---|---:|---:|
| categories | 4 | 3 |
| Nhóm tên trùng | 1 | 0 |
| products | 4 | 4 |
| Liên kết sản phẩm tới danh mục | 4 | 4 |
| Liên kết danh mục mồ côi | 0 | 0 |
| orders | 11 | 11 |
| order_items | 16 | 16 |
| cart_items | 1 | 1 |
| users | 6 | 6 |

Nhóm ID `[1,4]`: giữ ID 1, xóa ID 4. ID 4 không có sản phẩm tham chiếu, nên số
liên kết chuyển trên live là 0. Phân bố sản phẩm vẫn là `1→1`, `2→2`, `3→1`.
Index mới: `uq_categories_name`, NON_UNIQUE=0, một cột name, không prefix.
Backend đã restart, `read_only=0`, bốn container ứng dụng healthy. Các database
và volume hiện có được giữ nguyên. Không rebuild image hoặc triển khai các thay
đổi source đang chờ khác. Fixture live có thể làm tăng bộ đếm AUTO_INCREMENT;
các hàng fixture đã xóa, toàn bộ dữ liệu hàng nghiệp vụ đối chiếu khớp.

## Chạy và kiểm tra lại

Từ `web-clothing-store/`, Node.js 24, dependencies backend đã cài:

```powershell
node backend/scripts/category-maintenance.cjs inspect
npm.cmd --prefix backend run test:categories:mysql
node backend/scripts/category-maintenance.cjs apply
node backend/scripts/category-maintenance.cjs smoke
docker exec webapp_backend node test/category-inspect.cjs
```

`inspect` chỉ đọc. `apply` dùng các container kiểm thử đã tạo và tạo backup mới,
restore mới, rehearsal hai lần rồi áp dụng; chạy lại không thêm unique index dư
hoặc thay dữ liệu danh mục đã gộp. Runner được cố định vào deployment/UUID này,
không dùng như CLI tùy ý cho database khác. Không chạy kiểm thử fixture cùng lúc
với `apply` hoặc bất kỳ migration nào trên cùng MySQL test server.

Nếu dựng mới môi trường thử, chỉ chạy `prepare` khi hai tên container chưa tồn tại:

```powershell
node backend/scripts/category-maintenance.cjs prepare
```

Môi trường riêng: MySQL `nt120-category-mysql-20261028`, port chỉ trên loopback
`13317`, tmpfs data directory; runner `nt120-category-runner-20261028` dùng image
backend sẵn có, không gắn volume ứng dụng. Các credential trong source của môi
trường này chỉ là credential test công khai. Test tạo schema mới có tiền tố
`nt120_category_test_` mỗi lần, không reset hoặc drop schema cũ. Container và bản
restore được giữ để đối chiếu; tmpfs sẽ mất khi container MySQL test dừng.

Truy vấn xác minh chỉ đọc trên DB đích:

```sql
SELECT DATABASE(), @@server_uuid, @@global.read_only;
SHOW INDEX FROM categories;
SELECT COUNT(*) AS duplicate_groups FROM
  (SELECT name FROM categories GROUP BY name HAVING COUNT(*) > 1) AS d;
SELECT COUNT(*) AS products FROM products;
SELECT category_id, COUNT(*) AS products FROM products GROUP BY category_id;
SELECT COUNT(*) AS orphans FROM products p LEFT JOIN categories c ON c.id=p.category_id
WHERE p.category_id IS NOT NULL AND c.id IS NULL;
```

## Khôi phục

1. Giữ bản SQL, checksum và report cùng nhau; xác minh checksum trước khi restore.
   Không import file này chồng lên database có dữ liệu.
2. Khôi phục và kiểm chứng vào một database mới trong MySQL thử riêng bằng lệnh
   đã chạy thành công dưới đây. Công cụ kiểm tra đường dẫn trong thư mục backup,
   checksum và report, từ chối DROP/USE/CREATE DATABASE/FK bypass trong dump;
   chỉ tự tạo database đích hoàn toàn mới và đối chiếu với trạng thái trước migration.

   ```powershell
   node backend/scripts/category-maintenance.cjs restore-backup D:\Project\NT120\web-clothing-store-backups\categories-2026-10-28T14-42-07-038Z.sql
   ```

3. Nếu cần phục hồi dịch vụ thật: dừng mọi writer, tạo backup mới của trạng thái
   hiện tại trước, restore backup đã xác minh vào **database phục hồi mới trên
   hạ tầng bền vững**, giữ nguyên DB/volume gốc. Cấp quyền DB cho tài khoản ứng
   dụng qua kênh quản trị kín, cập nhật DB_NAME của deployment sang DB phục hồi,
   kiểm tra identity/schema/readiness rồi mới khởi động backend. Không dùng tmpfs
   test làm nơi lưu dữ liệu dịch vụ. Backup này chứa trạng thái trước sửa (có
   danh mục trùng), nên cần rà soát/chạy lại migration trước khi mở ghi nếu vẫn
   yêu cầu tính duy nhất. Không chạy lại schema.sql hoặc seed lên dữ liệu phục hồi.
4. Nếu chỉ thiếu index sau DML commit, ưu tiên giữ fence, sửa nguyên nhân và
   chạy lại migration. `ROLLBACK` không phục hồi được danh mục đã gộp sau COMMIT.
   Nếu đã mở ghi sau backup, cần đối chiếu các thay đổi mới trước khi cutover;
   không thay cả DB bằng snapshot cũ và làm mất đơn/sản phẩm mới.

Đã kiểm chứng restore vào database riêng, chưa thực hiện cutover phục hồi dịch
vụ, off-host recovery, PITR/binlog recovery hoặc đo RTO/RPO. Backup chưa được
mã hóa hay sao chép ra khỏi máy; ACL và checksum không thay thế các bước đó.

## Kiểm thử

- **64/64** test thường đạt.
- **7/7** test MySQL mới đạt trên MySQL 8.0.46 riêng: schema cũ không unique;
  trùng khác dấu/hoa-thường/khoảng trắng theo `utf8mb4_general_ci`; sản phẩm và
  một bảng FK phụ tham chiếu cả hai ID; giữ đủ sản phẩm, giỏ, đơn, chi tiết đơn;
  chuyển toàn bộ liên kết; không mồ côi; chạy lại no-op và nhận index tương đương
  khác tên; từ chối sai DB/thiếu fence; tài khoản ứng dụng bị chặn ghi thực sự
  sau DML commit trước DDL; API tạo trùng/đổi tên trùng 409; cạnh tranh 201/409;
  tên khác 201 và no-op update 200. Không mock SQL/constraint/commit.
- Live API dùng tài khoản admin fixture đăng nhập bình thường và danh mục UUID
  riêng: **201,409,201,409,200,[201,409]**, sau đó dọn fixture và đối chiếu hash
  toàn bộ hàng nghiệp vụ. Không sửa danh mục nghiệp vụ để thử.
- Log: [MySQL](../../test-artifacts/category-migration/mysql-tests.txt),
  [test thường](../../test-artifacts/category-migration/unit-tests.txt),
  [apply/rehearsal](../../test-artifacts/category-migration/operation.txt),
  [API live](../../test-artifacts/category-migration/live-api.txt),
  [restore chạy lại](../../test-artifacts/category-migration/restore-recheck.txt).

Chưa kiểm chứng tải cao, crash/power loss trong DDL hoặc mọi lịch xen kẽ. Không
đổi authentication/authorization/CSRF, không triển khai attack chain, không
commit/push. Kết quả này không nghiệm thu toàn bộ hệ thống production.
