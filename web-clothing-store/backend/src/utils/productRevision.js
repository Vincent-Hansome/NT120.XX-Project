const { createHash } = require('node:crypto');

// A content revision needs no migration on existing volumes. Compare under a
// row lock so checkout cannot change stock between comparison and UPDATE.
function productRevision(product) {
  const fields = ['id', 'name', 'description', 'price', 'stock', 'size', 'color', 'image_url', 'category_id'];
  const values = fields.map(field => product[field] == null ? null :
    field === 'price' ? Number(product[field]).toFixed(2) : String(product[field]));
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

const withRevision = product => ({ ...product, revision: productRevision(product) });
module.exports = { productRevision, withRevision };
