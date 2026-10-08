# Web Clothing Store

Ứng dụng bán quần áo trực tuyến được xây dựng theo mô hình Frontend + Backend API + MySQL. Project hỗ trợ đăng ký, đăng nhập, quản lý sản phẩm, danh mục, giỏ hàng và đặt hàng.

Project có thể chạy bằng Docker để đồng bộ môi trường và tránh phụ thuộc vào MySQL/XAMPP trên máy.

---

## 1. Công nghệ sử dụng

### Frontend

- Node.js
- Express
- EJS
- HTML/CSS/JavaScript

### Backend

- Node.js
- Express
- MySQL
- JWT Authentication
- bcrypt
- CORS
- dotenv

### Database

- MySQL 8.0
- UTF8MB4
- Foreign Key
- Unique Constraint
- Transaction

### Docker

- Docker
- Docker Compose
- MySQL 8.0
- Node.js Backend Container
- Docker Network
- Docker Volume

---

# 2. Kiến trúc hệ thống

Project gồm ba thành phần chính:

```text
                ┌──────────────────────┐
                │       Frontend       │
                │      Port 3000       │
                │    Express + EJS     │
                └──────────┬───────────┘
                           │
                           │ HTTP API
                           ▼
                ┌──────────────────────┐
                │       Backend        │
                │      Port 3001       │
                │   Node.js + Express  │
                └──────────┬───────────┘
                           │
                           │ MySQL
                           ▼
                ┌──────────────────────┐
                │        MySQL         │
                │      webapp_lab      │
                │      Port 3306       │
                └──────────────────────┘
```

Khi chạy bằng Docker:

```text
Frontend
   │
   ▼
Backend container
   │
   │ DB_HOST=db
   ▼
MySQL container
```

Trong Docker, backend **không sử dụng `localhost` để kết nối MySQL**.

Backend sử dụng:

```env
DB_HOST=db
```

vì `db` là tên service MySQL trong Docker Compose.

---

# 3. Cấu trúc thư mục

```text
web-clothing-store/
│
├── backend/
│   ├── .env
│   ├── package.json
│   ├── server.js
│   ├── test-db.js
│   ├── uploads/
│   │
│   └── src/
│       ├── config/
│       ├── controllers/
│       ├── middleware/
│       ├── routes/
│       └── ...
│
├── database/
│   ├── schema.sql
│   └── seeders/
│       └── 01_seed.sql
│
├── docker/
│   ├── docker-compose.yml
│   └── Dockerfile.backend
│
├── frontend/
│   ├── public/
│   ├── views/
│   ├── package.json
│   └── ...
│
└── README.md
```

---

# 4. Yêu cầu môi trường

Có thể chạy project bằng Docker.

Cần cài:

- Docker Desktop
- Git
- Node.js nếu muốn chạy Frontend hoặc Backend trực tiếp ngoài Docker

Kiểm tra Docker:

```bash
docker --version
```

```bash
docker compose version
```

Kiểm tra Node.js:

```bash
node --version
```

```bash
npm --version
```

---

# 5. Chạy project bằng Docker

## 5.1. Không cần chạy MySQL bằng XAMPP

Project sử dụng MySQL trong Docker.

Nếu XAMPP đang chạy MySQL ở port `3306`, vẫn có thể để XAMPP chạy, vì MySQL Docker không publish port `3306` ra máy host.

Backend trong Docker kết nối tới:

```env
DB_HOST=db
```

Không đổi thành:

```env
DB_HOST=localhost
```

---

# 6. Cấu hình Database

Database sử dụng:

```text
Database: webapp_lab
User: lab_user
Password: lab_password
Root Password: rootpassword
```

Cấu hình này nằm trong:

```text
docker/docker-compose.yml
```

Backend Docker sử dụng:

```env
DB_HOST=db
DB_USER=lab_user
DB_PASSWORD=lab_password
DB_NAME=webapp_lab
PORT=3001
```

---

# 7. Khởi động Docker

Đứng tại thư mục gốc project:

```bash
web-clothing-store/
```

Chạy:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

Kiểm tra container:

```bash
docker ps
```

Thông thường sẽ có:

```text
webapp_db
webapp_backend
```

Kiểm tra trạng thái:

```bash
docker compose -f docker/docker-compose.yml ps
```

MySQL cần ở trạng thái:

```text
healthy
```

---

# 8. Xem log

Xem toàn bộ log:

```bash
docker compose -f docker/docker-compose.yml logs
```

Theo dõi log realtime:

