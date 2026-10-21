const fs = require('node:fs/promises');
const db = require('../config/db');
const { logControllerError } = require('../utils/controllerLogger');

const MAX_INT = 2_147_483_647;
const MAX_PRICE = 99_999_999.99;
const MAX_DESCRIPTION_LENGTH = 10_000;
const PRODUCT_FIELDS = new Set(['name', 'description', 'price', 'stock', 'size', 'color', 'category_id']);
const characterLength = (value) => Array.from(value).length;

function invalid(message) {
  return { error: message };
}

function parsePrice(value) {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;

  const number = Number(text);
  if (!Number.isFinite(number) || number > MAX_PRICE) return null;
  return number;
}

function parseStock(value) {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+$/.test(text)) return null;

  const number = Number(text);
  if (!Number.isSafeInteger(number) || number > MAX_INT) return null;
  return number;
}

function parseCategoryId(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (typeof value === 'string' && value.trim() === '') return { value: null };

  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^[1-9]\d*$/.test(text)) return null;

  const number = Number(text);
  if (!Number.isSafeInteger(number) || number > MAX_INT) return null;
  return { value: number };
}

function parseOptionalText(value, field, maxLength) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (typeof value !== 'string') return invalid(`${field} must be text.`);

  const normalized = value.trim();
  if (characterLength(normalized) > maxLength) return invalid(`${field} must be at most ${maxLength} characters.`);
  return { value: normalized || null };
}

function validateProduct(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return invalid('Product data must be an object.');
  }
  if (Object.keys(body).some((field) => !PRODUCT_FIELDS.has(field))) {
    return invalid('Product data contains an unsupported field.');
  }

  if (typeof body.name !== 'string') return invalid('Product name must be text.');
  const name = body.name.trim();
  if (!name) return invalid('Product name cannot be empty.');
  if (characterLength(name) > 255) return invalid('Product name must be at most 255 characters.');

  const price = parsePrice(body.price);
  if (price === null) return invalid('Price must be a non-negative number with at most two decimal places and no more than 99999999.99.');

  const stock = parseStock(body.stock);
  if (stock === null) return invalid('Stock must be a non-negative 32-bit integer.');

  let description = null;
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string') return invalid('Description must be text.');
    if (characterLength(body.description) > MAX_DESCRIPTION_LENGTH) {
      return invalid(`Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`);
    }
    description = body.description || null;
  }

  const size = parseOptionalText(body.size, 'Size', 50);
  if (size.error) return size;

  const color = parseOptionalText(body.color, 'Color', 50);
  if (color.error) return color;

  const category = parseCategoryId(body.category_id);
  if (!category) return invalid('Category id must be a positive integer or empty.');

  return {
    value: {
      name,
      description,
      price,
      stock,
      size: size.value,
      color: color.value,
      category_id: category.value
    }
  };
}

async function removeUploadedImage(file) {
  if (!file?.path) return;
  try {
    await fs.unlink(file.path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function rejectRequest(req, res, status, message) {
  try {
    await removeUploadedImage(req.file);
  } catch (error) {
    logControllerError('productController', 'rejectRequest.cleanupUpload', error);
  }
  return res.status(status).json({ message });
}

async function categoryExists(categoryId) {
  if (categoryId === null) return true;
  const [rows] = await db.query('SELECT id FROM categories WHERE id = ?', [categoryId]);
  return rows.length > 0;
}

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM products');
    res.json(rows);
  } catch (error) {
    logControllerError('productController', 'getAll', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getById = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Not found' });
    return res.json(rows[0]);
  } catch (error) {
    logControllerError('productController', 'getById', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.create = async (req, res) => {
  const validation = validateProduct(req.body);
  if (validation.error) return rejectRequest(req, res, 400, validation.error);

  try {
    if (!(await categoryExists(validation.value.category_id))) {
      return rejectRequest(req, res, 400, 'Category id does not refer to an existing category.');
    }

    const image_url = req.file ? '/uploads/' + req.file.filename : null;
    const { name, description, price, stock, size, color, category_id } = validation.value;
    const [result] = await db.query(
      'INSERT INTO products (name, description, price, stock, size, color, image_url, category_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, description, price, stock, size, color, image_url, category_id]
    );
    return res.status(201).json({ message: 'Product created', id: result.insertId });
  } catch (error) {
    logControllerError('productController', 'create', error);
    return rejectRequest(req, res, 500, 'Server error');
  }
};

exports.update = async (req, res) => {
  const validation = validateProduct(req.body);
  if (validation.error) return rejectRequest(req, res, 400, validation.error);

  try {
    if (!(await categoryExists(validation.value.category_id))) {
      return rejectRequest(req, res, 400, 'Category id does not refer to an existing category.');
    }

    const { name, description, price, stock, size, color, category_id } = validation.value;
    const fields = [name, description, price, stock, size, color, category_id];
    let query = 'UPDATE products SET name=?, description=?, price=?, stock=?, size=?, color=?, category_id=?';

    if (req.file) {
      query += ', image_url=?';
      fields.push('/uploads/' + req.file.filename);
    }
    query += ' WHERE id=?';
    fields.push(req.params.id);

    await db.query(query, fields);
    return res.json({ message: 'Product updated' });
  } catch (error) {
    logControllerError('productController', 'update', error);
    return rejectRequest(req, res, 500, 'Server error');
  }
};

exports.remove = async (req, res) => {
  try {
    await db.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Product deleted' });
  } catch (error) {
    logControllerError('productController', 'remove', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
