const express = require('express');
const router = express.Router();
const UserController = require('../controllers/user.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');

router.use(authMiddleware);

router.get('/', roleMiddleware('superadmin', 'admin', 'masteragent'), UserController.listUsers);
router.post('/', roleMiddleware('superadmin', 'admin', 'masteragent'), UserController.createUser);
router.post('/delete/:id', roleMiddleware('superadmin', 'admin'), UserController.deleteUser);
router.post('/edit/:id', roleMiddleware('superadmin', 'admin'), UserController.editUser);
router.post('/impersonate/:id', roleMiddleware('superadmin'), UserController.impersonate);
router.get('/stop-impersonate', UserController.stopImpersonate);

module.exports = router;
