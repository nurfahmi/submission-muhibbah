const prisma = require('../config/db');

const Activity = {
  async log({ user_id, action, target_id, description }) {
    try {
      return await prisma.activityLog.create({
        data: { user_id, action, target_id: target_id || null, description: description || null }
      });
    } catch (err) {
      console.error('Activity log error (non-fatal):', err.message);
    }
  },

  async findByUser(userId) {
    return prisma.activityLog.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 100
    });
  },

  async findAll() {
    return prisma.activityLog.findMany({
      include: { user: { select: { name: true } } },
      orderBy: { created_at: 'desc' },
      take: 200
    });
  }
};

module.exports = Activity;
