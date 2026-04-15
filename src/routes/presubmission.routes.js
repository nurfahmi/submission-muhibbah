const express = require('express');
const router = express.Router();
const PreSubmissionController = require('../controllers/presubmission.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');

router.get('/pre-submissions', authMiddleware, PreSubmissionController.listPage);
router.get('/pre-submission', authMiddleware, PreSubmissionController.showPage);
router.get('/pre-submissions/:id', authMiddleware, PreSubmissionController.viewPage);
router.get('/pre-submissions/:id/edit', authMiddleware, PreSubmissionController.editPage);
router.post('/pre-submission/ocr', authMiddleware, upload.single('document'), PreSubmissionController.processDocument);
router.post('/pre-submission/save', authMiddleware, PreSubmissionController.save);
router.post('/pre-submissions/:id/update-product', authMiddleware, PreSubmissionController.updateProduct);
router.post('/pre-submissions/:id/delete', authMiddleware, PreSubmissionController.deleteItem);
router.get('/pre-submissions/:id/pdf/:template', authMiddleware, PreSubmissionController.generateProductPdf);

module.exports = router;
