const MAX_INT_ID = 2_147_483_647;

function isValidId(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number(value) <= MAX_INT_ID;
}

function validateIdParam(req, res, next) {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid id.' });
  }

  req.params.id = Number(req.params.id);
  return next();
}

module.exports = { isValidId, validateIdParam };
