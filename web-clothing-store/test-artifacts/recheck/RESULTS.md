# Kết quả chạy lại kiểm thử — 26/10/2026

## Kết luận

ĐẠT trong phạm vi 64 test thường, 15 test MySQL và luồng browser được chạy lại. CHƯA ĐẠT điều kiện đánh dấu toàn bộ checklist hoặc chốt triển khai baseline. Không phát hiện test thất bại trong lần chạy này; không đồng nghĩa mọi tình huống đã được kiểm chứng.

Phiên bản: workspace có thay đổi chưa commit trên HEAD `2eeae6d40abe456744f252deacfd18aa3ce161b8`. Không commit/push/deploy hoặc sửa mã ứng dụng trong lượt kiểm tra. Hai log cùng thư mục là log mới của lần này, không sao chép kết quả từ đợt sửa trước.

## Bằng chứng mới

| Kiểm tra | Kết quả |
|---|---|
| npm.cmd test | 64 đạt, 0 lỗi; MySQL suite được loại theo cấu hình và chạy riêng bên dưới |
| npm.cmd run test:mysql | 15 đạt, 0 lỗi, 0 skip |
| node --check | 39 file JS/CJS đạt |
| Tách môi trường | Docker inspect xác nhận MySQL test không có volume mounts, tmpfs /var/lib/mysql, bind 127.0.0.1:13316; tên DB test cố định trong runner |
| Cạnh tranh MySQL | Add đồng thời, add/update giỏ, hai khách mua món cuối, hai checkout cùng giỏ, add/update/delete xen kẽ checkout đều đạt |
| Tiền/rollback | Giá 0, decimal, đúng giới hạn, vượt giới hạn 422, rollback sau order/item/stock write đều đạt |
| Admin/CRUD/upload | Form cũ xung đột checkout, no-op, thiếu đối tượng, trùng danh mục, xóa sản phẩm đã bán, dọn upload khi lỗi đều đạt |
| Phiên/mật khẩu | API MySQL xác nhận xóa cookie, thu hồi hai phiên cũ, đăng nhập bằng mật khẩu mới; DOM harness xác nhận redirect/thông báo |
| Browser Edge thực | Đăng nhập fixture → profile → quick-add hết hàng giữ trang và hiện Quantity exceeds stock → thêm sản phẩm còn hàng → giỏ từ 1 thành 2 → checkout → lịch sử/chi tiết đơn MC-00015, 24,68 ₫, quantity 2; badge về 0 |
| Stack hiện hữu, chỉ đọc | / và catalog 200, /api/users/me và /api/orders/admin/all 401 khi chưa đăng nhập; CSP hiện diện |
| Phiên bản stack hiện hữu | /api/products chưa trả revision: stack localhost:3000 chưa thể coi là phiên bản đã sửa; kết quả MySQL/browser áp dụng workspace qua môi trường test 13330/13331 |

Đã đọc logic khóa users/product, transaction helper, tính tiền BigInt, revision và các test có điều phối query thật. Các log ER_SIGNAL_EXCEPTION là lỗi fixture cố ý phục vụ rollback/upload, không phải test thất bại. Cảnh báo DEP0060 của proxy còn tồn tại.

## Đối chiếu checklist

1. Phiên bản/môi trường: đạt tách biệt test và không dùng dữ liệu thật; workspace chưa chốt commit, stack cũ chưa cập nhật.
2. Giỏ: các ca hiện có đạt. Chưa kiểm thử tải cao, pool cạn, deadlock/lock timeout thực và mọi lịch cạnh tranh.
3. Checkout: ca tiền, thiếu kho, đồng thời và rollback đạt. Chưa xác minh mất response COMMIT rồi retry; không có bằng chứng về idempotency qua lỗi mạng.
4. Admin: API MySQL và DOM harness đạt các ca revision/form cũ. Không chạy lại thao tác hai admin thực trong browser ở lượt này.
5. CRUD/upload: test thường/MySQL đạt các ca có trong suite; chưa thử upload qua gateway của phiên bản mới. Tên/ảnh lịch sử vẫn phụ thuộc sản phẩm hiện tại.
6. Auth/phân quyền: test thường và ca mật khẩu MySQL đạt; browser đã xác nhận login. Chưa chạy trọn đăng ký/đổi mật khẩu/đăng xuất trực tiếp trong browser ở lượt này.
7. Response/UI: suite HTTP và client đạt; browser xác nhận hết hàng không chuyển login, add và checkout thành công. Không coi DOM harness là đầy đủ browser E2E.
8. Kiểm thử độc lập: đã chạy lại test và lưu log mới. Chưa có bộ browser E2E tự động đầy đủ.
9. Docker/khôi phục: kiểm tra healthy và gateway cũ đạt; chưa chạy backup/restore, restart persistence, load test, volume migration, TLS hoặc triển khai mới. Schema test được tạo bằng các CREATE TABLE trong schema.sql, không kiểm chứng toàn bộ init/seed với DB_NAME tùy chọn.
10. Chốt baseline: chưa đạt; cần xử lý/ghi nhận các mục còn mở và nghiệm thu cấu hình triển khai.

## Những điểm còn mở từ mã/cấu hình

- DB_NAME trong Compose và tên database cố định trong schema/seed chưa được xử lý trong phạm vi sửa 8 mục.
- Production HTTPS/cookie Secure cần cấu hình TLS phù hợp; kết quả test HTTP không xác nhận production.
- Health endpoint vẫn chỉ báo tiến trình HTTP, không truy vấn DB/schema. Công cụ test-db vẫn cần xem lại exit code khi DB lỗi.
- Không có test phục hồi backup hoặc kết luận về dữ liệu lịch sử bất biến.

Đã đóng tab, dừng server test và MySQL tmpfs sau khi kiểm tra. Bốn container webapp gốc vẫn running/healthy. Không thay đổi bản ghi của stack gốc.
