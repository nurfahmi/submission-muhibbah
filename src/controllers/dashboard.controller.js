const Submission = require('../models/submission.model');
const User = require('../models/user.model');

const DashboardController = {
  async main(req, res) {
    try {
      const currentUser = req.session.user;
      const stats = await Submission.getStats(currentUser.id, currentUser.role);
      const users = await User.findVisible(currentUser);

      const totalAgents = users.filter(u => u.role === 'masteragent' || u.role === 'subagent').length;
      const totalMaster = users.filter(u => u.role === 'masteragent').length;
      const totalSub = users.filter(u => u.role === 'subagent').length;

      // Performance table
      const agents = users.filter(u => u.role === 'masteragent' || u.role === 'subagent');
      const performance = [];
      for (const agent of agents) {
        const agentStats = await Submission.getStats(agent.id, agent.role);
        performance.push({
          name: agent.name,
          role: agent.role,
          total: agentStats.total,
          pending: agentStats.pending,
          approved: agentStats.approved
        });
      }

      // Recent cases (newest 10)
      const recentCases = await Submission.findRecent(currentUser.id, currentUser.role, 10);

      // Get full user record for referral code
      const fullUser = await User.findById(currentUser.id);

      res.render('dashboard/main', {
        layout: 'layouts/main',
        title: 'Dashboard',
        user: currentUser,
        stats,
        totalAgents,
        totalMaster,
        totalSub,
        performance,
        recentCases,
        referralCode: fullUser?.referral_code || null,
        page: 'main'
      });
    } catch (err) {
      console.error('Dashboard error:', err);
      req.flash('error', 'Failed to load dashboard.');
      res.redirect('/auth/login');
    }
  },

  async newCasesCount(req, res) {
    try {
      const currentUser = req.session.user;
      if (currentUser.role !== 'superadmin' && currentUser.role !== 'admin') {
        return res.json({ count: 0 });
      }
      const prisma = require('../config/db');
      const count = await prisma.submission.count({
        where: { status: 'pending', taken_by: null }
      });
      res.json({ count });
    } catch (err) {
      res.json({ count: 0 });
    }
  }
};
module.exports = DashboardController;
