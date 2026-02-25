/**
 * Image Quality Service
 * Multi-layer detection: Sharp pixel analysis + Tesseract OCR confidence.
 * Supports images and PDFs (first page converted to image).
 */
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

// --- Thresholds ---
const BLUR_LAP_THRESHOLD = 200;       // Laplacian variance below this = likely blurry
const BLUR_EDGE_THRESHOLD = 0.08;     // Edge density below this = likely blurry
const OVEREXPOSE_BRIGHTNESS = 235;
const OVEREXPOSE_PERCENT = 0.30;
const DARK_THRESHOLD = 40;
const DARK_PERCENT = 0.50;
const LOW_CONTRAST_THRESHOLD = 35;

// Glare: color-aware (bright + desaturated + no edges)
const GLARE_GRID = 8;
const GLARE_BRIGHT_THRESHOLD = 200;
const GLARE_SAT_THRESHOLD = 0.15;     // Low saturation = washed out
const GLARE_EDGE_THRESHOLD = 0.08;    // Few edges in cell = no detail
const GLARE_MIN_CELLS = 2;            // Need at least 2 glare cells

// OCR
const OCR_CONFIDENCE_THRESHOLD = 50;  // Average word confidence below this = unreadable
const OCR_MIN_WORDS = 3;              // Need at least a few words to judge

const ANALYZE_SIZE = 800;             // Higher res for better accuracy

// Lazy-init Tesseract worker (reused across requests)
let _worker = null;
let _workerReady = false;

async function getWorker() {
  if (_worker && _workerReady) return _worker;

  _worker = await Tesseract.createWorker('eng+msa', 1, {
    logger: () => {} // silent
  });

  _workerReady = true;
  return _worker;
}

/**
 * Convert first page of a PDF to a temporary PNG file.
 * Uses pdf-to-img (ESM, loaded via dynamic import).
 */
async function pdfToTempImage(pdfPath) {
  const { pdf } = await import('pdf-to-img');
  const doc = await pdf(pdfPath, { scale: 2 });

  // Get first page as PNG buffer
  let pageBuffer = null;
  for await (const page of doc) {
    pageBuffer = page;
    break; // only first page
  }

  if (!pageBuffer) throw new Error('Could not render PDF page');

  // Save to temp file
  const tmpPath = path.join(os.tmpdir(), `iq_pdf_${Date.now()}.png`);
  fs.writeFileSync(tmpPath, pageBuffer);
  return tmpPath;
}

