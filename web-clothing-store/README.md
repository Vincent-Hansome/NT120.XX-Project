# Clothing Store - Backend API

Web bán quần áo cơ bản, xây dựng bằng Node.js + Express + MySQL. Đây là phiên bản backend chưa chứa lỗ hổng bảo mật (clean version), dùng làm nền tảng cho việc nghiên cứu và giả lập chuỗi tấn công web application sau này.

## Công nghệ sử dụng

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** MySQL (XAMPP)
- **Authentication:** JWT (JSON Web Token) qua httpOnly cookie
- **Password hashing:** bcrypt
- **Upload file:** multer
- **Database driver:** mysql2

## Cấu trúc thư mục

```
backend/
├── src/
│   ├── config/
│   │   └── db.js                  # Kết nối MySQL
│   ├── controllers/
│   │   ├── authController.js      # Đăng ký / đăng nhập
│   │   ├── userController.js      # Profile / logout
│   │   ├── productController.js   # CRUD sản phẩm
│   │   ├── categoryController.js  # CRUD danh mục
│   │   ├── cartController.js      # Giỏ hàng
│   │   └── orderController.js     # Đặt hàng
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── userRoutes.js
│   │   ├── productRoutes.js
│   │   ├── categoryRoutes.js
│   │   ├── cartRoutes.js
│   │   └── orderRoutes.js
│   ├── middlewares/
│   │   ├── authMiddleware.js      # requireAuth, requireAdmin (JWT)
│   │   └── uploadMiddleware.js    # multer config (upload ảnh)
│   └── app.js                     # Khởi tạo Express app
├── uploads/                       # Ảnh sản phẩm được upload
├── server.js                      # Entry point
├── package.json
├── .env                           # Biến môi trường (không commit)
└── test-db.js                     # Script test kết nối DB

database/
└── schema.sql                     # Script tạo database + bảng
```

## Cài đặt và chạy project

### Yêu cầu

- Node.js (đã test với v24.21.0)
- MySQL (qua XAMPP) đang chạy

### Các bước

1. Clone hoặc tải project về, vào thư mục `backend`:
   ```bash
   cd backend
   ```

2. Cài dependencies:
   ```bash
   npm install
   ```

3. Tạo database và các bảng: mở phpMyAdmin, tạo database `web-clothing-store`, chạy script trong `database/schema.sql`.

4. Tạo file `.env` trong thư mục `backend`:
   ```
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=
   DB_NAME=web-clothing-store
   JWT_SECRET=your_jwt_secret_key
   PORT=3000
   ```

5. Chạy server (chế độ dev, tự restart khi code thay đổi):
   ```bash
   npm run dev
   ```

   Hoặc chạy production:
   ```bash
   npm start
   ```

6. Server chạy tại: `http://localhost:3000`

## Danh sách API

### Auth (`/api/auth`)

| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| POST | `/register` | - | Đăng ký tài khoản mới |
| POST | `/login` | - | Đăng nhập, trả về JWT qua httpOnly cookie |

### Users (`/api/users`)

| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| GET | `/me` | Đã đăng nhập | Xem thông tin cá nhân |
| PUT | `/me` | Đã đăng nhập | Cập nhật tên / đổi mật khẩu |
| POST | `/logout` | Đã đăng nhập | Đăng xuất (xoá cookie) |

### Products (`/api/products`)

| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| GET | `/` | - | Danh sách sản phẩm |
| GET | `/:id` | - | Chi tiết 1 sản phẩm |
| POST | `/` | Admin | Tạo sản phẩm (hỗ trợ upload ảnh, field `image`) |
| PUT | `/:id` | Admin | Cập nhật sản phẩm |
| DELETE | `/:id` | Admin | Xoá sản phẩm |

### Categories (`/api/categories`)

| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| GET | `/` | - | Danh sách danh mục |
| POST | `/` | Admin | Tạo danh mục |
| PUT | `/:id` | Admin | Cập nhật danh mục |
| DELETE | `/:id` | Admin | Xoá danh mục |

### Cart (`/api/cart`)

| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| GET | `/` | Đã đăng nhập | Xem giỏ hàng |
| POST | `/` | Đã đăng nhập | Thêm sản phẩm vào giỏ (`product_id`, `quantity`) |
| PUT | `/:id` | Đã đăng nhập | Cập nhật số lượng |
| DELETE | `/:id` | Đã đăng nhập | Xoá khỏi giỏ |

### Orders (`/api/orders`)

| Method | Endpoint | Quyền | Mô tả |
|---|---|---|---|
| POST | `/` | Đã đăng nhập | Tạo đơn hàng từ giỏ hàng hiện tại (transaction, tự trừ stock, xoá cart) |
| GET | `/` | Đã đăng nhập | Danh sách đơn hàng của mình |
| GET | `/:id` | Đã đăng nhập | Chi tiết 1 đơn hàng |

## Database schema (tóm tắt)

- **users**: id, name, email, password (hashed), role (`customer`/`admin`), created_at
- **categories**: id, name
- **products**: id, name, description, price, stock, size, color, image_url, category_id
- **cart_items**: id, user_id, product_id, quantity
- **orders**: id, user_id, total, status, created_at
- **order_items**: id, order_id, product_id, quantity, price

Quan hệ khóa ngoại: `products.category_id → categories.id`, `cart_items.user_id → users.id`, `cart_items.product_id → products.id`, `orders.user_id → users.id`, `order_items.order_id → orders.id`, `order_items.product_id → products.id`.

## Các biện pháp bảo mật cơ bản đã áp dụng (bản clean)

- Mật khẩu được hash bằng bcrypt trước khi lưu DB, không bao giờ lưu plaintext.
- Toàn bộ truy vấn SQL dùng parameterized query (`?` placeholder), không nối chuỗi trực tiếp — tránh SQL Injection.
- JWT lưu qua cookie `httpOnly`, giảm rủi ro bị đánh cắp qua XSS.
- Phân quyền rõ ràng qua middleware `requireAuth` / `requireAdmin`.
- Giới hạn loại file và dung lượng khi upload ảnh sản phẩm (`multer`, chỉ nhận `.jpg/.jpeg/.png/.webp`, tối đa 5MB).

> Lưu ý: đây là bản nền (clean version) chưa cấy lỗ hổng. Các bước tiếp theo của đồ án sẽ tạo nhánh/bản riêng để chèn các loại vulnerability (SQLi, XSS, IDOR, broken auth, SSRF...) phục vụ mục tiêu nghiên cứu và giả lập attack chain.

## Việc cần làm tiếp theo

- [ ] Xây dựng frontend (EJS hoặc React)
- [ ] Viết tài liệu kiến trúc hệ thống (`docs/architecture.md`)
- [ ] Tạo nhánh git `clean-version` lưu bản gốc trước khi cấy lỗ hổng
- [ ] Cấy tối thiểu 5 vulnerability thuộc các nhóm khác nhau
- [ ] Xây dựng ít nhất 2 attack chain
- [ ] Phân tích HTTP request/response và root cause của từng vulnerability
- [ ] Đánh giá security impact, thực hiện mitigation/fix và retest