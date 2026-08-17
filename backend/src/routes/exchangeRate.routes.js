const { Router } = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const controller = require('../controllers/exchangeRate.controller');

const router = Router();

// Any authenticated user, any role/status - it's just a number used to
// render a secondary price hint, not something that needs the
// requireActiveStatus gate the catalog itself has.
router.get('/', authenticate, controller.getPublicRate);

module.exports = router;
