const prisma = require('../config/db');
const path = require('path');

const DEFAULTS = {
  site_name: 'Muhibbah Submission',
  site_short: 'CSS',
  logo_url: '',
  favicon_url: '',
  primary_color: '#0ea5e9',
  accent_color: '#8b5cf6',
  iq_enabled: 'true',
  iq_blur_threshold: '50',
  iq_bright_threshold: '245',
  iq_bright_percent: '40',
  iq_block_upload: 'false',
  upload_dir: '',
  force_uppercase: 'false',
  // File requirement settings
  req_ic_depan: 'true',
  req_ic_belakang: 'true',
  req_payslip1: 'false',
  req_payslip2: 'false',
  req_payslip3: 'false',
  req_bank_page: 'false',
  req_signature: 'false',
  req_chop_sign: 'false',
  req_bill_rumah: 'false',
  req_settlement_letter: 'false'
};

const Setting = {
  async get(key) {
    const row = await prisma.siteSetting.findUnique({ where: { key } });
    return row ? row.value : (DEFAULTS[key] || null);
  },

  async getAll() {
    const rows = await prisma.siteSetting.findMany();
    const settings = { ...DEFAULTS };
    rows.forEach(r => { settings[r.key] = r.value; });
    return settings;
  },

  async set(key, value) {
    return prisma.siteSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value }
    });
  },

  async setMany(obj) {
    const ops = Object.entries(obj).map(([key, value]) =>
      prisma.siteSetting.upsert({
        where: { key },
        update: { value: value || '' },
        create: { key, value: value || '' }
      })
    );
    return Promise.all(ops);
  },

  async getUploadDir() {
    const custom = await this.get('upload_dir');
    if (custom && custom.trim()) {
      return path.resolve(custom.trim());
    }
    return path.resolve(__dirname, '../../uploads');
  }
};

module.exports = Setting;
