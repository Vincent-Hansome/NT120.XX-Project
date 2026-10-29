# Kết quả sửa DB availability — 29/10/2026

Phạm vi được người dùng yêu cầu: readiness phụ thuộc DB; exit code test-db;
giới hạn chờ truy vấn/kết nối và queue. Không sửa import seed tiếng Việt theo
yêu cầu. Mã ứng dụng và Compose đã sửa trong workspace; chưa rebuild/restart
hoặc deploy vào bốn container webapp hiện có. Không commit/push.

## Thay đổi

- `/ready`: SELECT 1 với thời hạn, 200 khi DB trả lời, 503 khi lỗi/treo/queue
  hết thời gian; response no-store, không lộ địa chỉ, query hay secret.
- `/` vẫn là liveness, trả 200 khi tiến trình HTTP chạy. Đây không còn là
  endpoint được backend Compose healthcheck sử dụng.
- Healthcheck Compose gọi `/ready`, HTTP timeout 2500 ms, Docker timeout 3 s.
- Pool có 10 suất kết nối và tối đa 50 yêu cầu chờ. Hàng đợi do ứng dụng quản lý
  để hủy waiter đã hết hạn, tránh câu ghi hết hạn chạy trễ sau phục hồi.
- Chờ lấy kết nối tối đa 1000 ms, bắt tay socket 2000 ms, mỗi query/BEGIN/
  COMMIT/ROLLBACK tối đa 3000 ms; readiness query 1000 ms. Truy vấn hết thời hạn
  đóng socket, không trả kết nối còn SQL dang dở về pool. Socket đến trễ sau
  acquisition timeout cũng bị đóng. Lỗi availability trả generic 503 ở API.
- test-db nạp backend/.env nhưng giữ ưu tiên biến đã inject; kết thúc bằng
  exitCode 0/1 và đóng pool trong finally; cả lỗi đóng pool cũng trả 1.

## Kết quả chạy lại

| Kiểm tra | Kết quả |
|---|---|
| Test thường | 74/74 đạt, 0 fail, 0 skip |
| MySQL nghiệp vụ | 15/15 đạt, 0 fail, 0 skip |
| MySQL danh mục | 7/7 đạt, 0 fail, 0 skip |
| Availability MySQL riêng | 6/6 kịch bản đạt |
| Cú pháp JS/CJS | 49 file đạt |
| Compose config --quiet | Thành công |

Trong MySQL tạm riêng `nt120-availability-*`, DB bị pause:
- readiness 503 trong 1017 ms;
- catalog 503 trong 3010 ms;
- unpause: readiness/catalog trở về 200;
- giữ hết 10 kết nối: 50 yêu cầu chờ hết hạn, yêu cầu thứ 51 bị từ chối ngay;
  các INSERT hết hạn không chạy sau khi giải phóng pool;
- transaction đã INSERT rồi DB bị pause: query timeout đóng socket; sau unpause
  bản ghi được rollback, readiness trở lại 200;
- DB stop hoàn toàn: readiness/catalog trả 503 hữu hạn và không lộ nội bộ;
- chạy tiến trình test-db thực: DB đúng trả 0, cổng 1 bị từ chối trả 1.

Log mới: [unit](availability-unit.txt), [business MySQL](availability-business-mysql.txt),
[category MySQL](availability-category-mysql.txt), [availability](availability-mysql.txt).
Lần chạy test đầu trong môi trường hạn chế bị EACCES cho kết nối localhost;
đã chạy lại ngoài hạn chế đó và các kết quả ở bảng là vòng chạy thành công.

## Giới hạn

Giới hạn là theo acquisition và từng lệnh, không phải deadline tổng cho mọi
request nhiều lệnh. Đóng socket ngăn tái sử dụng và buộc server hoàn tất rollback
khi nhận disconnect, không hứa DB nhận disconnect tức thời khi đang freeze.
Timeout COMMIT có thể có kết quả chưa biết, không tự retry và không bổ sung
idempotency. Readiness kiểm tra DB trả lời, chưa kiểm toàn bộ schema. Chưa kiểm
thử tải dài; chưa áp dụng healthcheck/mã mới vào stack website. Các fixture và
pause/stop của runner availability chỉ dùng container riêng nó tạo.
