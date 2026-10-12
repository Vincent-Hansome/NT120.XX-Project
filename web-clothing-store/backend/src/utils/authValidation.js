const NAME_MAX_LENGTH = 50;
const EMAIL_MAX_LENGTH = 100;
const NEW_PASSWORD_MIN_LENGTH = 12;
const NEW_PASSWORD_MAX_BYTES = 72;
const LOGIN_PASSWORD_MAX_BYTES = 1024;

function isObjectBody(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body);
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validateEmail(value) {
  if (typeof value !== 'string') return 'Email must be a string';

  const email = normalizeEmail(value);
  if (!email || Array.from(email).length > EMAIL_MAX_LENGTH) return 'Email is required and must be at most 100 characters';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return 'Email format is invalid';
  return null;
}

function validateName(value) {
  if (typeof value !== 'string') return 'Name must be a string';

  const name = value.trim();
  const length = Array.from(name).length;
  if (!length || length > NAME_MAX_LENGTH) return 'Name is required and must be at most 50 characters';
  return null;
}

function validateLoginPassword(value) {
  if (typeof value !== 'string' || value.length === 0) return 'Password is required and must be a string';
  if (Buffer.byteLength(value, 'utf8') > LOGIN_PASSWORD_MAX_BYTES) return 'Password is too long';
  return null;
}

function validateNewPassword(value) {
  if (typeof value !== 'string') return 'New password must be a string';
  if (Array.from(value).length < NEW_PASSWORD_MIN_LENGTH) return 'New password must be at least 12 characters';
  if (Buffer.byteLength(value, 'utf8') > NEW_PASSWORD_MAX_BYTES) return 'New password must be at most 72 UTF-8 bytes';
  return null;
}

module.exports = {
  EMAIL_MAX_LENGTH,
  LOGIN_PASSWORD_MAX_BYTES,
  NAME_MAX_LENGTH,
  NEW_PASSWORD_MAX_BYTES,
  NEW_PASSWORD_MIN_LENGTH,
  isObjectBody,
  normalizeEmail,
  validateEmail,
  validateLoginPassword,
  validateName,
  validateNewPassword
};
