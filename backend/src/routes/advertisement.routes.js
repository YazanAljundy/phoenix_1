const { Router } = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const controller = require('../controllers/advertisement.controller');

const router = Router();

// No role restriction, same as banner.routes.js - any authenticated user can
// see what is currently advertised. Actually ordering one still goes through
// POST /orders, which is pharmacy-only and re-validates everything.
router.get('/active', authenticate, controller.listActive);
router.get('/:id/cart', authenticate, controller.cart);

module.exports = router;
