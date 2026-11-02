# Kiểm chứng hỗ trợ khách hàng

Ngày 02/11/2026. Đã triển khai vào stack Docker local hiện có.

- `npm.cmd test`: 79 kiểm thử đạt, không lỗi. Lượt chạy đầu trong sandbox bị
  chặn kết nối loopback (`EACCES`); chạy lại với quyền truy cập local đã đạt.
- `SUPPORT_UI_SMOKE=1 npm.cmd run test:support:mysql`: 16 nhóm kiểm tra đạt
  trên MySQL 8 và Chrome headless. Database thử nằm trong container tmpfs mới,
  dùng tài khoản thử riêng; container được xóa khi kết thúc.
- Nghiệm thu: migration lặp lại giữ dữ liệu, gửi và lưu ticket, giới hạn và
  Unicode, chủ sở hữu, phân quyền admin, CSRF/Origin, phản hồi/trạng thái,
  cập nhật không thay đổi giá trị và phân trang 20 bản ghi.
- Trình duyệt: khách chưa đăng nhập, khách gửi/xem yêu cầu, admin đọc/trả lời,
  khách nhận phản hồi và bị chặn vào hộp thư admin. Chuỗi HTML thử hiển thị bằng
  văn bản, không tạo phần tử ảnh hay thực thi JavaScript; không có pageerror.
- Kiểm tra kích thước 1440×1000, 375×812 và 812×375; không tràn ngang. Đã xem
  ảnh giao diện khách/admin trên máy tính và điện thoại.
- Đã build backend/frontend, chạy migration thêm `support_tickets`, rồi cập
  nhật hai service. Các trang `/support`, `/admin/support` và tài nguyên mới
  trả 200 qua gateway. API ticket không có phiên trả 401.
- Hash và số hàng của toàn bộ sáu bảng nghiệp vụ cũ khớp trước/sau deployment;
  không chạy lại seed hoặc reset volume. Chi tiết trong
  `deployment-verification.json`; ID image trước cập nhật trong
  `deployment-before.json`.

Chức năng dùng cookie HttpOnly, CSRF, kiểm tra owner/admin, truy vấn tham số và
render văn bản. Đây là chức năng hỗ trợ được bảo vệ, chưa phải biến thể lab có
lỗ hổng Stored XSS. Mỗi yêu cầu có một phản hồi admin có thể cập nhật.
