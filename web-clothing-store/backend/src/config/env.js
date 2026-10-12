const requiredVariables = [
  'JWT_SECRET',
  'DB_HOST',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD'
];

const missing = requiredVariables.filter((name) => process.env[name] === undefined);
const emptyRequired = ['JWT_SECRET', 'DB_HOST', 'DB_NAME', 'DB_USER']
  .filter((name) => !process.env[name]?.trim());

if (missing.length || emptyRequired.length) {
  const names = [...new Set([...missing, ...emptyRequired])].join(', ');
  throw new Error(`Missing required environment variables: ${names}`);
}

if (process.env.NODE_ENV === 'production') {
  if (Buffer.byteLength(process.env.JWT_SECRET, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be at least 32 bytes in production.');
  }

  if (!process.env.DB_PASSWORD.trim()) {
    throw new Error('DB_PASSWORD must not be empty in production.');
  }

  if (process.env.DB_USER.trim().toLowerCase() === 'root') {
    throw new Error('DB_USER must be a non-root application account in production.');
  }
}

module.exports = true;
