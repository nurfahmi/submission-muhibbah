const express = require('express');
const router = express.Router();
const SubmissionController = require('../controllers/submission.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');

// Public routes
router.get('/submit', SubmissionController.submitPage);
router.post('/submit', upload.fields(SubmissionController.FILE_FIELDS), SubmissionController.submitForm);
router.post('/api/check-image', upload.single('file'), SubmissionController.checkImageQuality);

// Protected routes
router.get('/submit-new', authMiddleware, SubmissionController.privateSubmitPage);
router.post('/submit-new', authMiddleware, upload.fields(SubmissionController.FILE_FIELDS), SubmissionController.submitForm);
router.get('/cases', authMiddleware, SubmissionController.listCases);
router.get('/cases/:id', authMiddleware, SubmissionController.viewCase);
router.post('/cases/:id/take', authMiddleware, SubmissionController.takeCase);
router.post('/cases/:id/update-product', authMiddleware, SubmissionController.updateProduct);
router.post('/cases/:id/update-note', authMiddleware, SubmissionController.updateNote);
router.post('/cases/:id/release', authMiddleware, SubmissionController.releaseCase);
router.get('/taken-cases', authMiddleware, SubmissionController.listTakenCases);
router.get('/drafts', authMiddleware, SubmissionController.listDrafts);
router.get('/drafts/:id/edit', authMiddleware, SubmissionController.editDraft);
router.post('/drafts/:id/delete', authMiddleware, SubmissionController.deleteDraft);
router.get('/files/:fileId/download', authMiddleware, SubmissionController.downloadFile);
router.get('/cases/:id/pdf/:template', authMiddleware, SubmissionController.generatePdf);
router.post('/cases/:id/upload-file', authMiddleware, upload.single('file'), SubmissionController.uploadSubmissionFile);

// Additional file routes (no file type restriction)
const { uploadAny } = require('../middlewares/upload.middleware');
router.post('/cases/:id/admin-files', authMiddleware, uploadAny.single('file'), SubmissionController.uploadAdminFile);
router.get('/admin-files/:fileId/download', authMiddleware, SubmissionController.downloadAdminFile);
router.post('/cases/:id/admin-files/:fileId/delete', authMiddleware, SubmissionController.deleteAdminFile);

// Download all routes
router.get('/cases/:id/download-all-files', authMiddleware, SubmissionController.downloadAllFiles);
router.get('/cases/:id/download-all-admin-files', authMiddleware, SubmissionController.downloadAllAdminFiles);

module.exports = router;