```bash
docker compose -f docker/docker-compose.yml logs -f
```

Chỉ xem backend:

```bash
docker compose -f docker/docker-compose.yml logs -f backend
```

Chỉ xem database:

```bash
docker compose -f docker/docker-compose.yml logs -f db
```

---

# 9. Dừng project

Dừng container:

```bash
docker compose -f docker/docker-compose.yml stop
```

Dừng và xóa container:

```bash
docker compose -f docker/docker-compose.yml down
```

---

# 10. Reset hoàn toàn database Docker

Khi muốn tạo lại database từ đầu:

```bash
docker compose -f docker/docker-compose.yml down -v
```

Sau đó:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

### Cảnh báo

Lệnh:

```bash
docker compose -f docker/docker-compose.yml down -v
```

sẽ xóa Docker volume chứa dữ liệu MySQL.

Tất cả dữ liệu hiện tại trong database Docker sẽ bị xóa.

---

# 11. Database Schema

Database gồm các bảng:

```text
users
categories
products
cart_items
orders
order_items
```

Sơ đồ quan hệ:

```text
users
  │
  ├───────────────┐
  │               │
  ▼               ▼
cart_items      orders
  │               │
  ▼               ▼
products       order_items
  │
  ▼
categories
```

---

# 12. Bảng users

Lưu thông tin tài khoản.

Các cột chính:

```text
id
name
email
password
role
created_at
```

Trong đó:

```text
role = user
role = admin
```

Email có `UNIQUE`.

Tên tài khoản cũng có `UNIQUE`.

---

# 13. Bảng categories

Lưu danh mục sản phẩm.

Ví dụ:

```text
T-Shirts
Hoodies
Accessories
```

Tên category không được trùng.

---

# 14. Bảng products

Lưu thông tin sản phẩm.

Các cột:

```text
id
name
description
price
stock
size
color
image_url
category_id
created_at
```

Trong đó:

```text
price >= 0
stock >= 0
```

`category_id` là Foreign Key tới:

```text
categories.id
```

---

# 15. Bảng cart_items

Lưu sản phẩm trong giỏ hàng.

Các cột:

```text
id
user_id
product_id
quantity
```

Một user không thể có nhiều record cho cùng một product.

Database sử dụng:

```sql
UNIQUE (user_id, product_id)
```

---

# 16. Bảng orders

Lưu thông tin đơn hàng.

Các cột:

```text
id
user_id
total
status
created_at
```

Một order thuộc về một user.

---

# 17. Bảng order_items

Lưu các sản phẩm trong đơn hàng.

Các cột:

```text
id
order_id
product_id
quantity
price
```

Giá sản phẩm được lưu lại tại thời điểm đặt hàng.

Điều này giúp giữ đúng giá của đơn hàng ngay cả khi giá sản phẩm sau đó thay đổi.

---

# 18. Seed dữ liệu

File seed:

```text
database/seeders/01_seed.sql
```

Seed mặc định gồm:

### Admin

```text
Email: admin@webapp.lab
Password: 123456
Role: admin
```

### User

```text
Email: hacker@webapp.lab
Password: 123456
Role: user
```

Database cũng có sẵn category và sản phẩm mẫu.

---

# 19. Authentication

Backend sử dụng JWT.

Quy trình:

```text
Login
  ↓
Backend kiểm tra email/password
  ↓
bcrypt.compare()
  ↓
Tạo JWT
  ↓
Frontend lưu token
  ↓
Gửi token khi gọi API protected
```

Token được sử dụng để xác thực các chức năng như:

```text
Cart
Orders
Profile
Admin
```

---

# 20. API Backend

Backend chạy tại:

```text
http://localhost:3001
```

Health check:

```text
GET /
```

Kết quả:

```json
{
  "message": "Clothing Store API is running"
}
```

---

# 21. Product API

Lấy danh sách sản phẩm:

```http
GET /api/products
```

Lấy sản phẩm theo ID:

```http
GET /api/products/:id
```

Tạo sản phẩm:

```http
POST /api/products
```

Cập nhật sản phẩm:

```http
PUT /api/products/:id
```

Xóa sản phẩm:

```http
DELETE /api/products/:id
```

Các API quản trị yêu cầu quyền phù hợp.

---

# 22. Category API

Lấy danh sách category:

```http
GET /api/categories
```

Tạo category:

```http
POST /api/categories
```

Cập nhật category:

```http
PUT /api/categories/:id
```

Xóa category:

```http
DELETE /api/categories/:id
```

