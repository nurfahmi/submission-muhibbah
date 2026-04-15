const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '../../templates');
const REGISTRY_PATH = path.join(TEMPLATES_DIR, 'templates.json');

// Ensure templates dir exists
if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

/**
 * Standard field names — matches exactly what the submission form collects.
 */
const STANDARD_FIELDS = {
  // PEMOHON (Applicant)
  pemohon_nama:          { label: 'Nama Pemohon',           group: 'Pemohon' },
  pemohon_ic:            { label: 'Kad Pengenalan',          group: 'Pemohon' },
  pemohon_tarikh_lahir:  { label: 'Tarikh Lahir Pemohon',   group: 'Pemohon' },
  pemohon_jantina:       { label: 'Jantina (L/P)',           group: 'Pemohon' },
  pemohon_umur:          { label: 'Umur Pemohon',           group: 'Pemohon' },
  pemohon_warganegara:   { label: 'Warganegara',            group: 'Pemohon' },
  pemohon_alamat:        { label: 'Alamat Tetap',           group: 'Pemohon' },
  pemohon_tel:           { label: 'No Tel HP',              group: 'Pemohon' },
  pemohon_taraf_perkahwinan: { label: 'Taraf Perkahwinan',  group: 'Pemohon' },
  pemohon_tanggungan:    { label: 'Bil Tanggungan (Anak)',   group: 'Pemohon' },
  pemohon_bangsa_agama:  { label: 'Bangsa / Agama',         group: 'Pemohon' },
  pemohon_pendidikan:    { label: 'Taraf Pendidikan',       group: 'Pemohon' },
  pemohon_jenis_kediaman:{ label: 'Jenis Kediaman',         group: 'Pemohon' },
  pemohon_tempoh_menetap:{ label: 'Tempoh Menetap',         group: 'Pemohon' },
  pemohon_email:         { label: 'Alamat Email',           group: 'Pemohon' },
  pemohon_nama_ibu:      { label: 'Nama Ibu',              group: 'Pemohon' },
  pemohon_tel_ibu:       { label: 'No Tel Ibu',            group: 'Pemohon' },
  pemohon_ic_ibu:        { label: 'No IC Ibu',             group: 'Pemohon' },

  // PASANGAN / IBU BAPA (Spouse / Parent)
  pasangan_nama:          { label: 'Nama Pasangan',          group: 'Pasangan' },
  pasangan_ic:            { label: 'No IC Pasangan',         group: 'Pasangan' },
  pasangan_tarikh_lahir:  { label: 'Tarikh Lahir Pasangan',  group: 'Pasangan' },
  pasangan_umur:          { label: 'Umur Pasangan',          group: 'Pasangan' },
  pasangan_tel:           { label: 'Tel Bimbit Pasangan',    group: 'Pasangan' },
  pasangan_hubungan:      { label: 'Hubungan',              group: 'Pasangan' },

  // PEKERJAAN (Job)
  pekerjaan_majikan:      { label: 'Nama Majikan',           group: 'Pekerjaan' },
  pekerjaan_alamat:       { label: 'Alamat Majikan',         group: 'Pekerjaan' },
  pekerjaan_tel:          { label: 'No Tel Pejabat',         group: 'Pekerjaan' },
  pekerjaan_jawatan:      { label: 'Jawatan Pemohon',        group: 'Pekerjaan' },
  pekerjaan_tarikh_mula:  { label: 'Tarikh Lantikan',        group: 'Pekerjaan' },
  pekerjaan_opsyen_pencen:{ label: 'Opsyen Pencen',          group: 'Pekerjaan' },
  pekerjaan_status_jawatan:{ label: 'Status Jawatan',        group: 'Pekerjaan' },
  pekerjaan_payslip_password: { label: 'ANM/Payslip Password', group: 'Pekerjaan' },
  pekerjaan_hrmis_password:   { label: 'HRMIS Password',      group: 'Pekerjaan' },

  // SAUDARA TERDEKAT (Reference)
  saudara_nama:           { label: 'Nama Saudara',           group: 'Saudara' },
  saudara_ic:             { label: 'No IC Saudara',          group: 'Saudara' },
  saudara_tel:            { label: 'No Telefon Saudara',     group: 'Saudara' },
  saudara_alamat:         { label: 'Alamat Saudara',         group: 'Saudara' },
  saudara_pertalian:      { label: 'Pertalian/Hubungan',     group: 'Saudara' },
};

/**
 * Parse Malaysian IC number (YYMMDD-SS-NNNN or YYMMDDSSNNNN)
 * Returns { dob: 'DD/MM/YYYY', gender: 'L' | 'P', age: number } or null
 */
