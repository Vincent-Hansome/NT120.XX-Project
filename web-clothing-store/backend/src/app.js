const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { trustedOrigins } = require('./config/trustedOrigins');
const { csrfProtection } = require('./middlewares/csrfMiddleware');
const { logControllerError } = require('./utils/controllerLogger');

const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const cartRoutes = require('./routes/cartRoutes');
const orderRoutes = require('./routes/orderRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const userRoutes = require('./routes/userRoutes');

const app = express();

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, false);
    return callback(null, trustedOrigins.has(origin));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'X-CSRF-Token']
}));
app.use(express.json());
app.use(cookieParser());
app.use(csrfProtection);
app.use('/uploads', express.static('uploads'));

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/users', userRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Clothing Store API is running' });
});

app.use((err, req, res, next) => {
  logControllerError('app', 'unhandledRequest', err);
  res.status(500).json({ message: 'Internal server error' });
});

module.exports = app;