---

# 23. Authentication API

Đăng ký:

```http
POST /api/auth/register
```

Đăng nhập:

```http
POST /api/auth/login
```

Lấy thông tin user hiện tại:

```http
GET /api/auth/me
```

Các API yêu cầu authentication phải gửi JWT.

Ví dụ:

```http
Authorization: Bearer <TOKEN>
```

---

# 24. Cart API

Lấy giỏ hàng:

```http
GET /api/cart
```

Thêm sản phẩm:

```http
POST /api/cart
```

Body:

```json
{
  "product_id": 1,
  "quantity": 2
}
```

Cập nhật:

```http
PUT /api/cart/:id
```

Xóa:

```http
DELETE /api/cart/:id
```

---

# 25. Order API

Tạo đơn hàng:

```http
POST /api/orders
```

Lấy danh sách đơn hàng:

```http
GET /api/orders
```

Lấy chi tiết:

```http
GET /api/orders/:id
```

Quá trình đặt hàng:

```text
User
 ↓
Cart
 ↓
Check stock
 ↓
Begin transaction
 ↓
Lock product rows
 ↓
Create order
 ↓
Create order_items
 ↓
Decrease stock
 ↓
Clear cart
 ↓
Commit
```

Nếu xảy ra lỗi:

```text
ROLLBACK
```

để tránh database ở trạng thái dở dang.

---

# 26. Chống xung đột stock

Khi đặt hàng, backend sử dụng transaction và:

```sql
FOR UPDATE
```

để khóa các dòng sản phẩm liên quan.

Ngoài ra việc trừ stock sử dụng:

```sql
UPDATE products
SET stock = stock - ?
WHERE id = ?
  AND stock >= ?
```

Điều kiện:

```text
stock >= quantity
```

được database kiểm tra trực tiếp.

Ví dụ:

```text
Stock = 1

User A mua 1
User B mua 1
```

Chỉ một request có thể trừ thành công.

Request còn lại phải nhận lỗi thiếu stock.

---

# 27. Chống trùng sản phẩm trong cart

Database có:

```sql
UNIQUE (user_id, product_id)
```

Vì vậy:

```text
User 1 + Product 5
```

chỉ tồn tại một lần trong `cart_items`.

Khi thêm lại cùng sản phẩm, backend tăng:

```text
quantity
```

thay vì tạo một row mới.

---

# 28. Chống trùng email

Database sử dụng:

```sql
UNIQUE(email)
```

Backend cũng xử lý lỗi:

```text
ER_DUP_ENTRY
```

và trả về:

```http
409 Conflict
```

khi email hoặc username đã tồn tại.

---

# 29. Upload hình ảnh

Hình ảnh upload được lưu tại:

```text
backend/uploads/
```

Backend phục vụ thư mục:

```text
/uploads
```

Ví dụ:

```text
backend/uploads/shirt.png
```

sẽ được truy cập qua:

```text
http://localhost:3001/uploads/shirt.png
```

Seed sử dụng dạng:

```text
/uploads/shirt.png
/uploads/hoodie.png
/uploads/sticker.png
```

---

# 30. Chạy Frontend

Đi vào thư mục:

```bash
cd frontend
```

Cài dependencies:

```bash
npm install
```

Chạy:

```bash
npm start
```

hoặc command tương ứng được khai báo trong `package.json`.

Frontend mặc định sử dụng:

```text
http://localhost:3000
```

Backend:

```text
http://localhost:3001
```

---

# 31. Chạy Backend ngoài Docker

Chỉ dùng cách này khi muốn debug Node.js trực tiếp.

Đi vào:

```bash
cd backend
```

Cài package:

```bash
npm install
```

Tạo `.env`:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=web-clothing-store
PORT=3001
JWT_SECRET=your_secret_key
```

Sau đó:

```bash
npm start
```

### Lưu ý

Khi chạy backend ngoài Docker, backend sẽ sử dụng MySQL trên máy host.

Ví dụ:

```text
localhost
root
web-clothing-store
```

Đây là database khác với database Docker:

```text
db
lab_user
webapp_lab
```

Không nên đồng thời debug hai database mà không biết backend đang kết nối tới database nào.

---

# 32. Khuyến nghị môi trường chạy

Khuyến nghị sử dụng:

```text
Docker MySQL
+
Docker Backend
+
Frontend
```

Không cần:

```text
XAMPP MySQL
```

cho project này.

Kiến trúc khuyến nghị:

```text
Frontend
   ↓