function parseIC(ic) {
  if (!ic) return null;
  const digits = ic.replace(/[-\s]/g, '');
  if (digits.length < 12) return null;

  const yy = parseInt(digits.substring(0, 2));
  const mm = digits.substring(2, 4);
  const dd = digits.substring(4, 6);
  const lastDigit = parseInt(digits[digits.length - 1]);

  // Year: 00-29 = 2000s, 30-99 = 1900s
  const year = yy <= 29 ? 2000 + yy : 1900 + yy;
  const dob = `${dd}/${mm}/${year}`;
  const gender = lastDigit % 2 === 1 ? 'L' : 'P'; // odd=Lelaki, even=Perempuan

  // Calculate age
  const birthDate = new Date(year, parseInt(mm) - 1, parseInt(dd));
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;

  return { dob, gender, age: String(age) };
}

/**
 * Sanitize text for WinAnsi encoding (pdf-lib standard fonts).
 * Replaces common Unicode superscripts/subscripts with ASCII equivalents
 * and strips any remaining non-WinAnsi characters to prevent encoding errors.
 */
function sanitizeForWinAnsi(text) {
  if (!text) return text;
  // Map common superscript/subscript Unicode chars to ASCII
  const replacements = {
    '\u2070': '0', '\u00B9': '1', '\u00B2': '2', '\u00B3': '3',
    '\u2074': '4', '\u2075': '5', '\u2076': '6', '\u2077': '7',
    '\u2078': '8', '\u2079': '9',
    '\u2080': '0', '\u2081': '1', '\u2082': '2', '\u2083': '3',
    '\u2084': '4', '\u2085': '5', '\u2086': '6', '\u2087': '7',
    '\u2088': '8', '\u2089': '9',
    '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"',
    '\u2013': '-', '\u2014': '-', '\u2026': '...', '\u00A0': ' ',
  };
  let result = text;
  for (const [unicode, ascii] of Object.entries(replacements)) {
    result = result.split(unicode).join(ascii);
  }
  // Strip any remaining non-WinAnsi characters (keep printable ASCII + Latin-1 Supplement)
  result = result.replace(/[^\x20-\x7E\xA0-\xFF\n\r\t]/g, '');
  return result;
}

/**
 * Resolve a standard field key to its submission value.
 */
function resolveFieldValue(standardKey, submission) {
  const a = submission.applicant_data || {};
  const s = submission.spouse_data || {};
  const j = submission.job_data || {};
  const r = submission.reference_data || {};

  // Computed fields from IC
  const pemohonIC = parseIC(a.ic);
  const pasanganIC = parseIC(s.ic);

  const VALUE_MAP = {
    pemohon_nama:           a.name,
    pemohon_ic:             a.ic,
    pemohon_tarikh_lahir:   pemohonIC ? pemohonIC.dob : null,
    pemohon_jantina:        pemohonIC ? pemohonIC.gender : null,
    pemohon_umur:           pemohonIC ? pemohonIC.age : null,
    pemohon_warganegara:    'MALAYSIA',
    pemohon_alamat:         a.address,
    pemohon_tel:            a.phone,
    pemohon_taraf_perkahwinan: a.taraf_perkahwinan,
    pemohon_tanggungan:     a.tanggungan,
    pemohon_bangsa_agama:   a.bangsa_agama,
    pemohon_pendidikan:     a.pendidikan,
    pemohon_jenis_kediaman: a.jenis_kediaman,
    pemohon_tempoh_menetap: a.tempoh_menetap,
    pemohon_email:          a.email,
    pemohon_nama_ibu:       a.nama_ibu,
    pemohon_tel_ibu:        a.hp_ibu,
    pemohon_ic_ibu:         a.ic_ibu,

    pasangan_nama:          s.name,
    pasangan_ic:            s.ic,
    pasangan_tarikh_lahir:  pasanganIC ? pasanganIC.dob : null,
    pasangan_umur:          pasanganIC ? pasanganIC.age : null,
    pasangan_tel:           s.phone,
    pasangan_hubungan:      s.hubungan,

    pekerjaan_majikan:      j.employer,
    pekerjaan_alamat:       j.alamat_majikan,
    pekerjaan_tel:          j.tel_pejabat,
    pekerjaan_jawatan:      j.position,
    pekerjaan_tarikh_mula:  j.tarikh_mula,
    pekerjaan_opsyen_pencen: j.opsyen_pencen,
    pekerjaan_status_jawatan: j.status_jawatan,
    pekerjaan_payslip_password: j.payslip_password,
    pekerjaan_hrmis_password:   j.hrmis_password,

    saudara_nama:           r.name,
    saudara_ic:             r.ic,
    saudara_tel:            r.phone,
    saudara_alamat:         r.address,
    saudara_pertalian:      r.relationship,
  };

  const val = VALUE_MAP[standardKey];
  return (val && String(val).trim()) ? String(val).trim() : null;
}

