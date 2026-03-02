const Submission = require('../models/submission.model');
const FileModel = require('../models/file.model');
const Activity = require('../models/activity.model');
const ReferralService = require('../services/referral.service');
const PdfService = require('../services/pdf.service');
const WsService = require('../services/ws.service');
const prisma = require('../config/db');
const path = require('path');
const fs = require('fs');
const ImageQualityService = require('../services/image-quality.service');
const Setting = require('../models/setting.model');

function getYearMonth(date) {
  const d = date || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

const FILE_FIELDS = [
  { name: 'ic_depan', maxCount: 1 },
  { name: 'ic_belakang', maxCount: 1 },
  { name: 'payslip1', maxCount: 1 },
  { name: 'payslip2', maxCount: 1 },
  { name: 'payslip3', maxCount: 1 },
  { name: 'bank_page', maxCount: 1 },
  { name: 'signature', maxCount: 1 },
  { name: 'chop_sign', maxCount: 1 },
  { name: 'bill_rumah', maxCount: 1 },
  { name: 'settlement_letter', maxCount: 1 },
  { name: 'other_doc', maxCount: 10 }
];

const REQUIRED_FILES = ['ic_depan', 'ic_belakang', 'payslip1', 'payslip2', 'payslip3', 'bank_page', 'signature', 'chop_sign', 'bill_rumah'];
const REQUIRED_FILE_LABELS = {
  ic_depan: 'IC Depan',
  ic_belakang: 'IC Belakang',
  payslip1: 'Payslip Terkini 1',
  payslip2: 'Payslip Terkini 2',
  payslip3: 'Payslip Terkini 3',
  bank_page: 'Muka Surat Akaun Bank',
  signature: 'Tandatangan Customer',
  chop_sign: 'Chop Bulat, Chop Nama & Sign Majikan',
  bill_rumah: 'Bill Rumah'
};

const SubmissionController = {
  FILE_FIELDS,
  REQUIRED_FILES,
  REQUIRED_FILE_LABELS,

  async submitPage(req, res) {
    const ref = req.query.ref || '';
    const productParam = req.query.product || '';
    let agentName = null;

    if (ref) {
      agentName = await ReferralService.getAgentName(ref);
    }

    const PdfService = require('../services/pdf.service');
    const loanProducts = PdfService.getLoanProducts();

    res.render('public/submit', {
      layout: false,
      title: 'Submit Application',
      ref,
      agentName,
      loanProducts,
      selectedProduct: productParam,
      success: req.flash ? req.flash('success') : null,
      error: req.flash ? req.flash('error') : null
    });
  },

  async privateSubmitPage(req, res) {
  try {
    const currentUser = req.session.user;
    const User = require('../models/user.model');
    const PdfService = require('../services/pdf.service');
    const fullUser = await User.findById(currentUser.id);
    const ref = fullUser?.referral_code || '';

    // Fetch agents list for admin/superadmin to assign referer
    const isAdmin = currentUser.role === 'superadmin' || currentUser.role === 'admin';
    const agents = isAdmin ? await User.findAgents() : [];
    const loanProducts = PdfService.getLoanProducts();

    res.render('dashboard/submit', {
      layout: 'layouts/main',
      title: 'New Submission',
      user: currentUser,
      ref,
      agents,
      loanProducts,
      page: 'submit'
    });
  } catch (err) {
    console.error('Private submit page error:', err);
    req.flash('error', 'Failed to load submission form.');
    res.redirect('/dashboard');
  }
},

  async submitForm(req, res) {
  try {
    const { referral_code, action, product_key } = req.body;
    const isPrivate = req.session && req.session.user;
      const isDraft = action === 'draft';
      const draftId = req.body.draft_id || null;
      const redirectUrl = isPrivate ? '/dashboard/submit-new' : `/submit?ref=${referral_code || ''}`;

      // Server-side validation (skip for drafts)
      if (!isDraft) {
        const required = [
          ['applicant_name', 'Nama Pemohon'],
          ['applicant_ic', 'No KP Pemohon'],
          ['applicant_phone', 'No Tel Pemohon'],
          ['applicant_email', 'Email Pemohon'],
          ['applicant_address', 'Alamat Pemohon'],
          ['applicant_tanggungan', 'Bilangan Tanggungan'],
          ['applicant_pendidikan', 'Taraf Pendidikan'],
          ['applicant_jenis_kediaman', 'Jenis Kediaman'],
          ['applicant_tempoh_menetap', 'Tempoh Menetap'],
          ['applicant_nama_ibu', 'Nama Ibu'],
          ['applicant_ic_ibu', 'No IC Ibu'],
          ['applicant_hp_ibu', 'No HP Ibu'],
          ['applicant_alamat_ibu', 'Alamat Ibu'],
          ['spouse_name', 'Nama Pasangan'],
          ['spouse_ic', 'No IC Pasangan'],
          ['spouse_jawatan', 'Jawatan Pasangan'],
          ['spouse_alamat_majikan', 'Alamat Majikan Pasangan'],
          ['spouse_tel_pejabat', 'Tel Pejabat Pasangan'],
          ['spouse_phone', 'Tel Bimbit Pasangan'],
          ['spouse_gaji', 'Gaji Pasangan'],
          ['job_employer', 'Nama Majikan'],
          ['job_alamat_majikan', 'Alamat Majikan'],
          ['job_position', 'Jawatan'],
          ['job_tarikh_mula', 'Tarikh Mula Berkhidmat'],
          ['job_tel_pejabat', 'No Tel Pejabat'],
          ['ref_name', 'Nama Rujukan'],
          ['ref_ic', 'No IC Rujukan'],
          ['ref_address', 'Alamat Rujukan'],
          ['ref_phone', 'No Tel Rujukan'],
          ['ref_relationship', 'Pertalian Rujukan']
        ];

        const missing = required.filter(([field]) => !req.body[field] || !req.body[field].trim());
        if (missing.length > 0) {
          const names = missing.map(([, label]) => label).join(', ');
          req.flash('error', `Sila isi semua maklumat yang diperlukan: ${names}`);
          return res.redirect(redirectUrl);
        }
      }

      // File upload validation (skip for drafts)
      if (!isDraft) {
        const uploadedFiles = req.files || {};
        const missingFiles = REQUIRED_FILES.filter(f => !uploadedFiles[f] || uploadedFiles[f].length === 0);
        if (missingFiles.length > 0) {
          const names = missingFiles.map(f => REQUIRED_FILE_LABELS[f] || f).join(', ');
          req.flash('error', `Sila muat naik dokumen yang diperlukan: ${names}`);
          return res.redirect(redirectUrl);
        }
      }

      // Check if user acknowledged image quality warnings
      const needsImageReview = !isDraft && req.body.iq_warned_files && req.body.iq_warned_files.trim().length > 0;

      const { subagent_id, masteragent_id } = await (async () => {
        // If admin/superadmin assigned an agent directly
        if (req.body.assign_agent && req.session && req.session.user) {
          const role = req.session.user.role;
          if (role === 'superadmin' || role === 'admin') {
            const User = require('../models/user.model');
            const agent = await User.findById(req.body.assign_agent);
            if (agent) {
              if (agent.role === 'subagent') {
                return { subagent_id: agent.id, masteragent_id: agent.parent_id };
              }
              if (agent.role === 'masteragent') {
                return { subagent_id: null, masteragent_id: agent.id };
              }
            }
          }
        }
        return ReferralService.resolve(referral_code);
      })();

      // Normalize IC: remove all non-numeric characters
      const normalizeIC = (val) => val ? val.replace(/\D/g, '') : '';

      const applicant_data = {
        name: req.body.applicant_name,
        ic: normalizeIC(req.body.applicant_ic),
        phone: req.body.applicant_phone,
        email: req.body.applicant_email,
        address: req.body.applicant_address,
        tanggungan: req.body.applicant_tanggungan,
        pendidikan: req.body.applicant_pendidikan,
        jenis_kediaman: req.body.applicant_jenis_kediaman,
        tempoh_menetap: req.body.applicant_tempoh_menetap,
        nama_ibu: req.body.applicant_nama_ibu,
        ic_ibu: normalizeIC(req.body.applicant_ic_ibu),
        hp_ibu: req.body.applicant_hp_ibu,
        alamat_ibu: req.body.applicant_alamat_ibu
      };

      const spouse_data = {
        name: req.body.spouse_name,
        ic: normalizeIC(req.body.spouse_ic),
        jawatan: req.body.spouse_jawatan,
        alamat_majikan: req.body.spouse_alamat_majikan,
        tel_pejabat: req.body.spouse_tel_pejabat,
        phone: req.body.spouse_phone,
        gaji: req.body.spouse_gaji
      };

      const job_data = {
        employer: req.body.job_employer,
        alamat_majikan: req.body.job_alamat_majikan,
        position: req.body.job_position,
        tarikh_mula: req.body.job_tarikh_mula,
        tel_pejabat: req.body.job_tel_pejabat,
        payslip_link: req.body.job_payslip_link,
        payslip_password: req.body.job_payslip_password,
        hrmis_password: req.body.job_hrmis_password
      };

      const reference_data = {
        name: req.body.ref_name,
        ic: normalizeIC(req.body.ref_ic),
        address: req.body.ref_address,
        phone: req.body.ref_phone,
        relationship: req.body.ref_relationship
      };

      const status = isDraft ? 'draft' : 'pending';

      // If editing a draft, update it
      if (draftId && isDraft) {
        await Submission.updateDraft(draftId, { applicant_data, spouse_data, job_data, reference_data });
        req.flash('success', 'Draft saved.');
        return res.redirect('/dashboard/drafts');
      }

      // If submitting a draft (converting to pending)
      if (draftId && !isDraft) {
        await Submission.updateDraft(draftId, { applicant_data, spouse_data, job_data, reference_data, status: 'pending' });
        req.flash('success', 'Application submitted successfully!');
        return res.redirect(redirectUrl);
      }

      const submission = await Submission.create({
        subagent_id,
        masteragent_id,
        referral_code,
        product_key: product_key || null,
        applicant_data,
        spouse_data,
        job_data,
        reference_data,
        status,
        needs_image_review: needsImageReview
      });

      // Move files from temp to {uploadDir}/submissions/{YYYY-MM}/{IC}/
      const uploadDir = await Setting.getUploadDir();
      const ic = normalizeIC(req.body.applicant_ic) || submission.id;
      const ym = getYearMonth();
      const relDir = path.join('submissions', ym, ic);
      const destDir = path.join(uploadDir, relDir);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

      const files = req.files || {};
      for (const fieldName of Object.keys(files)) {
        for (const file of files[fieldName]) {
          const newPath = path.join(destDir, file.filename);
          fs.renameSync(file.path, newPath);

          await FileModel.create({
            submission_id: submission.id,
            file_type: fieldName,
            file_path: path.join(relDir, file.filename)
          });
        }
      }

      if (isDraft) {
        req.flash('success', 'Draft saved.');
        res.redirect('/dashboard/drafts');
      } else {
        // Notify admins via WebSocket
        let agentName = '-';
        if (subagent_id || masteragent_id) {
          try {
            const User = require('../models/user.model');
            const ag = await User.findById(subagent_id || masteragent_id);
            if (ag) agentName = ag.username;
          } catch(e) {}
        }
        WsService.notifyNewCase({ caseId: submission.id, applicantName: applicant_data.name, agentName });
        req.flash('success', 'Application submitted successfully!');
        res.redirect(redirectUrl);
      }
    } catch (err) {
      console.error('Submit error:', err);
      const isPrivate = req.session && req.session.user;
      const fallback = isPrivate ? '/dashboard/submit-new' : `/submit?ref=${req.body.referral_code || ''}`;
      req.flash('error', 'Failed to submit application.');
      res.redirect(fallback);
    }
  },

  async listCases(req, res) {
    try {
      const currentUser = req.session.user;
      const PdfService = require('../services/pdf.service');
      const submissions = await Submission.findByAgent(currentUser.id, currentUser.role);

      res.render('dashboard/cases', {
        layout: 'layouts/main',
        title: 'Case List',
        user: currentUser,
        submissions,
        loanProducts: PdfService.getLoanProducts(),
        page: 'cases'
      });
    } catch (err) {
      console.error('List cases error:', err);
      req.flash('error', 'Failed to load cases.');
      res.redirect('/dashboard');
    }
  },

  async viewCase(req, res) {
    try {
      const currentUser = req.session.user;
      const submission = await Submission.findById(req.params.id);
      if (!submission) {
        req.flash('error', 'Submission not found.');
        return res.redirect('/dashboard/cases');
      }

      const files = await FileModel.findBySubmission(submission.id);
      const loanProducts = PdfService.getLoanProducts();

      // Load admin files (superadmin only)
      let adminFiles = [];
      if (currentUser.role === 'superadmin') {
        adminFiles = await prisma.adminCaseFile.findMany({
          where: { submission_id: submission.id },
          orderBy: { uploaded_at: 'desc' }
        });
      }

      res.render('dashboard/case-detail', {
        layout: 'layouts/main',
        title: 'Case Detail',
        user: currentUser,
        submission,
        files,
        adminFiles,
        loanProducts,
        page: 'cases'
      });
    } catch (err) {
      console.error('View case error:', err);
      req.flash('error', 'Failed to load case.');
      res.redirect('/dashboard/cases');
    }
  },

  async updateStatus(req, res) {
    try {
      const currentUser = req.session.user;
      const { id } = req.params;
      const { status } = req.body;

      await Submission.updateStatus(id, status);

      await Activity.log({
        user_id: currentUser.id,
        action: 'UPDATE_STATUS',
        target_id: id,
        description: `Updated submission status to ${status}`
      });

      req.flash('success', 'Status updated.');
      res.redirect(`/dashboard/cases/${id}`);
    } catch (err) {
      console.error('Update status error:', err);
      req.flash('error', 'Failed to update status.');
      res.redirect('/dashboard/cases');
    }
  },

  async downloadFile(req, res) {
    try {
      const currentUser = req.session.user;

      if (currentUser.role !== 'superadmin' && currentUser.role !== 'admin') {
        return res.status(403).send('Forbidden');
      }

      const file = await FileModel.findById(req.params.fileId);
      if (!file) return res.status(404).send('File not found');

      const uploadDir = await Setting.getUploadDir();
      // Try new path first, fall back to legacy project-root path
      let filePath = path.join(uploadDir, file.file_path);
      if (!fs.existsSync(filePath)) {
        filePath = path.join(__dirname, '../../', file.file_path);
      }
      if (!fs.existsSync(filePath)) return res.status(404).send('File not found on disk');

      await Activity.log({
        user_id: currentUser.id,
        action: 'DOWNLOAD_FILE',
        target_id: file.submission_id,
        description: `Downloaded file: ${file.file_type}`
      });

      res.download(filePath, file.file_type + path.extname(file.file_path));
    } catch (err) {
      console.error('Download error:', err);
      res.status(500).send('Download failed');
    }
  },

  // --- Case Assignment ---
  async takeCase(req, res) {
    try {
      const currentUser = req.session.user;
      if (currentUser.role !== 'superadmin' && currentUser.role !== 'admin') {
        req.flash('error', 'Only admin can take cases.');
        return res.redirect('/dashboard/cases');
      }
      await Submission.takeCase(req.params.id, currentUser.id);
      await Activity.log({
        user_id: currentUser.id,
        action: 'TAKE_CASE',
        target_id: req.params.id,
        description: `Took case ${req.params.id}`
      });
      WsService.notifyCaseTaken(req.params.id, currentUser.username);
      req.flash('success', 'Case taken.');
      res.redirect(`/dashboard/cases/${req.params.id}`);
    } catch (err) {
      console.error('Take case error:', err);
      req.flash('error', err.message || 'Failed to take case.');
      res.redirect('/dashboard/cases');
    }
  },

  async updateProduct(req, res) {
    try {
      const { product_key } = req.body;
      await Submission.updateProduct(req.params.id, product_key);
      req.flash('success', 'Product updated.');
      res.redirect(`/dashboard/cases/${req.params.id}`);
    } catch (err) {
      console.error('Update product error:', err);
      req.flash('error', 'Failed to update product.');
      res.redirect(`/dashboard/cases/${req.params.id}`);
    }
  },

  async releaseCase(req, res) {
    try {
      const currentUser = req.session.user;
      const { release_reason } = req.body;
      await Submission.releaseCase(req.params.id, release_reason || '');
      await Activity.log({
        user_id: currentUser.id,
        action: 'RELEASE_CASE',
        target_id: req.params.id,
        description: `Released case: ${release_reason || 'No reason'}`
      });
      req.flash('success', 'Case released.');
      res.redirect('/dashboard/taken-cases');
    } catch (err) {
      console.error('Release case error:', err);
      req.flash('error', 'Failed to release case.');
      res.redirect('/dashboard/taken-cases');
    }
  },

  async listTakenCases(req, res) {
    try {
      const currentUser = req.session.user;
      const PdfService = require('../services/pdf.service');
      const submissions = await Submission.findTaken(currentUser.id, currentUser.role);
      res.render('dashboard/taken-cases', {
        layout: 'layouts/main',
        title: 'Taken Cases',
        user: currentUser,
        submissions,
        loanProducts: PdfService.getLoanProducts(),
        page: 'taken-cases'
      });
    } catch (err) {
      console.error('Taken cases error:', err);
      req.flash('error', 'Failed to load taken cases.');
      res.redirect('/dashboard');
    }
  },

  // --- Drafts ---
  async listDrafts(req, res) {
    try {
      const currentUser = req.session.user;
      const PdfService = require('../services/pdf.service');
      const drafts = await Submission.findDrafts(currentUser.id, currentUser.role);
      res.render('dashboard/drafts', {
        layout: 'layouts/main',
        title: 'My Drafts',
        user: currentUser,
        drafts,
        loanProducts: PdfService.getLoanProducts(),
        page: 'drafts',
        success: req.flash('success'),
        error: req.flash('error')
      });
    } catch (err) {
      console.error('List drafts error:', err);
      req.flash('error', 'Failed to load drafts.');
      res.redirect('/dashboard');
    }
  },

  async editDraft(req, res) {
    try {
      const currentUser = req.session.user;
      const submission = await Submission.findById(req.params.id);
      if (!submission || submission.status !== 'draft') {
        req.flash('error', 'Draft not found.');
        return res.redirect('/dashboard/drafts');
      }
      const User = require('../models/user.model');
      const fullUser = await User.findById(currentUser.id);
      const ref = fullUser?.referral_code || '';

      const isAdmin = currentUser.role === 'superadmin' || currentUser.role === 'admin';
      const agents = isAdmin ? await User.findAgents() : [];

      res.render('dashboard/submit', {
        layout: 'layouts/main',
        title: 'Edit Draft',
        user: currentUser,
        ref,
        agents,
        page: 'drafts',
        draft: submission
      });
    } catch (err) {
      console.error('Edit draft error:', err);
      req.flash('error', 'Failed to load draft.');
      res.redirect('/dashboard/drafts');
    }
  },

  async deleteDraft(req, res) {
    try {
      await Submission.deleteDraft(req.params.id);
      req.flash('success', 'Draft deleted.');
      res.redirect('/dashboard/drafts');
    } catch (err) {
      console.error('Delete draft error:', err);
      req.flash('error', 'Failed to delete draft.');
      res.redirect('/dashboard/drafts');
    }
  },

  // --- PDF / Loan Product Generation ---
  async generatePdf(req, res) {
    try {
      const currentUser = req.session.user;
      const submission = await Submission.findById(req.params.id);
      if (!submission) return res.status(404).send('Submission not found');

      // Only the person who took the case, or superadmin/admin can generate
      const isOwner = submission.taken_by === currentUser.id;
      const isAdmin = currentUser.role === 'superadmin' || currentUser.role === 'admin';
      if (!isOwner && !isAdmin) {
        return res.status(403).send('Forbidden');
      }

      const productKey = req.params.template;
      const flatten = req.query.flatten === '1';
      const pdfBuffer = await PdfService.fillTemplate(productKey, submission, { flatten });

      const applicantName = (submission.applicant_data?.name || 'unknown').replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `${productKey}_${applicantName}.pdf`;

      await Activity.log({
        user_id: currentUser.id,
        action: 'GENERATE_PDF',
        target_id: submission.id,
        description: `Generated loan product PDF: ${productKey}`
      });

      res.setHeader('Content-Type', 'application/pdf');
      if (req.query.view === '1') {
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      } else {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      }
      res.send(pdfBuffer);
    } catch (err) {
      console.error('PDF generation error:', err);
      req.flash('error', 'Failed to generate PDF: ' + err.message);
      res.redirect(`/dashboard/cases/${req.params.id}`);
    }
  },

  async checkImageQuality(req, res) {
    try {
      if (!req.file) return res.json({ issues: [], ok: true });

      // Only check images and PDFs
      const isImage = req.file.mimetype && req.file.mimetype.startsWith('image/');
      const isPdf = req.file.mimetype === 'application/pdf';
      if (!isImage && !isPdf) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.json({ issues: [], ok: true });
      }

      const result = await ImageQualityService.analyze(req.file.path, req.file.mimetype);

      // Clean up temp file
      try { fs.unlinkSync(req.file.path); } catch {}

      const issueLabels = {
        blurry: 'Gambar/dokumen kabur (blurry)',
        overexposed: 'Gambar terlalu terang (overexposed/flash)',
        glare: 'Ada pantulan cahaya (glare/flash)',
        too_dark: 'Gambar terlalu gelap',
        low_contrast: 'Gambar pudar / kurang jelas'
      };

      const messages = result.issues.map(i => issueLabels[i] || i);

      res.json({
        ok: result.issues.length === 0,
        issues: result.issues,
        messages,
        scores: result.scores
      });
    } catch (err) {
      console.error('Image quality check error:', err);
      if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
      res.json({ ok: true, issues: [] });
    }
  }
};

