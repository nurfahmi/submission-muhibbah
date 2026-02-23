const express = require('express');
const router = express.Router();
const DashboardController = require('../controllers/dashboard.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.use(authMiddleware);

router.get('/', DashboardController.main);
router.get('/main', DashboardController.main);
router.get('/api/new-cases-count', DashboardController.newCasesCount);

module.exports = router;
