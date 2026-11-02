# Rà soát kịch bản và điều kiện triển khai attack chain

Ngày rà soát: 02/11/2026. Phạm vi: đọc tài liệu và source, không chạy payload,
không dựng lab, không thay đổi ứng dụng hoặc database đang dùng.

**Có thể tiếp tục thiết kế lab từ baseline local đã lưu, nhưng hai chain trong
tài liệu cần điều chỉnh trước khi triển khai.** Source hiện tại có các kiểm soát
chặn các đường mô tả; lượt rà soát này không xác nhận các lỗ hổng đó đang tồn tại.
Ưu tiên chain 1 nếu muốn bài học backend/auth/object authorization. Chain 2 có
thể dùng luồng tên khách hàng sẵn có để giảm phần chức năng phải bổ sung, với
đích đầu tiên là một hành động catalog thử bằng phiên admin. Nếu mục tiêu bắt
buộc là quyền admin lâu dài, cần thiết kế thêm chức năng và cách chứng minh.

## Nguồn và độ mới của bằng chứng

- Kịch bản gốc: [Attack-Chain.docx](D:/Downloads/Attack-Chain.docx), đã đọc nội dung.
- [Biên bản baseline ngày 29/10](test-artifacts/final-baseline-results.md) ghi
  phiên bản `nt120-local-20261029-v1`, snapshot source/images, backup restore và
  kết quả 79 test thường, 19 MySQL nghiệp vụ, 7 danh mục, 6 availability cùng 9
  kiểm tra recovery/migration. Đây là bằng chứng của ngày 29/10, không phải kết
  quả chạy lại hôm nay.
- Đã đọc lại routes, controller auth/user/order/category, middleware auth/CSRF,
  cookie config, validation, frontend render/API client, schema, Compose và CSP.
  Không tìm thấy AGENTS.md áp dụng trong các thư mục cha/repository đã kiểm tra.
- Chưa kiểm tra lại Docker runtime, checksum snapshot, tình trạng backup hoặc
  chạy test trong lượt này. Trước khi dựng lab cần xác minh các mục này còn khớp.

## Chain 1 SQLi rồi IDOR đọc chéo dữ liệu đơn

**Đánh giá: gần chức năng hiện có nhất, nhưng bước bypass login trong tài liệu
chưa tương thích trực tiếp với cách đăng nhập hiện tại.**

| Nội dung | Tài liệu gốc | Source hiện tại |
|---|---|---|
| Login | `/api/login` | `/api/auth/login` |
| Cookie | `session` | `token`, JWT HS256, HttpOnly |
| Truy vấn login | Ví dụ so mật khẩu trực tiếp trong SQL | Truy vấn email có placeholder, sau đó `bcrypt.compare` |
| Đối tượng IDOR | `/api/users/:userId/orders` | `/api/orders/:orderId`; list lấy user từ session |
| Kiểm tra chủ đơn | Ví dụ tin userId từ URL | Chi tiết dùng `id = ? AND user_id = ?` |
| Dữ liệu cuối | Email, địa chỉ, đơn của nhiều khách | Đơn và order_items; không có địa chỉ trong orders |

Bằng chứng: [login](backend/src/controllers/authController.js:58),
[cookie](backend/src/config/authCookie.js:1),
[routes](backend/src/routes/orderRoutes.js:20),
[kiểm tra chủ đơn](backend/src/controllers/orderController.js:81),
[schema](database/schema.sql).

Các điểm cần chốt khi thiết kế:

1. Phải chứng minh có phiên hợp lệ khi không biết mật khẩu của tài khoản fixture
   được nhận diện. Chỉ biến query email thành nối chuỗi chưa tự chứng minh vượt
   `bcrypt.compare`; validation email cũng là điều kiện đầu vào cần tính đến.
   Mọi thay đổi có chủ đích vào xác thực trong bản lab phải được ghi rõ.
2. Ứng dụng có đăng ký công khai. Nhận định trong tài liệu rằng không có SQLi thì
   không thể có phiên quyền thấp không đúng cho mọi người dùng ứng dụng này.
   Cần mô tả rõ điểm xuất phát và tài khoản đích của bài demo, không gọi SQLi là
   cách duy nhất để có phiên. Không dùng mật khẩu đã biết rồi coi đó là bypass.
3. Có thể thiết kế theo `/api/orders/:orderId` sẵn có; không cần thêm endpoint
   chứa userId chỉ để giống ví dụ. Fixture cần ít nhất hai khách khác nhau và các
   đơn xác định thuộc từng khách; tài khoản được nhận từ bước 1 vẫn là quyền thường.
