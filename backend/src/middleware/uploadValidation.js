const fileType = require('file-type');

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

function maxSizeValidator(req, res, next) {
  // Multer handles size via limits, but double-check if needed
  if (req.file && req.file.size > MAX_SIZE_BYTES) {
    return res.status(413).json({
      error: {
        code: 'payload_too_large',
        message: 'Dosya boyutu en fazla 5MB olmalıdır.',
        requestId: req && req.requestId,
      }
    });
  }
  next();
}

async function mimeSniffValidator(req, res, next) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        error: { code: 'bad_request', message: 'Dosya bulunamadı', requestId: req && req.requestId }
      });
    }

    const headerType = req.headers['content-type'] || '';
    if (!headerType.startsWith('image/')) {
      return res.status(415).json({
        error: { code: 'unsupported_media_type', message: 'Sadece image/* kabul edilir', requestId: req && req.requestId }
      });
    }

    const detected = await fileType.fromBuffer(req.file.buffer);
    if (!detected || !detected.mime.startsWith('image/')) {
      return res.status(415).json({
        error: { code: 'unsupported_media_type', message: 'Geçersiz veya desteklenmeyen görsel formatı', requestId: req && req.requestId }
      });
    }

    // Allow only common types
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(detected.mime)) {
      return res.status(415).json({
        error: { code: 'unsupported_media_type', message: 'Yalnızca JPG/PNG/WEBP desteklenir', requestId: req && req.requestId }
      });
    }

    next();
  } catch (err) {
    if (req && req.log) req.log.error({ err }, 'mimeSniffValidator error');
    return res.status(415).json({
      error: { code: 'unsupported_media_type', message: 'Geçersiz dosya', requestId: req && req.requestId }
    });
  }
}

async function clamAVScan(req, res, next) {
  try {
    const enabled = (process.env.CLAMAV_ENABLED || 'false').toLowerCase() === 'true';
    if (!enabled) return next();
    // Placeholder: integrate with clamdscan or TCP service if available
    // For now, pass-through.
    return next();
  } catch (err) {
    if (req && req.log) req.log.error({ err }, 'clamAVScan error');
    return res.status(503).json({
      error: { code: 'virus_scan_unavailable', message: 'Dosya tarama servisi kullanılamıyor', requestId: req && req.requestId }
    });
  }
}

module.exports = {
  maxSizeValidator,
  mimeSniffValidator,
  clamAVScan,
  MAX_SIZE_BYTES,
};

