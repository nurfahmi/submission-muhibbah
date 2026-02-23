const User = require('../models/user.model');
const Activity = require('../models/activity.model');

const ROLE_HIERARCHY = {
  superadmin: ['admin', 'masteragent', 'subagent'],
  admin: ['masteragent', 'subagent'],
  masteragent: ['subagent'],
  subagent: []
};

const UserController = {
  async listUsers(req, res) {
    try {
      const currentUser = req.session.user;
      const users = await User.findVisible(currentUser);
      const creatableRoles = ROLE_HIERARCHY[currentUser.role] || [];
      const masterAgents = await User.findByRole('masteragent');

      res.render('dashboard/users', {
        layout: 'layouts/main',
        title: 'User Management',
        user: currentUser,
        users,
        creatableRoles,
        masterAgents,
        page: 'users',
        success: req.flash('success'),
        error: req.flash('error')
      });
    } catch (err) {
      console.error('List users error:', err);
      req.flash('error', 'Failed to load users.');
      res.redirect('/dashboard');
    }
  },

  async createUser(req, res) {
    try {
      const currentUser = req.session.user;
      const { name, email, role, parent_id } = req.body;

      const allowed = ROLE_HIERARCHY[currentUser.role] || [];
      if (!allowed.includes(role)) {
        req.flash('error', 'You are not allowed to create this role.');
        return res.redirect('/dashboard/users');
      }

      const existing = await User.findByEmail(email.trim().toLowerCase());
      if (existing) {
        req.flash('error', 'A user with this email already exists.');
        return res.redirect('/dashboard/users');
      }

      let assignedParent = parent_id || null;
      if (role === 'subagent' && currentUser.role === 'masteragent') {
        assignedParent = currentUser.id;
      }

      const newUser = await User.create({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role,
        parent_id: assignedParent,
        created_by: currentUser.id
      });

      await Activity.log({
        user_id: currentUser.id,
        action: 'CREATE_USER',
        target_id: newUser.id,
        description: `Created ${role}: ${name}`
      });

      req.flash('success', 'User created successfully.');
      res.redirect('/dashboard/users');
    } catch (err) {
      console.error('Create user error:', err);
      req.flash('error', 'Failed to create user.');
      res.redirect('/dashboard/users');
    }
  },

  async deleteUser(req, res) {
    try {
      const currentUser = req.session.user;
      const { id } = req.params;

      if (currentUser.role !== 'superadmin' && currentUser.role !== 'admin') {
        req.flash('error', 'Not authorized.');
        return res.redirect('/dashboard/users');
      }

      await User.delete(id);

      await Activity.log({
        user_id: currentUser.id,
        action: 'DELETE_USER',
        target_id: id,
        description: `Deleted user ${id}`
      });

      req.flash('success', 'User deleted.');
      res.redirect('/dashboard/users');
    } catch (err) {
      console.error('Delete user error:', err);
      req.flash('error', 'Failed to delete user.');
      res.redirect('/dashboard/users');
    }
  },

  async editUser(req, res) {
    try {
      const currentUser = req.session.user;
      const { id } = req.params;
      const { name, email, role, parent_id } = req.body;

      if (currentUser.role !== 'superadmin' && currentUser.role !== 'admin') {
        req.flash('error', 'Not authorized.');
        return res.redirect('/dashboard/users');
      }

      if (id === currentUser.id) {
        req.flash('error', 'Cannot edit your own account from here.');
        return res.redirect('/dashboard/users');
      }

      const allowed = ROLE_HIERARCHY[currentUser.role] || [];
      if (!allowed.includes(role)) {
        req.flash('error', 'You are not allowed to assign this role.');
        return res.redirect('/dashboard/users');
      }

      // Check email uniqueness (exclude current user)
      const existing = await User.findByEmail(email.trim().toLowerCase());
      if (existing && existing.id !== id) {
        req.flash('error', 'A user with this email already exists.');
        return res.redirect('/dashboard/users');
      }

      await User.update(id, {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role,
        parent_id: role === 'subagent' ? (parent_id || null) : null
      });

      await Activity.log({
        user_id: currentUser.id,
        action: 'EDIT_USER',
        target_id: id,
        description: `Updated user: ${name} (${role})`
      });

      req.flash('success', 'User updated successfully.');
      res.redirect('/dashboard/users');
    } catch (err) {
      console.error('Edit user error:', err);
      req.flash('error', 'Failed to update user.');
      res.redirect('/dashboard/users');
    }
  },

  async impersonate(req, res) {
    try {
      const currentUser = req.session.user;

      if (currentUser.role !== 'superadmin') {
        req.flash('error', 'Only superadmin can impersonate.');
        return res.redirect('/dashboard/users');
      }

      const target = await User.findById(req.params.id);
      if (!target) {
        req.flash('error', 'User not found.');
        return res.redirect('/dashboard/users');
      }

      // Store original superadmin session
      req.session.originalUser = currentUser;
      req.session.user = {
        id: target.id,
        name: target.name,
        email: target.email,
        role: target.role,
        parent_id: target.parent_id
      };

      await Activity.log({
        user_id: currentUser.id,
        action: 'IMPERSONATE',
        target_id: target.id,
        description: `Impersonating ${target.name} (${target.role})`
      });

      req.flash('success', `Now viewing as ${target.name}`);
      res.redirect('/dashboard');
    } catch (err) {
      console.error('Impersonate error:', err);
      req.flash('error', 'Failed to impersonate.');
      res.redirect('/dashboard/users');
    }
  },

  async stopImpersonate(req, res) {
    try {
      if (!req.session.originalUser) {
        return res.redirect('/dashboard');
      }

      const impersonatedName = req.session.user.name;
      req.session.user = req.session.originalUser;
      req.session.originalUser = null;

      req.flash('success', `Stopped impersonating ${impersonatedName}`);
      res.redirect('/dashboard');
    } catch (err) {
      console.error('Stop impersonate error:', err);
      res.redirect('/dashboard');
    }
  }
};

module.exports = UserController;
