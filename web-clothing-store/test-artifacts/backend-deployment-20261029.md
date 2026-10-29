# Áp dụng và xác minh backend — 29/10/2026

Lệnh: docker compose --env-file docker/.env -f docker/docker-compose.yml up -d --build --no-deps backend

Build thành công; recreate riêng webapp_backend. Docker inspect xác nhận
healthcheck gọi http://127.0.0.1:3001/ready với HTTP timeout 2500 ms và Docker
timeout 3 giây. db/frontend/gateway vẫn chạy; cả bốn service healthy.

## Kiểm chứng trên bản mới

- GET /ready trong container website: 200, {"status":"ready"}.
- GET /api/products trong container website: 200, 8 sản phẩm.
- node test-db.js: thành công, exit 0.
- docker exec -e DB_PORT=1 webapp_backend node test-db.js: lỗi kết nối, exit 1.
  Biến cổng sai chỉ áp dụng tiến trình thử, không đổi env service.
- docker-backend image chạy bằng container tạm --rm --network none, cấu hình
  DB_HOST=127.0.0.1/DB_PORT=1: /ready 503 trong 99 ms, catalog 503 trong 7 ms.
  Container thử đã kết thúc. Không pause/restart database website để tạo lỗi.

## Dependency audit phát sinh lúc build

npm audit --omit=dev --json trong backend mới trả 3 advisory:

| Package | Mức | Advisory | Điều kiện được advisory nêu |
|---|---|---|---|
| body-parser | high | GHSA-27r3-jxmh-p828 | DoS với trailing bytes sau compressed request body |
| multer | high | GHSA-q7qp-rjg7-q26m | DoS khi asynchronous fileFilter pending sau request teardown |
| qs | moderate | GHSA-6pq8-jhm2-2vcw | qs.stringify arrayFormat comma với own toString không callable |

Nguồn là npm audit tại thời điểm kiểm tra, không suy diễn thành đã khai thác được
ứng dụng. Backend dùng synchronous fileFilter và cần đánh giá reachability riêng;
không tự chạy audit fix hoặc nâng package trong lượt này.

## Phần còn mở

- Đánh giá và xử lý/chấp nhận có lý do các advisory trên.
- Checkout mất response COMMIT rồi retry chưa có idempotency được chứng minh.
- Deadlock và server lock-wait timeout thực chưa được kiểm chứng đầy đủ (query
  deadline, queue-full, rollback/disconnect đã kiểm chứng riêng).
- Chốt phiên bản baseline và cập nhật bộ bằng chứng/backup gắn với phiên bản đó.
- Import seed tiếng Việt giữ nguyên theo lựa chọn người dùng; kết quả nhập qua
  giao diện được người dùng xác nhận đúng. Không coi lỗi import là đã được sửa.
