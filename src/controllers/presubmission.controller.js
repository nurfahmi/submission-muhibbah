const OcrService = require('../services/ocr.service');
const PdfService = require('../services/pdf.service');
const prisma = require('../config/db');
const fs = require('fs');

const PreSubmissionController = {
  /**
   * Render the pre-submission create/edit page
   */
  async showPage(req, res) {
    res.render('dashboard/pre-submission', {
      layout: 'layouts/main',
      title: 'Pre-Submission Baru',
      user: req.session.user,
      page: 'pre-submission',
      editItem: null
    });
  },

  /**
   * List all pre-submissions
   */
  async listPage(req, res) {
    try {
      const currentUser = req.session.user;
      const isAdmin = currentUser.role === 'superadmin' || currentUser.role === 'admin';
      const where = isAdmin ? {} : { created_by: currentUser.id };

      const items = await prisma.preSubmission.findMany({
        where,
        orderBy: { created_at: 'desc' },
        include: { creator: { select: { username: true } } }
      });

      res.render('dashboard/pre-submission-list', {
        layout: 'layouts/main',
        title: 'Pre-Submission List',
        user: currentUser,
        page: 'pre-submission-list',
        items,
        loanProducts: PdfService.getLoanProducts()
      });
    } catch (err) {
      console.error('Pre-submission list error:', err);
      req.flash('error', 'Failed to load pre-submissions.');
      res.redirect('/dashboard');
    }
  },

  /**
   * View a pre-submission detail with product selection
   */
  async viewPage(req, res) {
    try {
      const currentUser = req.session.user;
      const item = await prisma.preSubmission.findUnique({
        where: { id: req.params.id },
        include: { creator: { select: { username: true } } }
      });
      if (!item) {
        req.flash('error', 'Pre-submission not found.');
        return res.redirect('/dashboard/pre-submissions');
      }

      res.render('dashboard/pre-submission-view', {
        layout: 'layouts/main',
        title: 'Pre-Submission Detail',
        user: currentUser,
        page: 'pre-submission-list',
        item,
        loanProducts: PdfService.getLoanProducts()
      });
    } catch (err) {
      console.error('Pre-submission view error:', err);
      req.flash('error', 'Failed to load pre-submission.');
      res.redirect('/dashboard/pre-submissions');
    }
  },

  /**
   * Edit page
   */
  async editPage(req, res) {
    try {
      const item = await prisma.preSubmission.findUnique({ where: { id: req.params.id } });
      if (!item) {
        req.flash('error', 'Pre-submission not found.');
        return res.redirect('/dashboard/pre-submissions');
      }
      res.render('dashboard/pre-submission', {
        layout: 'layouts/main',
        title: 'Edit Pre-Submission',
        user: req.session.user,
        page: 'pre-submission-list',
        editItem: item
      });
    } catch (err) {
      console.error('Pre-submission edit page error:', err);
      req.flash('error', 'Failed to load pre-submission.');
      res.redirect('/dashboard/pre-submissions');
    }
  },

  /**
   * Handle IC/payslip upload, run OCR via AI
   */
  async processDocument(req, res) {
    try {
      if (!req.file) return res.json({ success: false, error: 'No file uploaded.' });

      const docType = req.body.doc_type || 'ic';
      const result = docType === 'payslip'
        ? await OcrService.analyzePayslip(req.file.path)
        : await OcrService.analyzeIC(req.file.path);

      try { fs.unlinkSync(req.file.path); } catch {}

      res.json({ success: true, ic: result.ic || '', name: result.name || '' });
    } catch (err) {
      console.error('Pre-submission OCR error:', err);
      if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
      res.json({ success: false, error: 'Failed to process document.' });
    }
  },

  /**
   * Save a new or update existing pre-submission
   */
  async save(req, res) {
    try {
      const currentUser = req.session.user;
      const { id, customer_name, ic_number } = req.body;

      if (id) {
        await prisma.preSubmission.update({
          where: { id },
          data: { customer_name: customer_name || null, ic_number: ic_number || null }
        });
        req.flash('success', 'Pre-submission updated.');
      } else {
        await prisma.preSubmission.create({
          data: {
            customer_name: customer_name || null,
            ic_number: ic_number || null,
            created_by: currentUser.id
          }
        });
        req.flash('success', 'Pre-submission saved.');
      }
      res.redirect('/dashboard/pre-submissions');
    } catch (err) {
      console.error('Pre-submission save error:', err);
      req.flash('error', 'Failed to save pre-submission.');
      res.redirect('/dashboard/pre-submission');
    }
  },

  /**
   * Update product key for a pre-submission
   */
  async updateProduct(req, res) {
    try {
      const { product_key } = req.body;
      await prisma.preSubmission.update({
        where: { id: req.params.id },
        data: { product_key: product_key || null }
      });
      req.flash('success', 'Product updated.');
      res.redirect(`/dashboard/pre-submissions/${req.params.id}`);
    } catch (err) {
      console.error('Pre-submission update product error:', err);
      req.flash('error', 'Failed to update product.');
      res.redirect(`/dashboard/pre-submissions/${req.params.id}`);
    }
  },

  /**
   * Delete a pre-submission
   */
  async deleteItem(req, res) {
    try {
      await prisma.preSubmission.delete({ where: { id: req.params.id } });
      req.flash('success', 'Pre-submission deleted.');
      res.redirect('/dashboard/pre-submissions');
    } catch (err) {
      console.error('Pre-submission delete error:', err);
      req.flash('error', 'Failed to delete.');
      res.redirect('/dashboard/pre-submissions');
    }
  },

  /**
   * Generate loan product PDF for a pre-submission
   */
  async generateProductPdf(req, res) {
    try {
      const item = await prisma.preSubmission.findUnique({ where: { id: req.params.id } });
      if (!item) return res.status(404).send('Not found');

      const productKey = req.params.template;

      // Build submission data with name + IC for PDF template filling
      const submissionData = {
        applicant_data: {
          name: item.customer_name || '',
          ic: item.ic_number || ''
        },
        spouse_data: {},
        job_data: {},
        reference_data: {}
      };

      const flatten = req.query.flatten !== '0';
      const pdfBuffer = await PdfService.fillTemplate(productKey, submissionData, { flatten });

      const safeName = (item.customer_name || 'unknown').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
      const filename = `${productKey}_${safeName}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      if (req.query.view === '1') {
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      } else {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      }
      res.send(pdfBuffer);
    } catch (err) {
      console.error('Pre-submission PDF error:', err);
      req.flash('error', 'Failed to generate PDF: ' + err.message);
      res.redirect(`/dashboard/pre-submissions/${req.params.id}`);
    }
  }
};

module.exports = PreSubmissionController;
