// DECIMAL(10,2), shared by products.price and orders.total.
const MAX_TOTAL_CENTS = 9_999_999_999n;

function toCents(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new Error('Invalid stored monetary amount');
  return BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
}

function toDecimal(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

module.exports = { MAX_TOTAL_CENTS, toCents, toDecimal };
