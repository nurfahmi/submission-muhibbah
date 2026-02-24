const prisma = require('../config/db');
const encryption = require('../services/encryption.service');

const Submission = {
  async create({ subagent_id, masteragent_id, referral_code, applicant_data, spouse_data, job_data, reference_data, status = 'pending', needs_image_review = false }) {
    const submission = await prisma.submission.create({
      data: {
        subagent_id: subagent_id || null,
        masteragent_id: masteragent_id || null,
        referral_code: referral_code || null,
        status,
        needs_image_review: needs_image_review || false
      }
    });

    await prisma.submissionDetail.create({
      data: {
        submission_id: submission.id,
        applicant_data: encryption.encrypt(JSON.stringify(applicant_data || {})),
        spouse_data: encryption.encrypt(JSON.stringify(spouse_data || {})),
        job_data: encryption.encrypt(JSON.stringify(job_data || {})),
        reference_data: encryption.encrypt(JSON.stringify(reference_data || {}))
      }
    });

    return submission;
  },

  async updateDraft(id, { applicant_data, spouse_data, job_data, reference_data, status }) {
    if (status) {
      await prisma.submission.update({ where: { id }, data: { status } });
    }
    await prisma.submissionDetail.update({
      where: { submission_id: id },
      data: {
        applicant_data: encryption.encrypt(JSON.stringify(applicant_data || {})),
        spouse_data: encryption.encrypt(JSON.stringify(spouse_data || {})),
        job_data: encryption.encrypt(JSON.stringify(job_data || {})),
        reference_data: encryption.encrypt(JSON.stringify(reference_data || {}))
      }
    });
  },

  async findById(id) {
    const row = await prisma.submission.findUnique({
      where: { id },
      include: { details: true, taker: { select: { name: true } } }
    });
    if (!row) return null;

    const details = row.details || {};
    try { row.applicant_data = JSON.parse(encryption.decrypt(details.applicant_data)); } catch { row.applicant_data = {}; }
    try { row.spouse_data = JSON.parse(encryption.decrypt(details.spouse_data)); } catch { row.spouse_data = {}; }
    try { row.job_data = JSON.parse(encryption.decrypt(details.job_data)); } catch { row.job_data = {}; }
    try { row.reference_data = JSON.parse(encryption.decrypt(details.reference_data)); } catch { row.reference_data = {}; }

    row.taken_by_name = row.taker?.name || null;
    return row;
  },

  async _withNames(rows) {
    return rows.map(row => {
      let applicant_name = '-';
      let applicant_ic = '-';
      let employer_name = '-';
      try {
        const data = JSON.parse(encryption.decrypt(row.details?.applicant_data));
        applicant_name = data.name || '-';
        applicant_ic = data.ic || '-';
      } catch {}
      try {
        const jobData = JSON.parse(encryption.decrypt(row.details?.job_data));
        employer_name = jobData.employer || '-';
      } catch {}
      return {
        ...row,
        applicant_name,
        applicant_ic,
        employer_name,
        agent_name: row.subagent?.name || row.masteragent?.name || '-',
        taken_by_name: row.taker?.name || null
      };
    });
  },

  // Case list: only pending + not taken (exclude drafts)
  async findPendingUntaken() {
    const rows = await prisma.submission.findMany({
      where: { status: 'pending', taken_by: null },
      orderBy: { created_at: 'asc' },
      include: {
        subagent: { select: { name: true } },
        masteragent: { select: { name: true } },
        details: { select: { applicant_data: true, job_data: true } }
      }
    });
    return this._withNames(rows);
  },

  // Agent case list: their own submitted (non-draft) cases
  async findByAgent(userId, role) {
    if (role === 'superadmin' || role === 'admin') {
      return this.findPendingUntaken();
    }
    const where = role === 'masteragent'
      ? { masteragent_id: userId, status: { not: 'draft' } }
      : { subagent_id: userId, status: { not: 'draft' } };
    const rows = await prisma.submission.findMany({
      where,
      orderBy: { created_at: 'asc' },
      include: {
        subagent: { select: { name: true } },
        masteragent: { select: { name: true } },
        details: { select: { applicant_data: true, job_data: true } }
      }
    });
    return this._withNames(rows);
  },

  // Taken cases
  async findTaken(userId, role) {
    const where = role === 'superadmin'
      ? { taken_by: { not: null } }
      : { taken_by: userId };
    const rows = await prisma.submission.findMany({
      where,
      orderBy: { taken_at: 'desc' },
      include: {
        subagent: { select: { name: true } },
        masteragent: { select: { name: true } },
        taker: { select: { name: true } },
        details: { select: { applicant_data: true, job_data: true } }
      }
    });
    return this._withNames(rows);
  },

  async takeCase(id, userId) {
    return prisma.submission.update({
      where: { id },
      data: { taken_by: userId, taken_at: new Date(), released_at: null, release_reason: null }
    });
  },

  async releaseCase(id, reason) {
    return prisma.submission.update({
      where: { id },
      data: { taken_by: null, taken_at: null, released_at: new Date(), release_reason: reason }
    });
  },

  // Drafts
  async findDrafts(userId, role) {
    const where = role === 'masteragent'
      ? { masteragent_id: userId, status: 'draft' }
      : { subagent_id: userId, status: 'draft' };
    const rows = await prisma.submission.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        details: { select: { applicant_data: true } }
      }
    });
    return rows.map(row => {
      let applicant_name = '-';
      try {
        const data = JSON.parse(encryption.decrypt(row.details?.applicant_data));
        applicant_name = data.name || '-';
      } catch {}
      return { ...row, applicant_name };
    });
  },

  async getDraftCounts() {
    const results = await prisma.submission.groupBy({
      by: ['subagent_id', 'masteragent_id'],
      where: { status: 'draft' },
      _count: true
    });
    const counts = {};
    results.forEach(r => {
      const agentId = r.subagent_id || r.masteragent_id;
      if (agentId) counts[agentId] = (counts[agentId] || 0) + r._count;
    });
    return counts;
  },

  async deleteDraft(id) {
    return prisma.submission.delete({ where: { id } });
  },

  async updateStatus(id, status) {
    return prisma.submission.update({ where: { id }, data: { status } });
  },

  async getStats(userId, role) {
    let where = {};
    if (role === 'masteragent') where = { masteragent_id: userId };
    else if (role === 'subagent') where = { subagent_id: userId };

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayOfWeek = now.getDay() || 7; // Make Sunday = 7
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const base = { ...where, status: { not: 'draft' } };

    const [total, today, thisWeek, thisMonth] = await Promise.all([
      prisma.submission.count({ where: base }),
      prisma.submission.count({ where: { ...base, created_at: { gte: startOfDay } } }),
      prisma.submission.count({ where: { ...base, created_at: { gte: startOfWeek } } }),
      prisma.submission.count({ where: { ...base, created_at: { gte: startOfMonth } } })
    ]);

    return { total, today, thisWeek, thisMonth };
  },

  async findRecent(userId, role, limit = 10) {
    let where = { status: { not: 'draft' } };
    if (role === 'superadmin' || role === 'admin') {
      // Admin sees only untaken pending cases (new cases notification)
      where.status = 'pending';
      where.taken_by = null;
    } else if (role === 'masteragent') {
      where.masteragent_id = userId;
    } else if (role === 'subagent') {
      where.subagent_id = userId;
    }

    const rows = await prisma.submission.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit,
      include: {
        subagent: { select: { name: true } },
        masteragent: { select: { name: true } },
        taker: { select: { name: true } },
        details: { select: { applicant_data: true, job_data: true } }
      }
    });
    return this._withNames(rows);
  }
};

module.exports = Submission;