// --- Registry ---

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) return [];
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
}

function saveRegistry(data) {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2));
}

// --- Public API ---

const PdfService = {
  STANDARD_FIELDS,
  TEMPLATES_DIR,

  getLoanProducts() {
    return loadRegistry();
  },

  getEnabledProducts() {
    return loadRegistry().filter(p => p.enabled !== false);
  },

  // Get products enabled for a specific master agent
  getEnabledProductsForAgent(masteragentId) {
    return loadRegistry().filter(p => {
      if (p.enabled === false) return false; // globally disabled
      if (!masteragentId) return true;
      const disabledFor = p.disabledFor || [];
      return !disabledFor.includes(masteragentId);
    });
  },

  toggleProduct(key) {
    const registry = loadRegistry();
    const product = registry.find(t => t.key === key);
    if (!product) throw new Error(`Product "${key}" not found`);
    product.enabled = product.enabled === false ? true : false;
    saveRegistry(registry);
    return product.enabled;
  },

  // Toggle product for a specific master agent
  toggleProductForAgent(key, masteragentId) {
    const registry = loadRegistry();
    const product = registry.find(t => t.key === key);
    if (!product) throw new Error(`Product "${key}" not found`);
    if (!product.disabledFor) product.disabledFor = [];
    const idx = product.disabledFor.indexOf(masteragentId);
    if (idx >= 0) {
      product.disabledFor.splice(idx, 1); // re-enable
    } else {
      product.disabledFor.push(masteragentId); // disable
    }
    saveRegistry(registry);
    return !product.disabledFor.includes(masteragentId); // returns true if now enabled
  },

  // Get the disabledFor list for a product
  getProductDisabledFor(key) {
    const product = this.getProduct(key);
    return product ? (product.disabledFor || []) : [];
  },

  reorderProduct(key, direction) {
    const registry = loadRegistry();
    const idx = registry.findIndex(t => t.key === key);
    if (idx === -1) throw new Error(`Product "${key}" not found`);
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= registry.length) return;
    [registry[idx], registry[newIdx]] = [registry[newIdx], registry[idx]];
    saveRegistry(registry);
  },

  saveOrder(keys) {
    const registry = loadRegistry();
    const sorted = [];
    for (const key of keys) {
      const item = registry.find(t => t.key === key);
      if (item) sorted.push(item);
    }
    // append any not in keys (safety)
    for (const item of registry) {
      if (!sorted.find(s => s.key === item.key)) sorted.push(item);
    }
    saveRegistry(sorted);
  },

  getProduct(key) {
    const registry = loadRegistry();
    // Check top-level
    const top = registry.find(t => t.key === key);
    if (top) return top;
    // Check children
    for (const p of registry) {
      if (p.children) {
        const child = p.children.find(c => c.key === key);
        if (child) return child;
      }
    }
    return null;
  },

  // Get parent product that contains a child key
  getParentOf(childKey) {
    const registry = loadRegistry();
    for (const p of registry) {
      if (p.children && p.children.find(c => c.key === childKey)) return p;
    }
    return null;
  },

  addProduct(key, label, filename) {
    const registry = loadRegistry();
    if (registry.find(t => t.key === key)) {
      throw new Error(`Product key "${key}" already exists`);
    }
    if (filename) {
      // Single-file product
      registry.push({ key, label, file: filename, fieldMap: {} });
    } else {
      // Multi-file product (no direct file)
      registry.push({ key, label, file: null, fieldMap: null, children: [] });
    }
    saveRegistry(registry);
  },

  addChild(parentKey, childKey, childLabel, filename) {
    const registry = loadRegistry();
    const parent = registry.find(t => t.key === parentKey);
    if (!parent) throw new Error(`Parent product "${parentKey}" not found`);
    if (!parent.children) parent.children = [];
    if (parent.children.find(c => c.key === childKey)) {
      throw new Error(`Child key "${childKey}" already exists`);
    }
    parent.children.push({ key: childKey, label: childLabel, file: filename, fieldMap: {} });
    saveRegistry(registry);
  },

  removeChild(parentKey, childKey) {
    const registry = loadRegistry();
    const parent = registry.find(t => t.key === parentKey);
    if (!parent || !parent.children) return;
    const child = parent.children.find(c => c.key === childKey);
    if (child) {
      const filePath = path.join(TEMPLATES_DIR, child.file);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    parent.children = parent.children.filter(c => c.key !== childKey);
    saveRegistry(registry);
  },

  removeProduct(key) {
    let registry = loadRegistry();
    const item = registry.find(t => t.key === key);
    if (item) {
      // Delete main file
      if (item.file) {
        const filePath = path.join(TEMPLATES_DIR, item.file);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      // Delete children files
      if (item.children) {
        item.children.forEach(c => {
          const fp = path.join(TEMPLATES_DIR, c.file);
          if (fs.existsSync(fp)) fs.unlinkSync(fp);
        });
      }
    }
    registry = registry.filter(t => t.key !== key);
    saveRegistry(registry);
  },

  /**
   * Save field mapping for a product. Does NOT modify the PDF.
   * @param {string} key - product key
   * @param {object} fieldMap - { "OriginalPdfFieldName": "standard_key" }
   */
  saveFieldMap(key, fieldMap) {
    const registry = loadRegistry();
    // Check top-level
    let product = registry.find(t => t.key === key);
    if (!product) {
      // Check children
      for (const p of registry) {
        if (p.children) {
          const child = p.children.find(c => c.key === key);
          if (child) { product = child; break; }
        }
      }
    }
    if (!product) throw new Error(`Product "${key}" not found`);
    product.fieldMap = fieldMap;
    saveRegistry(registry);
  },

  /**
   * Get the field map for a product.
   */
  getFieldMap(key) {
    const product = this.getProduct(key);
    return product ? (product.fieldMap || {}) : {};
  },

  /**
   * Read all form fields from a PDF file (original names, never modified).
   */
  async getFields(filename) {
    const filePath = path.join(TEMPLATES_DIR, filename);
    const pdfBytes = fs.readFileSync(filePath);
    const doc = await PDFDocument.load(pdfBytes);
    const form = doc.getForm();
    return form.getFields().map(f => ({
      name: f.getName(),
      type: f.constructor.name.replace('PDF', '').replace('Field', '')
    }));
  },

  async getFieldsFromPath(filePath) {
    const pdfBytes = fs.readFileSync(filePath);
    const doc = await PDFDocument.load(pdfBytes);
    const form = doc.getForm();
    return form.getFields().map(f => ({
      name: f.getName(),
      type: f.constructor.name.replace('PDF', '').replace('Field', '')
    }));
  },

  /**
   * Fill a template PDF using the external field mapping.
   * PDF is never modified on disk — only filled in memory.
   */
  async fillTemplate(productKey, submission, options = {}) {
    const { flatten = true } = options;
    const product = this.getProduct(productKey);
    if (!product) throw new Error(`Loan product "${productKey}" not found`);

    const filePath = path.join(TEMPLATES_DIR, product.file);
    if (!fs.existsSync(filePath)) throw new Error(`Template file not found: ${product.file}`);

    const fieldMap = product.fieldMap || {};
    if (Object.keys(fieldMap).length === 0) {
      throw new Error('No field mappings configured for this product. Map fields first.');
    }

    const pdfBytes = fs.readFileSync(filePath);
    const doc = await PDFDocument.load(pdfBytes);
    const form = doc.getForm();

    // Group fields by standard key to handle multi-row overflow
    // e.g. 3 name rows all mapped to "pemohon_nama" → split text across them
    const grouped = {};
    for (const [pdfFieldName, standardKey] of Object.entries(fieldMap)) {
      if (!standardKey) continue;
      if (!grouped[standardKey]) grouped[standardKey] = [];
      grouped[standardKey].push(pdfFieldName);
    }

    // Sort grouped fields by Y position (top-to-bottom) so text splits correctly
    // regardless of JSON key order
    for (const stdKey of Object.keys(grouped)) {
      if (grouped[stdKey].length <= 1) continue;
      grouped[stdKey].sort((a, b) => {
        const fa = form.getFields().find(f => f.getName() === a);
        const fb = form.getFields().find(f => f.getName() === b);
        if (!fa || !fb) return 0;
        const wa = fa.acroField.getWidgets();
        const wb = fb.acroField.getWidgets();
        if (!wa.length || !wb.length) return 0;
        const ra = wa[0].getRectangle();
        const rb = wb[0].getRectangle();
        // Higher Y in PDF = higher on page, so sort descending Y for top-to-bottom
        return rb.y - ra.y;
      });
    }

    for (const [standardKey, pdfFieldNames] of Object.entries(grouped)) {
      const value = resolveFieldValue(standardKey, submission);
      if (!value) continue;

      const text = sanitizeForWinAnsi(value.toUpperCase());

      // Separate fields into maxLength (boxed/comb) and non-maxLength (regular text)
      const mlFields = [];   // fields with maxLength → chain together
      const freeFields = []; // fields without maxLength

      for (const pdfFieldName of pdfFieldNames) {
        let field;
        try {
          field = form.getFields().find(f => f.getName() === pdfFieldName);
        } catch { continue; }
        if (!field) continue;

        const fieldType = field.constructor.name;

        try {
          if (fieldType === 'PDFCheckBox') {
            const cb = form.getCheckBox(pdfFieldName);
            const lower = value.toLowerCase();
            if (lower === 'yes' || lower === 'true' || lower === 'ya' || lower === '1') {
              cb.check();
            } else {
              cb.uncheck();
            }
            continue;
          }

          if (fieldType === 'PDFRadioGroup') {
            const rg = form.getRadioGroup(pdfFieldName);
            const opts = rg.getOptions();
            const match = opts.find(o => o === value) ||
                          opts.find(o => o.toLowerCase() === value.toLowerCase());
            if (match) rg.select(match);
            continue;
          }

          if (fieldType === 'PDFDropdown') {
            const dd = form.getDropdown(pdfFieldName);
            const opts = dd.getOptions();
            const match = opts.find(o => o === value) ||
                          opts.find(o => o.toLowerCase() === value.toLowerCase());
            if (match) dd.select(match);
            continue;
          }

          if (fieldType !== 'PDFTextField') continue;

          const tf = form.getTextField(pdfFieldName);
          const ml = tf.getMaxLength();

          if (ml) {
            mlFields.push({ name: pdfFieldName, tf, ml });
          } else {
            freeFields.push({ name: pdfFieldName, tf });
          }
        } catch (err) {
          console.warn(`[PDF] Failed to process "${pdfFieldName}" → ${standardKey}:`, err.message);
        }
      }

      // Fill non-maxLength fields: if only free fields, split; if mixed, each gets full text
      if (freeFields.length > 0) {
        if (mlFields.length > 0 || freeFields.length === 1) {
          // Mixed group or single field → each gets full value
          for (const f of freeFields) {
            try { f.tf.setText(text); } catch (e) {
              console.warn(`[PDF] Failed to fill "${f.name}":`, e.message);
            }
          }
        } else {
          // All free fields, no maxLength fields → split by ~50 chars at word boundary
          let remaining = text;
          for (const f of freeFields) {
            if (!remaining) break;
            try {
              const charsPerRow = 50;
              if (remaining.length <= charsPerRow) {
                f.tf.setText(remaining);
                remaining = '';
              } else {
                let cut = remaining.lastIndexOf(' ', charsPerRow);
                if (cut <= 0) cut = charsPerRow;
                f.tf.setText(remaining.substring(0, cut).trim());
                remaining = remaining.substring(cut).trim();
              }
            } catch (e) {
              console.warn(`[PDF] Failed to fill "${f.name}":`, e.message);
            }
          }
        }
      }

      // Fill maxLength fields: chain with word-boundary splitting
      if (mlFields.length > 0) {
        let remaining = text;
        for (const f of mlFields) {
          if (!remaining) break;
          try {
            if (remaining.length <= f.ml) {
              f.tf.setText(remaining);
              remaining = '';
            } else {
              const chunk = remaining.substring(0, f.ml);
              const nextChar = remaining[f.ml];
              if (nextChar && nextChar !== ' ' && !chunk.endsWith(' ')) {
                const lastSpace = chunk.lastIndexOf(' ');
                if (lastSpace > 0) {
                  f.tf.setText(chunk.substring(0, lastSpace));
                  remaining = remaining.substring(lastSpace + 1);
                } else {
                  f.tf.setText(chunk);
                  remaining = remaining.substring(f.ml);
                }
              } else {
                f.tf.setText(chunk.trimEnd());
                remaining = remaining.substring(f.ml).trimStart();
              }
            }
          } catch (e) {
            console.warn(`[PDF] Failed to fill "${f.name}":`, e.message);
          }
        }
      }
    }

    form.updateFieldAppearances();
    if (flatten) form.flatten();
    const filledBytes = await doc.save();
    return Buffer.from(filledBytes);
  }
};

module.exports = PdfService;
