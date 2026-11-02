const db = require('../config/db');
const { isObjectBody } = require('../utils/authValidation');
const { isValidId } = require('../middlewares/idValidationMiddleware');
const { sendDatabaseError } = require('../utils/databaseAvailability');
const { logControllerError } = require('../utils/controllerLogger');

const PAGE_SIZE = 20;
const FIELDS = 'id, subject, message, status, admin_reply, replied_at, created_at, updated_at';
const STATUSES = new Set(['open', 'in_progress', 'resolved']);

function validText(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 &&
    Array.from(value.trim()).length <= maxLength && !value.includes('\0');
}

function pageCursor(req, res) {
  const cursor = req.query.before;
  if (cursor === undefined) return null;
  if (!isValidId(cursor)) {
    res.status(400).json({ message: 'Mốc phân trang không hợp lệ.' });
    return false;
  }
  return Number(cursor);
}

function sendPage(res, rows) {
  res.json({
    tickets: rows.slice(0, PAGE_SIZE),
    nextCursor: rows.length > PAGE_SIZE ? rows[PAGE_SIZE - 1].id : null
  });
}

exports.create = async (req, res) => {
  if (!isObjectBody(req.body) || Object.keys(req.body).some(key => !['subject', 'message'].includes(key))) {
    return res.status(400).json({ message: 'Yêu cầu chỉ được gồm tiêu đề và nội dung hỗ trợ.' });
  }
  if (!validText(req.body.subject, 150)) {
    return res.status(400).json({ message: 'Tiêu đề cần từ 1 đến 150 ký tự.' });
  }
  if (!validText(req.body.message, 4000)) {
    return res.status(400).json({ message: 'Nội dung cần từ 1 đến 4.000 ký tự.' });
  }
  try {
    const [result] = await db.query(
      'INSERT INTO support_tickets (user_id, subject, message) VALUES (?, ?, ?)',
      [req.user.id, req.body.subject.trim(), req.body.message.trim()]
    );
    return res.status(201).json({ id: result.insertId, message: 'Đã gửi yêu cầu hỗ trợ.' });
  } catch (error) {
    logControllerError('supportController', 'create', error);
    return sendDatabaseError(res, error);
  }
};

exports.listMine = async (req, res) => {
  const cursor = pageCursor(req, res);
  if (cursor === false) return;
  try {
    const [rows] = await db.query(
      `SELECT ${FIELDS} FROM support_tickets WHERE user_id = ?${cursor === null ? '' : ' AND id < ?'} ORDER BY id DESC LIMIT 21`,
      cursor === null ? [req.user.id] : [req.user.id, cursor]
    );
    return sendPage(res, rows);
  } catch (error) {
    logControllerError('supportController', 'listMine', error);
    return sendDatabaseError(res, error);
  }
};

exports.getMine = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ${FIELDS} FROM support_tickets WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy yêu cầu hỗ trợ.' });
    return res.json(rows[0]);
  } catch (error) {
    logControllerError('supportController', 'getMine', error);
    return sendDatabaseError(res, error);
  }
};

exports.listAdmin = async (req, res) => {
  const cursor = pageCursor(req, res);
  if (cursor === false) return;
  try {
    const [rows] = await db.query(
      `SELECT t.id, t.subject, t.message, t.status, t.admin_reply, t.replied_at, t.created_at, t.updated_at,
              u.name AS customer_name, u.email AS customer_email
       FROM support_tickets t JOIN users u ON u.id = t.user_id
       ${cursor === null ? '' : 'WHERE t.id < ?'} ORDER BY t.id DESC LIMIT 21`,
      cursor === null ? [] : [cursor]
    );
    return sendPage(res, rows);
  } catch (error) {
    logControllerError('supportController', 'listAdmin', error);
    return sendDatabaseError(res, error);
  }
};

exports.updateAdmin = async (req, res) => {
  if (!isObjectBody(req.body) || !Object.keys(req.body).length ||
      Object.keys(req.body).some(key => !['status', 'reply'].includes(key))) {
    return res.status(400).json({ message: 'Chỉ được cập nhật trạng thái hoặc phản hồi hỗ trợ.' });
  }
  const hasStatus = Object.hasOwn(req.body, 'status');
  const hasReply = Object.hasOwn(req.body, 'reply');
  if (hasStatus && !STATUSES.has(req.body.status)) {
    return res.status(400).json({ message: 'Trạng thái hỗ trợ không hợp lệ.' });
  }
  if (hasReply && !validText(req.body.reply, 4000)) {
    return res.status(400).json({ message: 'Phản hồi cần từ 1 đến 4.000 ký tự.' });
  }
  const assignments = [];
  const values = [];
  if (hasStatus) { assignments.push('status = ?'); values.push(req.body.status); }
  if (hasReply) { assignments.push('admin_reply = ?', 'replied_at = CURRENT_TIMESTAMP'); values.push(req.body.reply.trim()); }
  values.push(req.params.id);
  try {
    await db.query(`UPDATE support_tickets SET ${assignments.join(', ')} WHERE id = ?`, values);
    // Read back even for a no-op status update; unchanged values are still success.
    const [rows] = await db.query(`SELECT ${FIELDS} FROM support_tickets WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Không tìm thấy yêu cầu hỗ trợ.' });
    return res.json(rows[0]);
  } catch (error) {
    logControllerError('supportController', 'updateAdmin', error);
    return sendDatabaseError(res, error);
  }
};
