const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const multer = require('multer');
const sharp = require('sharp');

// Upload inputs are read from disk and only these raster formats are accepted.
// Block every other libvips loader before metadata parsing reaches native decoders.
sharp.block({ operation: ['VipsForeignLoad'] });
sharp.unblock({
  operation: [
    'VipsForeignLoadJpegBuffer',
    'VipsForeignLoadPngBuffer',
    'VipsForeignLoadWebpBuffer'
  ]
});

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const uploadsDirectory = require('../config/uploads');

const allowedImages = {
  '.jpg': { format: 'jpeg', mimeType: 'image/jpeg', extension: '.jpg' },
  '.jpeg': { format: 'jpeg', mimeType: 'image/jpeg', extension: '.jpg' },
  '.png': { format: 'png', mimeType: 'image/png', extension: '.png' },
  '.webp': { format: 'webp', mimeType: 'image/webp', extension: '.webp' }
};

class UploadError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function removeFile(filePath) {
  return fs.unlink(filePath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    fs.mkdir(uploadsDirectory, { recursive: true })
      .then(() => callback(null, uploadsDirectory), callback);
  },
  filename: (req, file, callback) => {
    callback(null, `${crypto.randomUUID()}${file.imageType.extension}`);
  }
});

const parseMultipart = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
    fields: 8,
    parts: 10,
    fieldSize: 64 * 1024
  },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const imageType = allowedImages[extension];

    if (!imageType) {
      return callback(new UploadError(415, 'Only JPEG, PNG, and WebP images are supported.'));
    }

    if (file.mimetype !== imageType.mimeType) {
      return callback(new UploadError(415, 'The declared image type does not match the file extension.'));
    }

    file.imageType = imageType;
    return callback(null, true);
  }
}).single('image');

async function normalizeImage(file) {
  const type = file.imageType;
  const temporaryPath = path.join(uploadsDirectory, `${crypto.randomUUID()}.tmp`);
  const input = await fs.readFile(file.path);

  let metadata;
  try {
    metadata = await sharp(input, {
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_PIXELS
    }).metadata();
  } catch {
    throw new UploadError(415, 'The uploaded file is not a valid supported image.');
  }

  if (
    metadata.format !== type.format ||
    !Number.isInteger(metadata.width) ||
    !Number.isInteger(metadata.height) ||
    metadata.width * metadata.height > MAX_IMAGE_PIXELS ||
    (metadata.pages || 1) > 1
  ) {
    throw new UploadError(415, 'The image content does not match its declared type or exceeds image limits.');
  }

  try {
    try {
      await sharp(input, {
        failOn: 'error',
        limitInputPixels: MAX_IMAGE_PIXELS
      })
        .rotate()
        .toFormat(type.format)
        .toFile(temporaryPath);
    } catch {
      throw new UploadError(415, 'The uploaded file could not be decoded as a supported image.');
    }

    const normalized = await fs.stat(temporaryPath);
    if (normalized.size > MAX_FILE_SIZE) {
      throw new UploadError(413, 'The processed image exceeds the 5 MB limit.');
    }

    await fs.unlink(file.path);
    await fs.rename(temporaryPath, file.path);
    file.size = normalized.size;
  } finally {
    await removeFile(temporaryPath);
  }
}

function sendUploadError(res, error) {
  if (error instanceof UploadError) {
    return res.status(error.status).json({ message: error.message });
  }

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'Image uploads are limited to 5 MB.' });
    }
    if (error.code === 'LIMIT_FIELD_VALUE') {
      return res.status(413).json({ message: 'A form field exceeds the allowed size.' });
    }
    return res.status(400).json({ message: 'The multipart upload is invalid.' });
  }

  return res.status(500).json({ message: 'Unable to process the uploaded image.' });
}

function sendMultipartError(res, error) {
  if (error instanceof UploadError || error instanceof multer.MulterError) {
    return sendUploadError(res, error);
  }

  if (['EACCES', 'EIO', 'EMFILE', 'ENOSPC', 'EROFS'].includes(error?.code)) {
    return res.status(500).json({ message: 'Unable to process the uploaded image.' });
  }

  return res.status(400).json({ message: 'The multipart upload is invalid.' });
}

module.exports = (req, res, next) => {
  parseMultipart(req, res, async (parseError) => {
    if (parseError) return sendMultipartError(res, parseError);
    if (!req.file) return next();

    try {
      await normalizeImage(req.file);
      return next();
    } catch (error) {
      try {
        await removeFile(req.file.path);
      } catch {
        // Keep the client response generic even if cleanup itself fails.
      }
      return sendUploadError(res, error);
    }
  });
};