Docker Backend
   ↓
Docker MySQL
```

---

# 33. Kiểm tra kết nối database

Backend có file:

```text
backend/test-db.js
```

Khi backend chạy trong Docker, kiểm tra bằng:

```bash
docker compose -f docker/docker-compose.yml exec backend node test-db.js
```

Kết quả thành công phải tương tự:

```text
Kết nối MySQL thành công
```

Nếu lỗi, xem log:

```bash
docker compose -f docker/docker-compose.yml logs backend
```

và:

```bash
docker compose -f docker/docker-compose.yml logs db
```

---

# 34. Kiểm tra MySQL trực tiếp

Truy cập MySQL container:

```bash
docker exec -it webapp_db mysql -u lab_user -plab_password webapp_lab
```

Kiểm tra database:

```sql
SHOW DATABASES;
```

Chọn database:

```sql
USE webapp_lab;
```

Kiểm tra bảng:

```sql
SHOW TABLES;
```

Kết quả cần có:

```text
cart_items
categories
order_items
orders
products
users
```

Kiểm tra products:

```sql
DESCRIBE products;
```

Kiểm tra users:

```sql
SELECT id, name, email, role FROM users;
```

Thoát:

```sql
exit;
```

---

# 35. Các lỗi thường gặp

## Lỗi: Table doesn't exist

Ví dụ:

```text
Table 'webapp_lab.cart_items' doesn't exist
```

Nguyên nhân:

Database chưa được tạo đúng schema.

Cách xử lý:

```bash
docker compose -f docker/docker-compose.yml down -v
```

Sau đó:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

---

## Lỗi: Unknown column

Ví dụ:

```text
Unknown column 'stock'
```

Nguyên nhân:

Schema database cũ không có cột mà backend yêu cầu.

Reset database:

```bash
docker compose -f docker/docker-compose.yml down -v
```

Sau đó build lại:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

---

## Lỗi: Port 3306 already allocated

Ví dụ:

```text
Bind for 0.0.0.0:3306 failed
```

Nguyên nhân:

MySQL/XAMPP trên máy đang sử dụng port `3306`.

Project Docker được cấu hình để không cần publish MySQL ra host.

Kiểm tra `docker-compose.yml` và đảm bảo MySQL không có:

```yaml
ports:
  - "3306:3306"
