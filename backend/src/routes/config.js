const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const configPayload = () => ({
  features: {
    dcbFirst: (process.env.PAYMENTS_DCB_ENABLED || 'false').toLowerCase() === 'true',
    showTarot: (process.env.FEATURE_SHOW_TAROT || 'true').toLowerCase() === 'true',
  },
  payments: {
    carriers: (process.env.PAYMENTS_CARRIERS || '').split(',').map(s=>s.trim()).filter(Boolean),
  },
  limits: {
    aiDaily: parseInt(process.env.AI_DAILY_LIMIT || '20'),
  },
  rewards: {
    inviteBonusAmount: parseInt(process.env.INVITE_BONUS_AMOUNT || '10'),
  },
});

router.get('/', (req, res) => {
  const payload = configPayload();
  const etag = crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }
  return res.json({ success: true, data: payload });
});

module.exports = router;

