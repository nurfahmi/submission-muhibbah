const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/auth.controller');

router.get('/login', AuthController.loginPage);
router.post('/login', AuthController.login);
router.get('/setup', AuthController.setupPage);
router.post('/setup', AuthController.createInitialAdmin);
router.get('/logout', AuthController.logout);

module.exports = router;