```

Backend vẫn dùng:

```env
DB_HOST=db
```

---

## Lỗi: ECONNREFUSED

Nguyên nhân thường là backend khởi động trước MySQL.

Docker Compose sử dụng MySQL healthcheck để đảm bảo database ready trước backend.

Kiểm tra:

```bash
docker compose -f docker/docker-compose.yml ps
```

Database cần ở trạng thái:

```text
healthy
```

---

## Lỗi: Invalid credentials

Kiểm tra tài khoản seed:

```text
admin@webapp.lab
123456
```

Nếu database đã tồn tại từ trước, seed mới sẽ không tự chạy lại.

Reset database:

```bash
docker compose -f docker/docker-compose.yml down -v
docker compose -f docker/docker-compose.yml up -d --build
```

---

## Lỗi: Ảnh sản phẩm 404

Kiểm tra file:

```text
backend/uploads/
```

và URL:

```text
/uploads/filename.png
```

Ví dụ:

```text
backend/uploads/shirt.png
```

phải truy cập được:

```text
http://localhost:3001/uploads/shirt.png
```

---

# 36. Docker Volume

MySQL sử dụng volume:

```text
db_data
```

Volume giúp dữ liệu database không nằm trực tiếp trong writable layer của container.

Khi restart:

```bash
docker restart webapp_db
```

dữ liệu vẫn tồn tại.

Chỉ khi dùng:

```bash
docker compose down -v
```

volume mới bị xóa.

---

# 37. Docker Network

Backend và MySQL cùng nằm trong network:

```text
webapp_network
```

Backend kết nối MySQL thông qua tên service:

```text
db
```

Không sử dụng:

```text
localhost
```

trong trường hợp backend chạy bên trong Docker.

---

# 38. Bảo mật

Không nên commit `.env` lên Git.

`.gitignore` nên chứa:

```text
.env
node_modules/
uploads/*
!.gitkeep
```

Không sử dụng secret đơn giản trong môi trường production.

Ví dụ:

```env
JWT_SECRET=super_secret_key
```

chỉ nên dùng cho môi trường lab/development.

Production cần một secret đủ mạnh và được lưu bằng secret manager hoặc environment variables.

---

# 39. Transaction khi đặt hàng

Order sử dụng transaction:

```text
BEGIN
  ↓
SELECT cart + product
  ↓
FOR UPDATE
  ↓
Create order
  ↓
Create order_items
  ↓
Update stock
  ↓
Delete cart
  ↓
COMMIT
```

Nếu bất kỳ bước nào thất bại:

```text
ROLLBACK
```

Nhờ đó tránh các trường hợp:

```text
Tạo order thành công
nhưng stock không giảm
```

hoặc:

```text
Stock đã giảm
nhưng order không tồn tại
```

---

# 40. Kiểm tra hệ thống sau khi cài

Thực hiện lần lượt:

### Bước 1

```bash
docker ps
```

### Bước 2

```bash
docker compose -f docker/docker-compose.yml ps
```

### Bước 3

```bash
docker compose -f docker/docker-compose.yml exec backend node test-db.js
```

### Bước 4

Mở:

```text
http://localhost:3001/
```

### Bước 5

Mở:

```text
http://localhost:3001/api/products
```

### Bước 6

Mở:

```text
http://localhost:3001/api/categories
```

### Bước 7

Mở Frontend:

```text
http://localhost:3000
```

### Bước 8

Đăng nhập:

```text
admin@webapp.lab
123456
```

### Bước 9

Thử:

```text
Thêm sản phẩm vào cart
```

### Bước 10

Thử:

```text
Đặt hàng
```

---

# 41. Quy trình development khuyến nghị

Mỗi lần sửa Backend:

```bash
docker compose -f docker/docker-compose.yml restart backend
```

Nếu sửa Dockerfile:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

Nếu sửa schema và muốn khởi tạo database mới:

```bash
docker compose -f docker/docker-compose.yml down -v
docker compose -f docker/docker-compose.yml up -d --build
```

---

# 42. Không nên làm

Không nên chạy:

```text
Backend Docker
+
Backend local
```

cùng lúc trên cùng port.

Không nên để:

```text
Backend Docker → localhost:3306
```

Không nên chạy đồng thời nhiều database rồi không xác định backend đang sử dụng database nào.

Không nên xóa Docker volume nếu chưa backup dữ liệu.

Không nên sửa schema trực tiếp trong database mà không cập nhật:

```text
database/schema.sql
```

---

# 43. Tóm tắt cách chạy nhanh

Sau khi clone/download project:

```bash
cd web-clothing-store
```

Khởi động:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

Kiểm tra:

```bash
docker compose -f docker/docker-compose.yml ps
```

Kiểm tra database:

```bash
docker compose -f docker/docker-compose.yml exec backend node test-db.js
```

Backend:

```text
http://localhost:3001
```

Frontend:

```text
http://localhost:3000
```

Tài khoản demo:

```text
Admin
Email: admin@webapp.lab
Password: 123456
```

```text
User
Email: hacker@webapp.lab
Password: 123456
```

---

# 44. Troubleshooting nhanh

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `ER_NO_SUCH_TABLE` | Thiếu bảng | Reset database |
| `Unknown column` | Schema cũ | Reset database |
| `ECONNREFUSED` | MySQL chưa ready | Kiểm tra healthcheck |
| `3306 already allocated` | XAMPP/MySQL đang dùng port | Không publish 3306 của Docker |
| `Invalid credentials` | Seed cũ/hash sai | Reset database |
| Product image 404 | Không có file upload | Kiểm tra `backend/uploads` |
| Cart duplicate | Request đồng thời | UNIQUE `(user_id, product_id)` |
| Overselling | Race condition stock | Transaction + `FOR UPDATE` |
| Email duplicate | Không có unique constraint | UNIQUE(email) |

---

# 45. Mục tiêu của phiên bản hiện tại

Phiên bản này tập trung vào:

```text
✓ Đồng bộ Backend với Database
✓ MySQL 8
✓ Docker Compose
✓ Persistent Database Volume
✓ MySQL Healthcheck
✓ JWT Authentication
✓ bcrypt Password Hash
✓ Categories
✓ Products
✓ Cart
✓ Orders
✓ Order Items
✓ Foreign Keys
✓ Unique Constraints
✓ Transaction
✓ Row Lock với FOR UPDATE
✓ Kiểm tra Stock trước khi trừ
✓ Chống overselling
✓ Chống duplicate cart item
✓ Chống duplicate email
```

---

# 46. License

Project được sử dụng cho mục đích học tập, thực hành Node.js, Express, MySQL và Docker.