4. Chỉ kết luận lộ nhiều khách nếu đã đọc chéo được dữ liệu giả của nhiều chủ sở
   hữu. Một đơn của một khách khác chứng minh truy cập chéo đối tượng; chưa đủ
   để khẳng định mass disclosure hoặc chiếm quyền admin/server.

Ma trận nghiệm thu trên các biến thể lab cùng một bộ fixture:

| Biến thể | Kết quả cần chứng minh |
|---|---|
| Login và ownership đều được bảo vệ | Sai mật khẩu không nhận phiên; khách A không đọc đơn B |
| Chỉ đường login có lỗi theo thiết kế lab | Có phiên quyền thấp theo kịch bản, vẫn không đọc được đơn khác |
| Chỉ ownership có lỗi | Với phiên fixture A hợp lệ thấy lỗi đọc chéo; bước bypass login vẫn thất bại |
| Cả hai mắt xích có lỗi | Chạy được đường từ điểm xuất phát đã công bố đến đọc chéo dữ liệu giả |

Giữ cùng request, fixture và điểm xuất phát khi so sánh bản có lỗi/bản sửa.
Không nới quyền truy cập DB hoặc dùng tài khoản MySQL root để tạo tác động ngoài
mục tiêu bài học. Lượt này chưa tạo bất kỳ biến thể nào.

## Chain 2 Stored XSS dùng ngữ cảnh admin

**Đánh giá: có luồng lưu và hiển thị dữ liệu người dùng sẵn; chưa có bằng chứng
thực thi XSS và chưa có chức năng cấp quyền admin lâu dài.**

Luồng đã đối chiếu từ source:

```text
Khách cập nhật name qua /api/users/me
→ lưu users.name
→ đơn của khách được admin đọc qua /api/orders/admin/all
→ API trả customer_name
→ trang admin orders render A.escape(customer_name)
```

[Profile controller](backend/src/controllers/userController.js:24) chỉ cho sửa
name/mật khẩu; [validation](backend/src/utils/authValidation.js:25) giới hạn name
50 ký tự. [Admin query](backend/src/controllers/orderController.js:99) join tên
khách từ users; [frontend](frontend/public/js/store.js:212) hiện escape tên/email
trước khi tạo HTML. Đây là ứng viên thiết kế luồng lab, không phải phát hiện XSS.
Fixture khách cần có đơn được đưa vào danh sách admin, và mọi dữ liệu thử phải
tuân thủ giới hạn đầu vào hoặc ghi nhận rõ nếu bản lab đổi giới hạn.

Hai lựa chọn tác động cuối cần phân biệt:

| Đích bài học | Phần đã có | Phần còn thiếu |
|---|---|---|
| Hành động đặc quyền trái ý admin | CRUD category/product yêu cầu admin | Chứng minh script thực sự chạy trong browser admin rồi tạo tác động thử giới hạn |
| Quyền admin lâu dài | Middleware đọc role hiện tại từ DB | Chưa có API đổi role/tạo admin/API key; cần đặc tả riêng và chứng minh bằng lần đăng nhập mới |

Đề xuất phạm vi đầu tiên: một thay đổi catalog fixture có thể quan sát và phục
hồi. Chỉ gọi là unauthorized privileged action; tác động này không tự cấp quyền
admin lâu dài cho khách. Nếu buộc giữ nguyên mục tiêu persistent privilege
escalation của tài liệu, phải bổ sung chức năng phù hợp trong lab và nghiệm thu
tách biệt. [Routes hiện tại](backend/src/routes/userRoutes.js) không có đổi role;
[middleware](backend/src/middlewares/authMiddleware.js:51) không tin role từ body
hay role cũ trong JWT.

Các điều kiện trình duyệt cần kiểm chứng:

- CSP ở [gateway](gateway/nginx.conf:40) có `script-src 'self'`. Cần kiểm tra
  thực thi qua đúng gateway và browser dự kiến; không kết luận chỉ từ HTML hiển
  thị hoặc từ đường backend bỏ qua gateway. `innerHTML` không tự thực thi thẻ
  script được chèn, dù vẫn có các nguồn rủi ro HTML khác. Tham chiếu
  [MDN innerHTML](https://developer.mozilla.org/en-US/docs/Web/API/Element/innerHTML),
  [MDN script-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src).
- HttpOnly ngăn JavaScript đọc cookie nhưng không ngăn browser gửi cookie trong
  request thích hợp do JavaScript khởi tạo. Không cần lấy cắp cookie để chứng
  minh session riding. [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#httponly).
- Token CSRF của ứng dụng được lấy từ `/api/auth/csrf` và cache trong closure
  của API client, không phải token đã thấy trong DOM như ví dụ tài liệu. Nếu đã
  thực thi được script cùng origin, CSRF không thay thế việc ngăn XSS. Giữ kiểm
  tra CSRF trong bài nghiệm thu để mô tả đúng tác động, không coi việc tắt toàn
  bộ CSRF là điều kiện mặc định. [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

Nghiệm thu cần quan sát dữ liệu được lưu, trang admin đọc đúng fixture, script
thực sự chạy, tác động chỉ xảy ra với ngữ cảnh admin phù hợp và không xảy ra sau
khi sửa mắt xích render. Với CSP đang chặn, ghi kết quả là chain bị cắt tại CSP.
Nếu bản lab thay CSP để mô phỏng cấu hình khác, ghi đó là một điều kiện riêng.

## Chain IDOR rồi CSRF

Chưa ưu tiên. Source không có paymentMethodId hoặc chức năng phương thức thanh
toán như ví dụ. Backend kiểm tra Origin/Referer và token cho unsafe methods;
cookie có SameSite=Lax. Một bài CSRF cần kiểm chứng điều kiện cookie, phương
thức request và origin trên browser thật; chỉ bỏ token không đủ kết luận chạy
được chain. Nếu phiên của người tấn công tự sửa được đối tượng nạn nhân thì kết
quả là lỗi authorization, chưa chứng minh vai trò riêng của CSRF.

## Điều kiện trước khi triển khai lab

| Điều kiện | Việc cần xác nhận |
|---|---|
| Baseline phục hồi được | Kiểm tra checksum source/images/backup của phiên bản đã lưu; giữ test bảo vệ để đối chiếu |
| Tách source và dữ liệu | Bản source riêng; DB/volume/upload fixture riêng; không mount DB/uploads hiện có, không đưa backup người dùng thật vào lab có lỗi |
| Tách Docker | Compose project, tên container, network, port và secret riêng; không dùng lại container_name webapp_* hoặc db_data hiện tại |
| Phạm vi mạng | Lab bind loopback; không kế thừa gateway `3000:80` đang bind mọi interface; kiểm tra port thực khi dựng |
| Tách browser/session | Hostname lab khác baseline, cookie/secret riêng và browser profile thử riêng; không chỉ đổi port |
| Mục tiêu và dữ liệu | Chốt actor, endpoint, tài khoản thường/admin fixture, dữ liệu có thể đọc/đổi, điều kiện đầu/cuối |
| Bằng chứng và sửa lỗi | Ma trận từng mắt xích, request/response đã bỏ token, browser trace và trạng thái fixture trước/sau; cùng kịch bản thất bại sau sửa |
| Kết thúc phiên lab | Dừng đúng stack lab, thu hồi phiên fixture, xác nhận stack baseline không đổi; không reset DB/volume đang dùng |

Điểm tách browser quan trọng với dự án dùng cookie tên `token`, path `/`:
cookie không được cô lập theo port. Tách cổng trên cùng hostname có thể đưa
cookie của baseline sang dịch vụ lab; secret JWT khác không ngăn cookie được
gửi tới đó. Cần host riêng, không chia sẻ Domain cookie với baseline và profile
thử riêng. [RFC 6265 mục 8.5](https://datatracker.ietf.org/doc/html/rfc6265#section-8.5).

## Kết luận phạm vi

Chốt chain 1 theo chức năng login/order hiện có và sửa các nhận định về bcrypt,
đăng ký công khai, endpoint/cookie và mức dữ liệu lộ. Với chain 2, chọn rõ hành
động admin trong catalog hay bổ sung chức năng để chứng minh quyền lâu dài.
Luồng tên khách hàng là phương án thiết kế ít bổ sung hơn ticket/review; tính
khai thác thực tế còn phải kiểm chứng theo validation, CSP và browser.

Trong lượt này chỉ tạo báo cáo rà soát và liên kết từ READINESS-REVIEW.md.
Không chạy test mới, payload, quét endpoint, thao tác Docker hay SQL; không đổi
authentication, authorization, CSRF hoặc CSP. Không commit/push và chưa triển khai lab.