const ImageQualityService = {
  /**
   * Analyze a single image or PDF file for quality issues.
   * PDFs are converted to image first (first page).
   * Runs pixel analysis (blur, glare, exposure) + OCR confidence.
   */
  async analyze(filePath, mimetype) {
    const issues = [];
    const scores = {};
    let tmpPdfImage = null;

    // If PDF, convert first page to image
    const isPdf = mimetype === 'application/pdf'
      || (typeof mimetype === 'undefined' && filePath.toLowerCase().endsWith('.pdf'));

    if (isPdf) {
      try {
        tmpPdfImage = await pdfToTempImage(filePath);
        filePath = tmpPdfImage;
        scores.source = 'pdf';
      } catch (pdfErr) {
        // Can't render PDF — skip quality check
        return { issues: [], scores: { source: 'pdf', pdfError: true }, skipped: true };
      }
    }

    try {
      // === LAYER 1: Sharp pixel analysis ===
      const { data: grayData, info } = await sharp(filePath)
        .resize(ANALYZE_SIZE, ANALYZE_SIZE, { fit: 'inside', withoutEnlargement: true })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const { width, height } = info;
      const totalPixels = width * height;
      const innerPixels = (width - 2) * (height - 2);

      // --- 1a. Blur: Laplacian variance ---
      let lapSum = 0, lapSumSq = 0;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = y * width + x;
          const lap = -4 * grayData[idx]
            + grayData[idx - 1] + grayData[idx + 1]
            + grayData[idx - width] + grayData[idx + width];
          lapSum += lap;
          lapSumSq += lap * lap;
        }
      }
      const lapMean = lapSum / innerPixels;
      const lapVariance = (lapSumSq / innerPixels) - (lapMean * lapMean);
      scores.laplacianVar = Math.round(lapVariance);

      // --- 1b. Blur: Sobel edge density ---
      let strongEdges = 0;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const tl = grayData[(y - 1) * width + (x - 1)];
          const tc = grayData[(y - 1) * width + x];
          const tr = grayData[(y - 1) * width + (x + 1)];
          const ml = grayData[y * width + (x - 1)];
          const mr = grayData[y * width + (x + 1)];
          const bl = grayData[(y + 1) * width + (x - 1)];
          const bc = grayData[(y + 1) * width + x];
          const br = grayData[(y + 1) * width + (x + 1)];

          const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
          const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
          const mag = Math.sqrt(gx * gx + gy * gy);
          if (mag > 50) strongEdges++;
        }
      }
      const edgeDensity = strongEdges / innerPixels;
      scores.edgeDensity = Math.round(edgeDensity * 100); // percentage

      // Combined blur decision
      if (lapVariance < BLUR_LAP_THRESHOLD && edgeDensity < BLUR_EDGE_THRESHOLD) {
        issues.push('blurry');
      }

      // --- 1c. Pixel stats ---
      let pixSum = 0, pixSumSq = 0, brightCount = 0, darkCount = 0;
      for (let i = 0; i < totalPixels; i++) {
        const v = grayData[i];
        pixSum += v;
        pixSumSq += v * v;
        if (v > OVEREXPOSE_BRIGHTNESS) brightCount++;
        if (v < DARK_THRESHOLD) darkCount++;
      }
      const pixMean = pixSum / totalPixels;
      const pixStdDev = Math.sqrt((pixSumSq / totalPixels) - (pixMean * pixMean));
      scores.contrast = Math.round(pixStdDev);
      scores.avgBrightness = Math.round(pixMean);

      // Overexposure
      const brightPercent = brightCount / totalPixels;
      scores.overexposure = Math.round(brightPercent * 100);
      if (brightPercent > OVEREXPOSE_PERCENT) {
        issues.push('overexposed');
      }

      // Too dark
      const darkPercent = darkCount / totalPixels;
      scores.dark = Math.round(darkPercent * 100);
      if (darkPercent > DARK_PERCENT) {
        issues.push('too_dark');
      }

      // Low contrast
      if (pixStdDev < LOW_CONTRAST_THRESHOLD && !issues.includes('blurry')) {
        issues.push('low_contrast');
      }

      // --- 2. Glare: Color-aware grid analysis ---
      // Glare = bright + desaturated + no edges (flash washes out color & detail)
      const { data: colorData } = await sharp(filePath)
        .resize(ANALYZE_SIZE, ANALYZE_SIZE, { fit: 'inside', withoutEnlargement: true })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const cellW = Math.floor(width / GLARE_GRID);
      const cellH = Math.floor(height / GLARE_GRID);
      let glareCells = 0;

      for (let gy = 0; gy < GLARE_GRID; gy++) {
        for (let gx = 0; gx < GLARE_GRID; gx++) {
          let cellBright = 0, cellDesat = 0, cellEdges = 0, cellTotal = 0;

          for (let y = gy * cellH; y < (gy + 1) * cellH && y < height; y++) {
            for (let x = gx * cellW; x < (gx + 1) * cellW && x < width; x++) {
              const gi = y * width + x;
              const ci = gi * 3;
              const r = colorData[ci], g = colorData[ci + 1], b = colorData[ci + 2];
              const brightness = grayData[gi];

              // Saturation (HSV)
              const max = Math.max(r, g, b);
              const min = Math.min(r, g, b);
              const sat = max > 0 ? (max - min) / max : 0;

              if (brightness > GLARE_BRIGHT_THRESHOLD) cellBright++;
              if (brightness > 180 && sat < GLARE_SAT_THRESHOLD) cellDesat++;

              // Simple edge check
              if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
                const dx = Math.abs(grayData[gi + 1] - grayData[gi - 1]);
                const dy = Math.abs(grayData[gi + width] - grayData[gi - width]);
                if (dx + dy > 30) cellEdges++;
              }
              cellTotal++;
            }
          }

          if (cellTotal > 0) {
            const brightRatio = cellBright / cellTotal;
            const desatRatio = cellDesat / cellTotal;
            const edgeRatio = cellEdges / cellTotal;

            // Glare cell = very bright + washed out colors + no detail
            if (brightRatio > 0.4 && desatRatio > 0.3 && edgeRatio < GLARE_EDGE_THRESHOLD) {
              glareCells++;
            }
          }
        }
      }

      scores.glareCells = glareCells;
      if (glareCells >= GLARE_MIN_CELLS && !issues.includes('overexposed')) {
        issues.push('glare');
      }

      // === LAYER 2: OCR confidence (final authority) ===
      // If OCR can read text clearly, pixel-level warnings are false positives
      const OCR_READABLE_THRESHOLD = 65; // Above this = text is readable
      try {
        const worker = await getWorker();
        const { data } = await worker.recognize(filePath);

        const words = (data.words || []).filter(w => w.text.trim().length > 1);
        scores.ocrWordCount = words.length;

        if (words.length >= OCR_MIN_WORDS) {
          const avgConf = words.reduce((sum, w) => sum + w.confidence, 0) / words.length;
          scores.ocrConfidence = Math.round(avgConf);

          if (avgConf >= OCR_READABLE_THRESHOLD) {
            // OCR says readable — remove pixel-level false positives
            const falsePositives = ['overexposed', 'glare', 'too_dark', 'low_contrast'];
            for (const fp of falsePositives) {
              const idx = issues.indexOf(fp);
              if (idx !== -1) issues.splice(idx, 1);
            }
          } else if (avgConf < OCR_CONFIDENCE_THRESHOLD) {
            // OCR says unreadable — flag as blurry if not already
            if (!issues.includes('blurry')) {
              issues.push('blurry');
            }
          }
        } else if (words.length === 0 && !issues.includes('too_dark') && !issues.includes('overexposed')) {
          // No text at all — likely very blurry or wrong image
          issues.push('blurry');
        }
      } catch (ocrErr) {
        // OCR failed — keep pixel analysis results as-is
        scores.ocrError = true;
      }

    } catch (err) {
      // If sharp can't process (e.g. corrupted), skip
      return { issues: [], scores: {}, skipped: true };
    } finally {
      // Clean up temp PDF image
      if (tmpPdfImage) try { fs.unlinkSync(tmpPdfImage); } catch {}
    }

    return { issues, scores };
  },

  /**
   * Analyze all uploaded image files from req.files.
   */
  async analyzeAll(files) {
    const warnings = {};
    let hasIssues = false;

    if (!files) return { warnings, hasIssues };

    for (const fieldName of Object.keys(files)) {
      for (const file of files[fieldName]) {
        // Skip files that aren't images or PDFs
        const isImage = file.mimetype && file.mimetype.startsWith('image/');
        const isPdf = file.mimetype === 'application/pdf';
        if (!isImage && !isPdf) continue;

        const result = await this.analyze(file.path, file.mimetype);
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
