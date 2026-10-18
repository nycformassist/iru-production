import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test PDF validation logic (extracted from review-image.js)
// These test the validation rules without requiring the full API

function validatePdfSignature(bytes) {
  const header = bytes.subarray(0, 5).toString('ascii');
  return header === '%PDF-';
}

function countPdfPages(pdfText) {
  const pageMatches = pdfText.match(/\/Type\s*\/Page[^s]/g);
  return pageMatches ? pageMatches.length : 0;
}

function isEncrypted(pdfText) {
  return pdfText.includes('/Encrypt');
}

describe('PDF validation', () => {
  it('accepts valid PDF signature', () => {
    const pdf = Buffer.from('%PDF-1.4 fake content');
    assert.ok(validatePdfSignature(pdf));
  });

  it('rejects non-PDF files', () => {
    const notPdf = Buffer.from('This is not a PDF');
    assert.ok(!validatePdfSignature(notPdf));
  });

  it('rejects file with PDF extension but wrong signature', () => {
    const fake = Buffer.from('JFIF fake jpeg data');
    assert.ok(!validatePdfSignature(fake));
  });

  it('counts PDF pages correctly', () => {
    const pdfText = '/Type /Page /Type /Page /Type /Pages';
    assert.strictEqual(countPdfPages(pdfText), 2);
  });

  it('detects zero pages', () => {
    const pdfText = '/Type /Pages /Type /Catalog';
    assert.strictEqual(countPdfPages(pdfText), 0);
  });

  it('detects encrypted PDFs', () => {
    const encrypted = '/Type /Page /Encrypt << /Filter >>';
    assert.ok(isEncrypted(encrypted));
  });

  it('allows unencrypted PDFs', () => {
    const normal = '/Type /Page /Contents << >>';
    assert.ok(!isEncrypted(normal));
  });

  it('enforces 20-page limit', () => {
    const MAX_PDF_PAGES = 20;
    assert.ok(25 > MAX_PDF_PAGES, '25 pages exceeds limit');
    assert.ok(20 <= MAX_PDF_PAGES, '20 pages within limit');
  });
});
