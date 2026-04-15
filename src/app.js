const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const flash = require('connect-flash');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
require('dotenv').config();

// Parse DATABASE_URL for session store
const dbUrl = new URL(process.env.DATABASE_URL);
const sessionStore = new MySQLStore({
  host: dbUrl.hostname,
  port: dbUrl.port || 3306,
  user: dbUrl.username,
  password: dbUrl.password,
  database: dbUrl.pathname.replace('/', '')
});

const app = express();

// Trust proxy (Cloudflare Tunnel / reverse proxy)
app.set('trust proxy', 1);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Body parsing
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '10mb' }));

// Block search engine indexing
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

// Static files
app.use('/public', express.static(path.join(__dirname, '../public')));

// Session (stored in MySQL, persists across restarts)
app.use(session({
  secret: process.env.SESSION_SECRET || 'secret',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(flash());

// Flash messages + impersonation + site settings available in views
const Setting = require('./models/setting.model');
app.use(async (req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.originalUser = req.session ? req.session.originalUser : null;
  try { res.locals.siteSettings = await Setting.getAll(); } catch { res.locals.siteSettings = {}; }
  next();
});

// Routes
const authRoutes = require('./routes/auth.routes');
const setupRoutes = require('./routes/setup.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const userRoutes = require('./routes/user.routes');
const submissionRoutes = require('./routes/submission.routes');
const settingRoutes = require('./routes/setting.routes');
const templateRoutes = require('./routes/template.routes');
const presubmissionRoutes = require('./routes/presubmission.routes');
const prisma = require('./config/db');

// Root redirect - go to /setup if no superadmin, else /auth/login
app.get('/', async (req, res) => {
  const superadmin = await prisma.user.findFirst({ where: { role: 'superadmin' } });
  res.redirect(superadmin ? '/auth/login' : '/setup');
});

app.use('/setup', setupRoutes);

app.use('/auth', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/dashboard/users', userRoutes);
app.use('/dashboard', submissionRoutes);
app.use('/dashboard', presubmissionRoutes);
app.use('/dashboard/settings/templates', templateRoutes);
app.use('/dashboard/settings', settingRoutes);
app.use('/', submissionRoutes); // Public /submit route

// 404 error page
app.use((req, res) => {
  res.status(404).render('errors/404', {
    layout: 'layouts/main',
    title: '404',
    user: req.session ? req.session.user : null
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Internal Server Error');
});

module.exports = app;
