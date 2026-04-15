const fs = require('fs');
const path = require('path');

const AI_BASE_URL = 'https://api.apimart.ai/v1';

/**
 * Convert a PDF file to a PNG image buffer (first page only).
 */
async function pdfToImageBuffer(pdfPath) {
  const { pdf } = await import('pdf-to-img');
  for await (const page of await pdf(pdfPath, { scale: 2 })) {
    return page; // return first page as Buffer
  }
  throw new Error('Failed to convert PDF to image');
}

const OcrService = {
  /**
   * Analyze a document (IC or payslip) using Gemini Vision AI.
   * Returns { ic, name, rawText }
   */
  async analyzeIC(filePath) {
    return this._analyze(filePath, 'ic');
  },

  async analyzePayslip(filePath) {
    return this._analyze(filePath, 'payslip');
  },

  async _analyze(filePath, docType) {
    const apiKey = process.env.APIMART_API_KEY;
    if (!apiKey) throw new Error('APIMART_API_KEY not set in .env');

    // Read file and convert to base64
    const ext = path.extname(filePath).toLowerCase();
    let imageBase64, mimeType;

    if (ext === '.pdf') {
      const imgBuffer = await pdfToImageBuffer(filePath);
      imageBase64 = Buffer.from(imgBuffer).toString('base64');
      mimeType = 'image/png';
    } else {
      const fileBuffer = fs.readFileSync(filePath);
      imageBase64 = fileBuffer.toString('base64');
      mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    }

    const prompt = docType === 'payslip'
      ? `You are analyzing a Malaysian payslip document. Extract the following information:
1. Employee full name (Nama)
2. IC number / No Kad Pengenalan (12-digit format like YYMMDDSSNNNN or YYMMDD-SS-NNNN)

Return ONLY valid JSON with no markdown or code fences:
{"name": "FULL NAME IN UPPERCASE", "ic": "123456789012"}

If a field cannot be found, set its value to null.`
      : `You are analyzing a Malaysian IC card (Kad Pengenalan / MyKad). Extract the following information:
1. Full name of the person
2. IC number (12-digit format like YYMMDDSSNNNN or YYMMDD-SS-NNNN)

Return ONLY valid JSON with no markdown or code fences:
{"name": "FULL NAME IN UPPERCASE", "ic": "123456789012"}

If a field cannot be found, set its value to null. Return only digits for IC (no dashes).`;

    const model = 'gemini-2.5-flash';
    const url = `${AI_BASE_URL}/models/${model}:generateContent`;

    const requestBody = JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: imageBase64 } }
        ]
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1024
      }
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: requestBody,
        signal: controller.signal
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`AI API error: ${response.status} — ${err.substring(0, 300)}`);
      }

      const data = await response.json();
      let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log('[OCR AI] Raw response:', text);

      // Strip markdown code fences if present
      text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('[OCR AI] No JSON in response:', text);
        return { ic: null, name: null, rawText: text };
      }

      const result = JSON.parse(jsonMatch[0]);

      // Normalize IC: remove dashes/spaces, keep digits only
      let ic = result.ic || null;
      if (ic) ic = ic.replace(/[-\s]/g, '');

      return {
        ic: ic || null,
        name: result.name ? result.name.toUpperCase().trim() : null,
        rawText: text
      };
    } finally {
      clearTimeout(timeout);
    }
  }
};

module.exports = OcrService;
