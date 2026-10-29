const { sendDatabaseError } = require('../utils/databaseAvailability');
const db = require('../config/db');
const { logControllerError } = require('../utils/controllerLogger');
const { BusinessError, withTransaction, sendTransactionError } = require('../utils/transaction');

function validateName(value) {
  if (typeof value !== 'string') return { error: 'Category name must be text.' };

  const name = value.trim();
  if (!name) return { error: 'Category name cannot be empty.' };
  if (Array.from(name).length > 100) return { error: 'Category name must be at most 100 characters.' };
  return { name };
}

function validateCategoryBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Category data must be an object.' };
  }
  if (Object.keys(body).some((field) => field !== 'name')) {
    return { error: 'Category data contains an unsupported field.' };
  }
  return validateName(body.name);
}

function isDuplicateName(error) {
  return error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062;
}

exports.getAll = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM categories');
    res.json(rows);
  } catch (error) {
    logControllerError('categoryController', 'getAll', error);
    sendDatabaseError(res, error);
  }
};

exports.create = async (req, res) => {
  const validation = validateCategoryBody(req.body);
  if (validation.error) return res.status(400).json({ message: validation.error });

  try {
    const [result] = await db.query('INSERT INTO categories (name) VALUES (?)', [validation.name]);
    return res.status(201).json({ message: 'Category created', id: result.insertId });
  } catch (error) {
    if (isDuplicateName(error)) return res.status(409).json({ message: 'A category with this name already exists.' });
    logControllerError('categoryController', 'create', error);
    return sendDatabaseError(res, error);
  }
};

exports.update = async (req, res) => {
  const validation = validateCategoryBody(req.body);
  if (validation.error) return res.status(400).json({ message: validation.error });

  try {
    await withTransaction(async connection => {
      const [rows] = await connection.query('SELECT id FROM categories WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!rows.length) throw new BusinessError(404, 'Category not found');
      await connection.query('UPDATE categories SET name = ? WHERE id = ?', [validation.name, req.params.id]);
    });
    return res.json({ message: 'Category updated' });
  } catch (error) {
    if (isDuplicateName(error)) return res.status(409).json({ message: 'A category with this name already exists.' });
    if (sendTransactionError(res, error)) return;
    logControllerError('categoryController', 'update', error);
    return sendDatabaseError(res, error);
  }
};

exports.remove = async (req, res) => {
  try {
    const [result] = await db.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Category not found' });
    return res.json({ message: 'Category deleted' });
  } catch (error) {
    logControllerError('categoryController', 'remove', error);
    return sendDatabaseError(res, error);
  }
};
