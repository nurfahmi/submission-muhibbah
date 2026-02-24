/**
 * Image Quality Service (server-side with sharp)
 * Detects blur and glare/overexposure in uploaded images.
 */
const sharp = require('sharp');

// Thresholds
const BLUR_THRESHOLD = 200;          // Laplacian variance below this = blurry
const LOW_CONTRAST_THRESHOLD = 35;   // Std dev below this = low contrast / washed out
const OVEREXPOSE_BRIGHTNESS = 235;   // Pixel brightness above this = "bright"
const OVEREXPOSE_PERCENT = 0.30;     // >30% bright pixels = overexposed
const GLARE_GRID = 6;               // 6×6 grid for local glare (larger cells)
const GLARE_CELL_BRIGHT = 190;      // Lower threshold to catch laminated surface shine
const GLARE_CELL_PERCENT = 0.35;    // >35% bright pixels in a cell = glare

const ANALYZE_SIZE = 512;           // Resize for performance

const ImageQualityService = {
  /**
   * Analyze a single image file for quality issues.
   * @param {string} filePath - Absolute path to the image file
   * @returns {Promise<{issues: string[], scores: object}>}
   */
  async analyze(filePath) {
    const issues = [];
    const scores = {};

    try {
      // Load and resize for performance
      const { data, info } = await sharp(filePath)
        .resize(ANALYZE_SIZE, ANALYZE_SIZE, { fit: 'inside', withoutEnlargement: true })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const { width, height } = info;
      const totalPixels = width * height;

      // --- 1. Blur detection (Laplacian variance) ---
      let lapSum = 0;
      let lapSumSq = 0;
      let lapCount = 0;

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          const lap = -4 * data[idx]
            + data[idx - 1]
            + data[idx + 1]
            + data[idx - width]
            + data[idx + width];
          lapSum += lap;
          lapSumSq += lap * lap;
          lapCount++;
        }
      }

      const lapMean = lapSum / lapCount;
      const lapVariance = (lapSumSq / lapCount) - (lapMean * lapMean);
      scores.blur = Math.round(lapVariance);

      if (lapVariance < BLUR_THRESHOLD) {
        issues.push('blurry');
      }

      // --- 1b. Low contrast check (std deviation of pixels) ---
      let pixSum = 0;
      let pixSumSq = 0;
      for (let i = 0; i < totalPixels; i++) {
        pixSum += data[i];
        pixSumSq += data[i] * data[i];
      }
      const pixMean = pixSum / totalPixels;
      const pixStdDev = Math.sqrt((pixSumSq / totalPixels) - (pixMean * pixMean));
      scores.contrast = Math.round(pixStdDev);

      if (pixStdDev < LOW_CONTRAST_THRESHOLD && !issues.includes('blurry')) {
        issues.push('low_contrast');
      }

      // --- 2. Overall overexposure ---
      let brightCount = 0;
      for (let i = 0; i < totalPixels; i++) {
        if (data[i] > OVEREXPOSE_BRIGHTNESS) brightCount++;
      }

      const brightPercent = brightCount / totalPixels;
      scores.overexposure = Math.round(brightPercent * 100);

      if (brightPercent > OVEREXPOSE_PERCENT) {
        issues.push('overexposed');
      }

      // --- 3. Local glare detection (grid-based with relative brightness) ---
      const cellW = Math.floor(width / GLARE_GRID);
      const cellH = Math.floor(height / GLARE_GRID);
      let glareCount = 0;

      // Calculate average brightness per cell
      const cellAvgs = [];
      for (let gy = 0; gy < GLARE_GRID; gy++) {
        for (let gx = 0; gx < GLARE_GRID; gx++) {
          let cellSum = 0;
          let cellBright = 0;
          let cellTotal = 0;

          for (let y = gy * cellH; y < (gy + 1) * cellH; y++) {
            for (let x = gx * cellW; x < (gx + 1) * cellW; x++) {
              const val = data[y * width + x];
              cellSum += val;
              cellTotal++;
              if (val > GLARE_CELL_BRIGHT) cellBright++;
            }
          }

          const cellAvg = cellTotal > 0 ? cellSum / cellTotal : 0;
          cellAvgs.push(cellAvg);

          if (cellTotal > 0 && (cellBright / cellTotal) > GLARE_CELL_PERCENT) {
            glareCount++;
          }
        }
      }

      // Check if glare cells are significantly brighter than the overall average
      const overallAvg = cellAvgs.reduce((a, b) => a + b, 0) / cellAvgs.length;
      const brightCells = cellAvgs.filter(avg => avg > overallAvg + 30).length;

      scores.glareCells = glareCount;
      scores.brightCellsAboveAvg = brightCells;
      scores.avgBrightness = Math.round(overallAvg);

      // Flag glare if bright spot cells exist AND they are above average
      if (glareCount >= 1 && brightCells >= 1 && !issues.includes('overexposed')) {
        issues.push('glare');
      }

      // --- 4. Dark image detection ---
      let darkCount = 0;
      for (let i = 0; i < totalPixels; i++) {
        if (data[i] < 40) darkCount++;
      }
      const darkPercent = darkCount / totalPixels;
      scores.dark = Math.round(darkPercent * 100);

      if (darkPercent > 0.50) {
        issues.push('too_dark');
      }

    } catch (err) {
      // If sharp can't process (e.g. PDF), skip quality check
      return { issues: [], scores: {}, skipped: true };
    }

    return { issues, scores };
  },

  /**
   * Analyze all uploaded image files from req.files.
   * Returns a map of { fieldName: { issues, scores } } for files with issues.
   * @param {object} files - req.files from multer
   * @returns {Promise<object>} - { warnings: { fieldName: {issues, scores} }, hasIssues: boolean }
   */
  async analyzeAll(files) {
    const warnings = {};
    let hasIssues = false;

    if (!files) return { warnings, hasIssues };

    for (const fieldName of Object.keys(files)) {
      for (const file of files[fieldName]) {
        // Only analyze images, skip PDFs
        if (!file.mimetype || !file.mimetype.startsWith('image/')) continue;

        const result = await this.analyze(file.path);
        if (result.issues.length > 0) {
          warnings[fieldName] = {
            issues: result.issues,
            scores: result.scores,
            originalName: file.originalname
          };
          hasIssues = true;
        }
      }
    }

    return { warnings, hasIssues };
  },

  /**
   * Format warnings into a user-friendly message.
   */
  formatWarnings(warnings) {
    const labels = {
      ic: 'IC (Depan & Belakang)',
      payslip1: 'Payslip Bulan 1',
      payslip2: 'Payslip Bulan 2',
      payslip3: 'Payslip Bulan 3',
      bank_page: 'Muka Surat Akaun Bank',
      signature: 'Tandatangan Customer',
      chop_sign: 'Chop Bulat/Nama & Sign Majikan',
      bill_rumah: 'Bill Rumah',
      settlement_letter: 'Settlement Letter',
      other_doc: 'Lain-lain'
    };

    const issueLabels = {
      blurry: 'kabur (blurry)',
      overexposed: 'terlalu terang (overexposed)',
      glare: 'ada pantulan cahaya (glare)',
      too_dark: 'terlalu gelap',
      low_contrast: 'gambar pudar / kurang jelas'
    };

    const parts = [];
    for (const [field, data] of Object.entries(warnings)) {
      const fieldLabel = labels[field] || field;
      const issueTexts = data.issues.map(i => issueLabels[i] || i).join(', ');
      parts.push(`${fieldLabel}: ${issueTexts}`);
    }

    return parts.join(' | ');
  }
};

module.exports = ImageQualityService;
