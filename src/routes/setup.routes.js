const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// GET /setup - Show setup form (only if no superadmin exists)
router.get('/', async (req, res) => {
  const superadmin = await prisma.user.findFirst({ where: { role: 'superadmin' } });
  if (superadmin) {
    req.flash('error', 'Setup already completed.');
    return res.redirect('/auth/login');
  }

  res.render('setup', {
    layout: 'layouts/main',
    title: 'Initial Setup',
    user: null
  });
});

// POST /setup - Create superadmin (only if no superadmin exists)
router.post('/', async (req, res) => {
  const superadmin = await prisma.user.findFirst({ where: { role: 'superadmin' } });
  if (superadmin) {
    req.flash('error', 'Setup already completed.');
    return res.redirect('/auth/login');
  }

  const { username, password } = req.body;
  if (!username || !password) {
    req.flash('error', 'Username and password are required.');
    return res.redirect('/setup');
  }

  const hashed = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: {
      id: uuidv4(),
      username: username.trim().toLowerCase(),
      password: hashed,
      role: 'superadmin'
    }
  });

  req.flash('success', 'Superadmin created! You can now login.');
  return res.redirect('/auth/login');
});

module.exports = router;
