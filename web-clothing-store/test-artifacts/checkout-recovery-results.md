# Kiểm tra khóa và mất phản hồi checkout — 29/10/2026

Lệnh: `npm.cmd run test:recovery:mysql` tại backend. Lượt kiểm tra này bổ sung test,
không thay đổi mã xử lý checkout hoặc cập nhật container website.

MySQL mới riêng `nt120-recovery-1793250298006`, database `recovery_test`, tmpfs,
port loopback tự cấp; không dùng volume hoặc dữ liệu webapp. Runner đã dừng
container test trong finally. Không pause/restart DB website.

## Kết quả

| Ca | Bằng chứng | Đánh giá |
|---|---|---|
| Server lock-wait timeout thật | Connection test giữ khóa product; session checkout innodb_lock_wait_timeout=1; HTTP 409 sau 1032 ms; orders/items=0, cart=1, stock=5 | Đạt |
| Checkout sau giải phóng khóa | HTTP 201; orders/items=1, cart=0, stock=4 | Đạt |
| InnoDB deadlock thật | Blocker giữ product, checkout giữ users/cart rồi chờ product; blocker xin khóa user tạo vòng chờ. Dùng transaction fixture nặng hơn để InnoDB chọn checkout làm victim; HTTP 409 | Đạt |
| Dữ liệu sau deadlock | orders/items=0, cart=1, stock=5; rollback blocker và checkout lại thành công | Đạt |
| Rơi HTTP response sau commit | Proxy nhận upstream 201 rồi ngắt socket client; DB có đúng một order/item, cart=0, stock=4 | Đạt phần lưu transaction |
| Retry khi giỏ chưa đổi | HTTP 400, vẫn một order/item, stock=4 | Không tạo thêm đơn; client chưa được trả lại kết quả đơn cũ |
| Retry yêu cầu cũ sau thêm hàng vào giỏ | Thêm lại 1 món, replay POST /api/orders với cùng body {}; HTTP 201; orders/items=2, cart=0, stock=3 | Chưa đạt khả năng nhận diện cùng một lần đặt hàng |

Ca cuối cho thấy API hiện xử lý "đặt giỏ hiện tại": yêu cầu cũ và lần đặt mới
không có danh tính riêng để phân biệt. Không khẳng định mọi retry đều tạo đơn
trùng; retry khi giỏ trống không tạo thêm đơn. Rủi ro là yêu cầu cũ gửi lại sau
thay đổi giỏ có thể mua giỏ mới ngoài ý định người dùng.

Script kết thúc exit code **2**, có chủ ý để báo điều kiện nghiệm thu chưa đạt,
không ghi nhận toàn bộ suite xanh. Log: [checkout-recovery-mysql.txt](checkout-recovery-mysql.txt).

## Công việc cần xử lý nếu chốt yêu cầu retry an toàn

- Cấp idempotency key cho một ý định checkout; client giữ nguyên key khi thử lại.
- Backend ghi key, danh tính user và kết quả order trong cùng transaction với
  tạo đơn. Cùng key trả lại cùng kết quả, không đặt giỏ mới; ràng buộc unique
  bảo vệ các request đồng thời. Việc đặt mới có key mới.
- Test response loss + refill cart + replay, hai request cùng key, user khác,
  rollback trước commit và các trường hợp key không hợp lệ/không có key.
- Đánh giá schema migration và tương thích frontend/backend trước khi áp dụng.

Chưa kiểm chứng mất ACK COMMIT ở giao thức MySQL. Khóa/timeout test đạt không
thay thế kiểm chứng idempotency hoặc bảo đảm mọi lịch cạnh tranh.
