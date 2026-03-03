const Submission = require('../models/submission.model');
const User = require('../models/user.model');
const prisma = require('../config/db');

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
      let performance = [];

      if (currentUser.role === 'superadmin' || currentUser.role === 'admin') {
        // Show master agents with total cases (own + subagents')
        const masterAgents = users.filter(u => u.role === 'masteragent');
        for (const ma of masterAgents) {
          const totalCases = await prisma.submission.count({
            where: { masteragent_id: ma.id, status: { not: 'draft' } }
          });
          performance.push({ name: ma.username, total: totalCases });
        }
      } else if (currentUser.role === 'masteragent') {
        // Show own subagents
        const subAgents = users.filter(u => u.role === 'subagent' && u.parent_id === currentUser.id);
        for (const sa of subAgents) {
          const totalCases = await prisma.submission.count({
            where: { subagent_id: sa.id, status: { not: 'draft' } }
          });
          performance.push({ name: sa.username, total: totalCases });
        }
      }

      // Recent cases (newest 10)
      const recentCases = await Submission.findRecent(currentUser.id, currentUser.role, 10);

      // Get full user record for referral code
      const fullUser = await User.findById(currentUser.id);

      const PdfService = require('../services/pdf.service');

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
        loanProducts: PdfService.getLoanProducts(),
        enabledProducts: PdfService.getEnabledProducts(),
        baseUrl: req.protocol + '://' + req.get('host'),
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
