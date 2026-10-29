# Kết quả ngày 28/10/2026

- DB thật: `webapp_db` / `web-clothing-store`, MySQL 8.0.46. Chỉ có
  `products.category_id` tham chiếu categories; collation tên `utf8mb4_general_ci`.
- Migration `20261028_categories_name_unique` đã áp dụng: giữ ID 1, xóa ID dư 4,
  thêm `uq_categories_name(name)`. Nhóm trùng 1→0, categories 4→3.
- products 4, links 4, orphan 0, orders 11, order_items 16, cart_items 1, users 6
  giữ nguyên. Full-row hashes khớp trạng thái kỳ vọng và bản rehearsal; các DB
  phụ không đổi. Không có liên kết đến ID 4 trong live (movedLinks=0).
- Backup 8649 byte ở `D:\Project\NT120\web-clothing-store-backups\categories-2026-10-28T14-42-07-038Z.sql`.
  SHA-256 `c2e4f12b6b21c9e9ca64e8c569ca6e77bbeda943addc68f3f52fc5642ce89bc0`.
  Đã restore/đối chiếu trước khi migration và chạy lại quy trình restore sau đó.
- [7/7 MySQL regressions](mysql-tests.txt), [64/64 test thường](unit-tests.txt).
- [Rehearsal hai lần và apply](operation.txt).
- [API thật với fixture riêng](live-api.txt): login200/create201/duplicate409/
  distinct201/rename409/no-op200/concurrent[201,409], fixture dọn sạch, hàng nghiệp
  vụ trước/sau khớp. [Lệnh restore chạy lại](restore-recheck.txt).
- Backend restart thành công; read_only=OFF; bốn container ứng dụng healthy.
- [Truy vấn DB chỉ đọc sau cùng](live-db-verification.json): một unique index tên,
  không nhóm trùng, không mồ côi, đúng UUID, read_only=0 và đủ dữ liệu nghiệp vụ.
- [Thuật toán, backup, lệnh chạy và khôi phục](../../database/migrations/README.md).

Không load/crash test, cutover phục hồi dịch vụ, off-host/PITR, TLS/browser E2E
đầy đủ trong phạm vi này. Các container kiểm thử tmpfs được giữ để đối chiếu,
không gắn volume hiện có. Không commit/push, seed, tắt FK hoặc xóa/reset database.
