/**
 * Image Quality Checker
 * Detects blurry and overexposed (flash) images before upload.
 * Reads settings from #iqSettings data attributes (injected by server).
 * Falls back to sensible defaults if not present.
 */
(function () {
  // Read settings from the hidden element or use defaults
  const cfgEl = document.getElementById('iqSettings');
  const cfg = cfgEl ? cfgEl.dataset : {};

  const ENABLED = (cfg.enabled || 'true') === 'true';
  const BLUR_THRESHOLD = parseInt(cfg.blur || '100', 10);
  const OVEREXPOSE_BRIGHTNESS = parseInt(cfg.bright || '240', 10);
  const OVEREXPOSE_PERCENT = parseInt(cfg.brightPct || '35', 10) / 100;
  const BLOCK_UPLOAD = (cfg.block || 'false') === 'true';
  const MAX_ANALYZE_SIZE = 512;

  if (!ENABLED) return; // Image quality check disabled

  function analyzeImage(file) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const issues = [];
        const scale = Math.min(1, MAX_ANALYZE_SIZE / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        URL.revokeObjectURL(url);

        // Convert to grayscale
        const gray = new Float32Array(w * h);
        let brightCount = 0;
        for (let i = 0; i < w * h; i++) {
          const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
          gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
          if (gray[i] > OVEREXPOSE_BRIGHTNESS) brightCount++;
        }

        // Overall overexposure check
        if (brightCount / (w * h) > OVEREXPOSE_PERCENT) {
          issues.push('overexposed');
        }

        // Local glare detection — check grid cells for concentrated bright spots
        const GRID = 8;
        const cellW = Math.floor(w / GRID);
        const cellH = Math.floor(h / GRID);
        const GLARE_CELL_THRESHOLD = 0.30;
        const GLARE_BRIGHTNESS = Math.min(OVEREXPOSE_BRIGHTNESS, 200);
        let hasGlare = false;
        for (let gy = 0; gy < GRID && !hasGlare; gy++) {
          for (let gx = 0; gx < GRID && !hasGlare; gx++) {
            let cellBright = 0, cellTotal = 0;
            for (let y = gy * cellH; y < (gy + 1) * cellH; y++) {
              for (let x = gx * cellW; x < (gx + 1) * cellW; x++) {
                cellTotal++;
                if (gray[y * w + x] > GLARE_BRIGHTNESS) cellBright++;
              }
            }
            if (cellTotal > 0 && (cellBright / cellTotal) > GLARE_CELL_THRESHOLD) {
              hasGlare = true;
            }
          }
        }
        if (hasGlare && !issues.includes('overexposed')) {
          issues.push('glare');
        }

        // Laplacian variance (blur detection)
        let sum = 0, sumSq = 0, count = 0;
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const idx = y * w + x;
            const lap = -4 * gray[idx] + gray[idx - 1] + gray[idx + 1] + gray[idx - w] + gray[idx + w];
            sum += lap;
            sumSq += lap * lap;
            count++;
          }
        }
        const mean = sum / count;
        const variance = (sumSq / count) - (mean * mean);
        if (variance < BLUR_THRESHOLD) {
          issues.push('blurry');
        }

        resolve(issues);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve([]);
      };
      img.src = url;
    });
  }

  function createWarning(input, issues) {
    removeWarning(input);

    const msgs = [];
    if (issues.includes('blurry')) msgs.push('kabur (blurry)');
    if (issues.includes('overexposed')) msgs.push('terlalu terang (overexposed/flash)');
    if (issues.includes('glare')) msgs.push('ada pantulan cahaya (glare/flash)');

    const wrap = document.createElement('div');
    wrap.className = 'iq-warning mt-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800';
    wrap.dataset.iqWarning = '1';

    let buttonsHtml = '<button type="button" class="iq-change px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition-colors">Tukar Gambar</button>';
    if (!BLOCK_UPLOAD) {
      buttonsHtml += ' <button type="button" class="iq-keep px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 transition-colors">Teruskan</button>';
    }

    const icon = BLOCK_UPLOAD ? '🚫' : '⚠️';
    const extraMsg = BLOCK_UPLOAD ? ' Sila muat naik semula gambar yang jelas.' : '';

    wrap.innerHTML = `
      <p class="text-xs text-amber-700 dark:text-amber-300 mb-2">
        ${icon} Gambar ini mungkin <strong>${msgs.join(' dan ')}</strong>.${extraMsg}
      </p>
      <div class="flex gap-2">${buttonsHtml}</div>
    `;

    input.parentElement.appendChild(wrap);

    // If blocking, clear the file input so it can't be submitted
    if (BLOCK_UPLOAD) {
      input.value = '';
    }

    wrap.querySelector('.iq-change').addEventListener('click', () => {
      input.value = '';
      removeWarning(input);
      input.click();
    });

    const keepBtn = wrap.querySelector('.iq-keep');
    if (keepBtn) {
      keepBtn.addEventListener('click', () => {
        removeWarning(input);
      });
    }
  }

  function removeWarning(input) {
    const existing = input.parentElement.querySelector('[data-iq-warning]');
    if (existing) existing.remove();
  }

  function init() {
    const inputs = document.querySelectorAll('input[type="file"][accept*="jpg"], input[type="file"][accept*="png"], input[type="file"][accept*="jpeg"]');
    inputs.forEach((input) => {
      input.addEventListener('change', async (e) => {
        removeWarning(input);
        const file = e.target.files[0];
        if (!file || !file.type.startsWith('image/')) return;

        const issues = await analyzeImage(file);
        if (issues.length > 0) {
          createWarning(input, issues);
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
