const prisma = require('../config/db');
const encryption = require('../services/encryption.service');

const Submission = {
  async create({ subagent_id, masteragent_id, referral_code, product_key, applicant_data, spouse_data, job_data, reference_data, status = 'pending', needs_image_review = false, agent_message = null }) {
    const submission = await prisma.submission.create({
      data: {
        subagent_id: subagent_id || null,
        masteragent_id: masteragent_id || null,
        referral_code: referral_code || null,
        product_key: product_key || null,
        status,
        needs_image_review: needs_image_review || false,
        agent_message: agent_message || null
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
      include: {
        details: true,
        taker: { select: { username: true } },
        subagent: { select: { username: true } },
        masteragent: { select: { username: true } }
      }
    });
    if (!row) return null;

    const details = row.details || {};
    try { row.applicant_data = JSON.parse(encryption.decrypt(details.applicant_data)); } catch { row.applicant_data = {}; }
    try { row.spouse_data = JSON.parse(encryption.decrypt(details.spouse_data)); } catch { row.spouse_data = {}; }
    try { row.job_data = JSON.parse(encryption.decrypt(details.job_data)); } catch { row.job_data = {}; }
    try { row.reference_data = JSON.parse(encryption.decrypt(details.reference_data)); } catch { row.reference_data = {}; }

    row.taken_by_name = row.taker?.username || null;
    row.subagent_name = row.subagent?.username || null;
    row.masteragent_name = row.masteragent?.username || null;
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
        masteragent_name: row.masteragent?.username || '-',
        subagent_name: row.subagent?.username || '-',
        agent_name: row.subagent?.username || row.masteragent?.username || '-',
        taken_by_name: row.taker?.username || null
      };
    });
  },

  // Case list: only pending + not taken (exclude drafts)
  async findPendingUntaken() {
    const rows = await prisma.submission.findMany({
      where: { status: 'pending', taken_by: null },
      orderBy: { created_at: 'asc' },
      include: {
        subagent: { select: { username: true } },
        masteragent: { select: { username: true } },
        details: { select: { applicant_data: true, job_data: true } }
      }
    });
    return this._withNames(rows);
  },

  // Agent case list: pending untaken cases
  async findByAgent(userId, role) {
    if (role === 'superadmin' || role === 'admin') {
      // Only pending + not taken
      const rows = await prisma.submission.findMany({
        where: { status: 'pending', taken_by: null },
        orderBy: { created_at: 'asc' },
        include: {
          subagent: { select: { username: true } },
          masteragent: { select: { username: true } },
          details: { select: { applicant_data: true, job_data: true } }
        }
      });
      return this._withNames(rows);
    }
    const where = role === 'masteragent'
      ? { masteragent_id: userId, status: { not: 'draft' } }
      : { subagent_id: userId, status: { not: 'draft' } };
    const rows = await prisma.submission.findMany({
      where,
      orderBy: { created_at: 'asc' },
      include: {
        subagent: { select: { username: true } },
        masteragent: { select: { username: true } },
        details: { select: { applicant_data: true, job_data: true } }
      }
    });
    return this._withNames(rows);
  },

  // Taken cases
  async findTaken(userId, role) {
    const where = (role === 'superadmin' || role === 'admin')
      ? { taken_by: { not: null } }
      : { taken_by: userId };
    const rows = await prisma.submission.findMany({
      where,
      orderBy: { taken_at: 'desc' },
      include: {
        subagent: { select: { username: true } },
        masteragent: { select: { username: true } },
        taker: { select: { username: true } },
        details: { select: { applicant_data: true, job_data: true } }
      }
    });
    return this._withNames(rows);
  },

  // Taken cases with server-side filters + pagination
  async findTakenFiltered(userId, role, { search, dateFrom, dateTo, taker, page = 1, perPage = 20 } = {}) {
    const where = (role === 'superadmin' || role === 'admin')
      ? { taken_by: { not: null } }
      : { taken_by: userId };

    // Date filter on taken_at
    if (dateFrom || dateTo) {
      where.taken_at = {};
      if (dateFrom) where.taken_at.gte = new Date(dateFrom + 'T00:00:00');
      if (dateTo) where.taken_at.lte = new Date(dateTo + 'T23:59:59');
    }

    // Taker filter (by user id)
    if (taker) {
      where.taken_by = taker;
    }

    // Get unique takers for dropdown (unfiltered, just all takers visible to user)
    const takerWhere = (role === 'superadmin' || role === 'admin')
      ? { taken_by: { not: null } }
      : { taken_by: userId };
    const allTakers = await prisma.submission.findMany({
      where: takerWhere,
      select: { taker: { select: { id: true, username: true } } },
      distinct: ['taken_by']
    });
    const takerList = allTakers
      .map(r => r.taker)
      .filter(Boolean)
      .sort((a, b) => a.username.localeCompare(b.username));

    // Fetch ALL matching rows (no pagination yet — need to decrypt and search first)
    const rows = await prisma.submission.findMany({
      where,
      orderBy: { taken_at: 'desc' },
      include: {
        subagent: { select: { username: true } },
        masteragent: { select: { username: true } },
        taker: { select: { username: true } },
        details: { select: { applicant_data: true, job_data: true } }
      }
    });

    let results = await this._withNames(rows);

    // Text search filter on decrypted names (can't do in DB due to encryption)
    if (search) {
      const q = search.toLowerCase();
      results = results.filter(r =>
        (r.applicant_name || '').toLowerCase().includes(q) ||
        (r.applicant_ic || '').toLowerCase().includes(q) ||
        (r.employer_name || '').toLowerCase().includes(q)
      );
    }

    // Paginate AFTER search filtering
    const total = results.length;
    const totalPages = Math.ceil(total / perPage) || 1;
    const safePage = Math.min(page, totalPages);
    const paginated = results.slice((safePage - 1) * perPage, safePage * perPage);

    return { results: paginated, total, takerList, page: safePage, perPage, totalPages };
  },

  async takeCase(id, userId) {
    // Atomic: only take if not already taken (prevents race condition)
    const result = await prisma.submission.updateMany({
      where: { id, taken_by: null },
      data: { taken_by: userId, taken_at: new Date(), released_at: null, release_reason: null }
    });
    if (result.count === 0) {
      throw new Error('Case already taken by someone else.');
    }
    return result;
  },

  async updateProduct(id, productKey) {
    return prisma.submission.update({
      where: { id },
      data: { product_key: productKey || null }
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
    let where;
    if (role === 'superadmin' || role === 'admin') {
      where = { status: 'draft' };
    } else if (role === 'masteragent') {
      where = { masteragent_id: userId, status: 'draft' };
    } else {
      where = { subagent_id: userId, status: 'draft' };
    }
    const rows = await prisma.submission.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        details: { select: { applicant_data: true } }
      }
    });
    return rows.map(row => {
      let applicant_name = '-';
      let applicant_ic = '-';
      try {
        const data = JSON.parse(encryption.decrypt(row.details?.applicant_data));
        applicant_name = data.name || '-';
        applicant_ic = data.ic || '-';
      } catch {}
      return { ...row, applicant_name, applicant_ic };
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
        subagent: { select: { username: true } },
        masteragent: { select: { username: true } },
        taker: { select: { username: true } },
        details: { select: { applicant_data: true, job_data: true } }
      }
    });
    return this._withNames(rows);
  },

  async findRecentlyModified(userId, role, limit = 10) {
    let where = { status: { not: 'draft' }, taken_by: { not: null } };
    if (role === 'masteragent') {
      where.masteragent_id = userId;
    } else if (role === 'subagent') {
      where.subagent_id = userId;
    }
    // Filtering updated_at > created_at done client-side

    const rows = await prisma.submission.findMany({
      where,
      orderBy: { updated_at: 'desc' },
      take: limit,
      include: {
        subagent: { select: { username: true } },
        masteragent: { select: { username: true } },
        taker: { select: { username: true } },
        details: { select: { applicant_data: true, job_data: true } }
      }
    });

    // Filter client-side: only where updated_at differs from created_at by at least 1 second
    const modified = rows.filter(r => {
      const diff = Math.abs(new Date(r.updated_at) - new Date(r.created_at));
      return diff > 1000;
    });

    return this._withNames(modified);
  }
};

module.exports = Submission;
