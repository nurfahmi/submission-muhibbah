const User = require('../models/user.model');

const AuthController = {
  async loginPage(req, res) {
    if (req.session && req.session.user) {
      return res.redirect('/dashboard');
    }

    // Check if any users exist — if not, redirect to setup
    const prisma = require('../config/db');
    const userCount = await prisma.user.count();
    if (userCount === 0) {
      return res.redirect('/auth/setup');
    }

    res.render('auth/login', {
      layout: 'layouts/main',
      title: 'Login',
      error: req.flash ? req.flash('error') : null,
      user: null
    });
  },

  async setupPage(req, res) {
    const prisma = require('../config/db');
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      return res.redirect('/auth/login');
    }
    res.render('auth/setup', {
      layout: 'layouts/main',
      title: 'Initial Setup',
      error: null,
      user: null
    });
  },

  async createInitialAdmin(req, res) {
    try {
      const prisma = require('../config/db');
      const userCount = await prisma.user.count();
      if (userCount > 0) {
        return res.redirect('/auth/login');
      }

      const { username, password, confirm_password } = req.body;
      if (!username || !password) {
        return res.render('auth/setup', { layout: 'layouts/main', title: 'Initial Setup', error: 'Username and password are required.', user: null });
      }
      if (password !== confirm_password) {
        return res.render('auth/setup', { layout: 'layouts/main', title: 'Initial Setup', error: 'Passwords do not match.', user: null });
      }
      if (password.length < 6) {
        return res.render('auth/setup', { layout: 'layouts/main', title: 'Initial Setup', error: 'Password must be at least 6 characters.', user: null });
      }

      await User.create({ username: username.trim().toLowerCase(), password, role: 'superadmin' });

      req.flash('success', 'Superadmin account created. Please login.');
      return res.redirect('/auth/login');
    } catch (err) {
      console.error('Setup error:', err);
      return res.render('auth/setup', { layout: 'layouts/main', title: 'Initial Setup', error: 'Failed to create account: ' + err.message, user: null });
    }
  },

  async login(req, res) {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        req.flash('error', 'Username and password are required.');
        return res.redirect('/auth/login');
      }

      const user = await User.findByUsername(username.trim().toLowerCase());
      if (!user) {
        req.flash('error', 'Invalid username or password.');
        return res.redirect('/auth/login');
      }

      const valid = await User.verifyPassword(password, user.password);
      if (!valid) {
        req.flash('error', 'Invalid username or password.');
        return res.redirect('/auth/login');
      }

      req.session.user = {
        id: user.id,
        name: user.username,
        username: user.username,
        role: user.role,
        parent_id: user.parent_id
      };

      return res.redirect('/dashboard');
    } catch (err) {
      console.error('Login error:', err);
      req.flash('error', 'Something went wrong.');
      return res.redirect('/auth/login');
    }
  },

  logout(req, res) {
    req.session.destroy(() => {
      res.redirect('/auth/login');
    });
  }
};

module.exports = AuthController;