// --- Admin Case File Methods (Superadmin only) ---
const SubmissionController_adminFiles = {
  async uploadAdminFile(req, res) {
    try {
      if (req.session.user.role !== 'superadmin') {
        req.flash('error', 'Unauthorized.');
        return res.redirect('/dashboard/cases');
      }
      const { id } = req.params;
      const label = req.body.label || 'Untitled';
      const file = req.file;
      if (!file) {
        req.flash('error', 'No file selected.');
        return res.redirect(`/dashboard/cases/${id}`);
      }

      // Get IC from submission for folder name
      const submission = await Submission.findById(id);
      const ic = submission?.applicant_data?.ic || id;
      const uploadDir = await Setting.getUploadDir();
      const ym = getYearMonth();
      const relDir = path.join('admin_files', ym, ic);
      const destDir = path.join(uploadDir, relDir);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const destPath = path.join(destDir, file.filename);
      fs.renameSync(file.path, destPath);

      await prisma.adminCaseFile.create({
        data: {
          submission_id: id,
          label: label.trim(),
          file_path: path.join(relDir, file.filename),
          original_name: file.originalname
        }
      });

      req.flash('success', 'File uploaded.');
      res.redirect(`/dashboard/cases/${id}`);
    } catch (err) {
      console.error('Upload admin file error:', err);
      req.flash('error', 'Failed to upload file.');
      res.redirect(`/dashboard/cases/${req.params.id}`);
    }
  },

  async deleteAdminFile(req, res) {
    try {
      if (req.session.user.role !== 'superadmin') {
        req.flash('error', 'Unauthorized.');
        return res.redirect('/dashboard/cases');
      }
      const { id, fileId } = req.params;
      const record = await prisma.adminCaseFile.findUnique({ where: { id: parseInt(fileId) } });
      if (record) {
        const uploadDir = await Setting.getUploadDir();
        let fullPath = path.join(uploadDir, record.file_path);
        if (!fs.existsSync(fullPath)) {
          fullPath = path.join(__dirname, '../../', record.file_path);
        }
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        await prisma.adminCaseFile.delete({ where: { id: parseInt(fileId) } });
      }
      req.flash('success', 'File deleted.');
      res.redirect(`/dashboard/cases/${id}`);
    } catch (err) {
      console.error('Delete admin file error:', err);
      req.flash('error', 'Failed to delete file.');
      res.redirect(`/dashboard/cases/${req.params.id}`);
    }
  },

  async downloadAdminFile(req, res) {
    try {
      if (req.session.user.role !== 'superadmin') {
        req.flash('error', 'Unauthorized.');
        return res.redirect('/dashboard/cases');
      }
      const record = await prisma.adminCaseFile.findUnique({ where: { id: parseInt(req.params.fileId) } });
      if (!record) {
        req.flash('error', 'File not found.');
        return res.redirect('/dashboard/cases');
      }
      const uploadDir = await Setting.getUploadDir();
      let fullPath = path.join(uploadDir, record.file_path);
      if (!fs.existsSync(fullPath)) {
        fullPath = path.join(__dirname, '../../', record.file_path);
      }
      res.download(fullPath, record.original_name);
    } catch (err) {
      console.error('Download admin file error:', err);
      req.flash('error', 'Failed to download file.');
      res.redirect('/dashboard/cases');
    }
  },

  async downloadAllFiles(req, res) {
    try {
      const { id } = req.params;
      const files = await FileModel.findBySubmission(id);
      if (!files.length) {
        req.flash('error', 'No files to download.');
        return res.redirect(`/dashboard/cases/${id}`);
      }
      const archiver = require('archiver');
      const archive = archiver('zip', { zlib: { level: 5 } });
      const submission = await Submission.findById(id);
      const safeName = (submission?.applicant_name || 'case').replace(/[^a-zA-Z0-9]/g, '_');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}_documents.zip"`);
      archive.pipe(res);
      const uploadDir = await Setting.getUploadDir();
      for (const f of files) {
        let fullPath = path.join(uploadDir, f.file_path);
        if (!fs.existsSync(fullPath)) {
          fullPath = path.join(__dirname, '../../', f.file_path);
        }
        if (fs.existsSync(fullPath)) {
          archive.file(fullPath, { name: f.file_type + path.extname(f.file_path) });
        }
      }
      await archive.finalize();
    } catch (err) {
      console.error('Download all files error:', err);
      req.flash('error', 'Failed to download files.');
      res.redirect(`/dashboard/cases/${req.params.id}`);
    }
  },

  async downloadAllAdminFiles(req, res) {
    try {
      if (req.session.user.role !== 'superadmin') {
        req.flash('error', 'Unauthorized.');
        return res.redirect('/dashboard/cases');
      }
      const { id } = req.params;
      const adminFiles = await prisma.adminCaseFile.findMany({ where: { submission_id: id } });
      if (!adminFiles.length) {
        req.flash('error', 'No admin files to download.');
        return res.redirect(`/dashboard/cases/${id}`);
      }
      const archiver = require('archiver');
      const archive = archiver('zip', { zlib: { level: 5 } });
      const submission = await Submission.findById(id);
      const safeName = (submission?.applicant_name || 'case').replace(/[^a-zA-Z0-9]/g, '_');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}_admin_files.zip"`);
      archive.pipe(res);
      const uploadDir = await Setting.getUploadDir();
      for (const af of adminFiles) {
        let fullPath = path.join(uploadDir, af.file_path);
        if (!fs.existsSync(fullPath)) {
          fullPath = path.join(__dirname, '../../', af.file_path);
        }
        if (fs.existsSync(fullPath)) {
          archive.file(fullPath, { name: af.label + '_' + af.original_name });
        }
      }
      await archive.finalize();
    } catch (err) {
      console.error('Download all admin files error:', err);
      req.flash('error', 'Failed to download files.');
      res.redirect(`/dashboard/cases/${req.params.id}`);
    }
  }
};

// Merge admin file methods into SubmissionController
Object.assign(SubmissionController, SubmissionController_adminFiles);

module.exports = SubmissionController;
