const prisma = require('../config/db');

const User = {
  async create({ name, email, role, parent_id, created_by }) {
    const referral_code = (role === 'masteragent' || role === 'subagent')
      ? `REF-${Date.now().toString(36).toUpperCase()}`
      : null;

    return prisma.user.create({
      data: { name, email, role, referral_code, parent_id: parent_id || null, created_by: created_by || null }
    });
  },

  async findById(id) {
    return prisma.user.findUnique({ where: { id } });
  },

  async findByEmail(email) {
    return prisma.user.findUnique({ where: { email } });
  },

  async findByReferralCode(code) {
    return prisma.user.findFirst({ where: { referral_code: code } });
  },

  async findByRole(role) {
    return prisma.user.findMany({ where: { role } });
  },

  async findByParent(parentId) {
    return prisma.user.findMany({ where: { parent_id: parentId } });
  },

  async findAll() {
    return prisma.user.findMany({ orderBy: { created_at: 'desc' } });
  },

  async findVisible(user) {
    if (user.role === 'superadmin') {
      return prisma.user.findMany({ orderBy: { created_at: 'desc' } });
    }
    if (user.role === 'admin') {
      return prisma.user.findMany({
        where: { OR: [{ created_by: user.id }, { parent_id: user.id }, { id: user.id }] },
        orderBy: { created_at: 'desc' }
      });
    }
    if (user.role === 'masteragent') {
      return prisma.user.findMany({
        where: { OR: [{ parent_id: user.id }, { id: user.id }] },
        orderBy: { created_at: 'desc' }
      });
    }
    return [await prisma.user.findUnique({ where: { id: user.id } })];
  },

  async findAgents() {
    return prisma.user.findMany({
      where: { role: { in: ['masteragent', 'subagent'] } },
      orderBy: [{ role: 'asc' }, { name: 'asc' }]
    });
  },

  async update(id, data) {
    return prisma.user.update({ where: { id }, data });
  },

  async delete(id) {
    return prisma.user.delete({ where: { id } });
  }
};

module.exports = User;
