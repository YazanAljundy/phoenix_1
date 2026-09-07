const { Router } = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const controller = require('../controllers/offer.controller');

const router = Router();

// No role restriction, same as banner.routes.js / advertisement.routes.js -
// any authenticated user can see what is currently on offer. This is a
// read-only listing: buying a discounted product still goes through the
// catalog and POST /orders, which re-reads every price server-side.
router.get('/active', authenticate, controller.listActive);

module.exports = router;
