USE webapp_lab;

-- =========================
-- USERS
-- =========================
INSERT INTO users (name, password, email, role)
VALUES
(
    'admin',
    '$2b$10$ne2iJK1N.qgxPD6iMBu1nul2d1MbqTlDwEAPaJNUFi3SScooqhCrW',
    'admin@webapp.lab',
    'admin'
),
(
    'hacker',
    '$2b$10$ne2iJK1N.qgxPD6iMBu1nul2d1MbqTlDwEAPaJNUFi3SScooqhCrW',
    'hacker@webapp.lab',
    'user'
);

-- =========================
-- CATEGORIES
-- =========================
INSERT INTO categories (name)
VALUES
('T-Shirts'),
('Hoodies'),
('Accessories');

-- =========================
-- PRODUCTS
-- =========================
INSERT INTO products
(name, description, price, stock, size, color, image_url, category_id)
VALUES
(
    'Áo thun Cybersecurity',
    'Áo thun cho hacker mũ trắng',
    15.99,
    100,
    'M',
    'Black',
    '/uploads/shirt.png',
    1
),
(
    'Mũ trùm đầu (Hoodie)',
    'Vật bất ly thân của hacker',
    45.00,
    50,
    'L',
    'Black',
    '/uploads/hoodie.png',
    2
),
(
    'Laptop Sticker',
    'Sticker trang trí',
    2.50,
    200,
    NULL,
    'Mixed',
    '/uploads/sticker.png',
    3
);