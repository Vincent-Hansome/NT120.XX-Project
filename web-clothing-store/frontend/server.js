const express = require('express');
const path = require('path');
const ejs = require('ejs');
const app = express();
const PORT = process.env.FRONTEND_PORT || 3000;
const VIEWS = path.join(__dirname, 'views');
app.set('view engine', 'ejs');
app.set('views', VIEWS);
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => { res.locals.currentPath = req.path; next(); });
function page(view, locals = {}) {
  return (req, res, next) => ejs.renderFile(path.join(VIEWS, `${view}.ejs`), locals, (err, body) => {
    if (err) return next(err);
    res.render('layouts/main', { ...locals, body, pageTitle: locals.pageTitle || 'MỘC', apiUrl: process.env.API_URL || 'http://localhost:3001/api' });
  });
}
app.get('/', page('products/list', { pageTitle: 'Mặc điều thật', page: 'home' }));
app.get('/products', page('products/list', { pageTitle: 'Bộ sưu tập', page: 'products' }));
app.get('/products/:id', (req, res, next) => page('products/detail', { pageTitle: 'Chi tiết sản phẩm', productId: req.params.id })(req, res, next));
app.get('/cart', page('cart/cart', { pageTitle: 'Giỏ hàng' }));
app.get('/checkout', page('checkout/checkout', { pageTitle: 'Thanh toán' }));
app.get('/login', page('auth/login', { pageTitle: 'Đăng nhập' }));
app.get('/register', page('auth/register', { pageTitle: 'Đăng ký' }));
app.get('/profile', page('profile/profile', { pageTitle: 'Tài khoản' }));
app.get('/orders', page('admin/orders', { pageTitle: 'Đơn hàng' }));
app.get('/admin', page('admin/dashboard', { pageTitle: 'Quản trị' }));
app.get('/admin/products', page('admin/products', { pageTitle: 'Quản lý sản phẩm' }));
app.use((req, res) => res.status(404).send('Không tìm thấy trang — <a href="/">Trở về MỘC</a>'));
app.use((err, req, res, next) => { console.error(err); res.status(500).send('Không thể tải trang này.'); });
app.listen(PORT, () => console.log(`MỘC storefront: http://localhost:${PORT}`));
