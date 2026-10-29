const path = require('node:path');

// Test uploads must not share the directory mounted by the running storefront.
module.exports = process.env.NODE_ENV === 'test' && process.env.TEST_UPLOAD_DIRECTORY
  ? path.resolve(process.env.TEST_UPLOAD_DIRECTORY)
  : path.resolve(__dirname, '../../uploads');
