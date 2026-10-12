const AUTH_COOKIE_NAME = 'token';
const JWT_TTL_SECONDS = 2 * 60 * 60;

function authCookieOptions(environment = process.env.NODE_ENV) {
  return {
    httpOnly: true,
    secure: environment === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: (JWT_TTL_SECONDS - 1) * 1000
  };
}

function clearAuthCookie(res) {
  const { maxAge, ...clearOptions } = authCookieOptions();
  res.clearCookie(AUTH_COOKIE_NAME, clearOptions);
}

module.exports = {
  AUTH_COOKIE_NAME,
  JWT_TTL_SECONDS,
  authCookieOptions,
  clearAuthCookie
};
