const express = require('express');
const router = express.Router();
const TemplateController = require('../controllers/template.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const roleMiddleware = require('../middlewares/role.middleware');

const adminOnly = [authMiddleware, roleMiddleware('superadmin')];

router.get('/', ...adminOnly, TemplateController.listTemplates);
router.post('/upload', ...adminOnly, TemplateController.uploadMiddleware, TemplateController.uploadTemplate);
router.get('/:key/map', ...adminOnly, TemplateController.mapFields);
router.post('/:key/map', ...adminOnly, TemplateController.saveMap);
router.get('/:key/pdf', ...adminOnly, TemplateController.servePdf);
router.post('/:key/toggle', ...adminOnly, TemplateController.toggleProduct);
router.post('/:key/reorder/:direction', ...adminOnly, TemplateController.reorderProduct);
router.post('/:key/delete', ...adminOnly, TemplateController.deleteTemplate);
router.post('/:key/add-child', ...adminOnly, TemplateController.uploadMiddleware, TemplateController.addChild);
router.post('/:parentKey/delete-child/:childKey', ...adminOnly, TemplateController.deleteChild);
router.post('/:key/ai-suggest', ...adminOnly, TemplateController.aiSuggest);

module.exports = router;
