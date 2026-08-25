/**
 * Image Upload Middleware — Catalog Service (Multer)
 *
 * Configures multer for local disk storage of product images.
 * In production, this would be replaced by a direct-to-S3/Cloudinary upload
 * or a signed-URL approach. The local disk setup is documented as a dev
 * stand-in — the interesting part for interviews is the architecture
 * (upload → store path → serve via static middleware), not the storage backend.
 *
 * Configuration:
 *   - Storage: local disk, uploads/products/<timestamp>-<original-name>
 *   - File filter: jpeg, jpg, png, webp only
 *   - Max file size: 5 MB (configurable via env)
 *   - Max files per request: 5 (configurable via env)
 */

const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const MAX_FILE_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 5) * 1024 * 1024;
const MAX_FILES = parseInt(process.env.MAX_FILES_PER_UPLOAD, 10) || 5;

// Allowed MIME types for product images
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, path.join(UPLOAD_DIR, 'products'));
    },
    filename: (_req, file, cb) => {
        // UUID prefix prevents filename collisions across uploads
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${uuidv4()}${ext}`);
    },
});

const fileFilter = (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE',
            `Invalid file type: ${file.mimetype}. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`
        ));
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: MAX_FILES,
    },
});

/**
 * Multer error handler middleware — converts multer errors into
 * structured JSON responses matching our error format.
 */
function handleMulterError(err, req, res, next) {
    if (err instanceof multer.MulterError) {
        const messages = {
            LIMIT_FILE_SIZE: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB.`,
            LIMIT_FILE_COUNT: `Too many files. Maximum: ${MAX_FILES} per upload.`,
            LIMIT_UNEXPECTED_FILE: err.message || 'Unexpected file field.',
        };
        return res.status(400).json({
            error: 'Upload Error',
            message: messages[err.code] || err.message,
        });
    }
    next(err);
}

module.exports = { upload, handleMulterError };
