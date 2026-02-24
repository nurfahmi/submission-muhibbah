/**
 * Image Quality Checker (Server-side via AJAX)
 * Sends image to server for analysis with sharp, shows inline warning.
 */
(function () {
  const cfgEl = document.getElementById('iqSettings');
  const cfg = cfgEl ? cfgEl.dataset : {};
  const ENABLED = (cfg.enabled || 'true') === 'true';
  if (!ENABLED) return;

  function createWarning(input, messages) {
    removeWarning(input);

    const wrap = document.createElement('div');
    wrap.className = 'iq-warning mt-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800';
    wrap.dataset.iqWarning = '1';

    const msgHtml = messages.map(m => `<div class="flex items-start gap-2"><span class="text-amber-500">⚠️</span><span>${m}</span></div>`).join('');

    wrap.innerHTML = `
      <div class="text-xs text-amber-700 dark:text-amber-300 mb-2 space-y-1">${msgHtml}</div>
      <p class="text-xs text-gray-400 mb-2">Sila tukar gambar yang lebih jelas, atau abaikan jika gambar sudah betul.</p>
      <div class="flex gap-2">
        <button type="button" class="iq-change px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition-colors">Tukar Gambar</button>
        <button type="button" class="iq-keep px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 transition-colors">Abaikan</button>
      </div>
    `;

    input.parentElement.appendChild(wrap);

    wrap.querySelector('.iq-change').addEventListener('click', () => {
      input.value = '';
      removeWarning(input);
      input.click();
    });

    wrap.querySelector('.iq-keep').addEventListener('click', () => {
      // Track this file as having acknowledged quality issues
      const fieldName = input.name;
      let tracker = document.getElementById('iq_warned_files');
      if (!tracker) {
        tracker = document.createElement('input');
        tracker.type = 'hidden';
        tracker.name = 'iq_warned_files';
        tracker.id = 'iq_warned_files';
        tracker.value = '';
        input.closest('form').appendChild(tracker);
      }
      const current = tracker.value ? tracker.value.split(',') : [];
      if (!current.includes(fieldName)) {
        current.push(fieldName);
        tracker.value = current.join(',');
      }
      removeWarning(input);
    });
  }

  function createLoading(input) {
    removeWarning(input);
    const wrap = document.createElement('div');
    wrap.className = 'iq-warning mt-2 p-2 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800';
    wrap.dataset.iqWarning = '1';
    wrap.innerHTML = '<p class="text-xs text-blue-600 dark:text-blue-300 flex items-center gap-2"><svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Memeriksa kualiti gambar...</p>';
    input.parentElement.appendChild(wrap);
  }

  function removeWarning(input) {
    const existing = input.parentElement.querySelector('[data-iq-warning]');
    if (existing) existing.remove();
  }

  async function checkImage(input, file) {
    createLoading(input);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const resp = await fetch('/api/check-image', { method: 'POST', body: formData });
      const data = await resp.json();

      removeWarning(input);

      if (!data.ok && data.messages && data.messages.length > 0) {
        createWarning(input, data.messages);
      }
    } catch (err) {
      removeWarning(input);
      // Silently fail - don't block user
    }
  }

  function init() {
    const inputs = document.querySelectorAll('input[type="file"]');
    inputs.forEach((input) => {
      input.addEventListener('change', (e) => {
        removeWarning(input);
        const file = e.target.files[0];
        if (!file) return;
        // Only check images, skip PDFs
        if (!file.type.startsWith('image/')) return;
        checkImage(input, file);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
