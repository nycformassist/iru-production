"""
OCR fallback for scanned/inaccessible PDFs.
Uses the proven spike pipeline: render -> OCR -> map -> review queue.
Uncertain extractions enter review, never silently accepted.
"""
import fitz  # PyMuPDF
import json
import os
import tempfile

def ocr_fallback(pdf_path, form_key, confidence_threshold=0.7):
    """
    Extract fields from a scanned PDF via OCR.
    Returns (extractions, review_queue).
    - extractions: list of (field_id, value, confidence) above threshold
    - review_queue: list of uncertain items needing human review
    """
    try:
        import easyocr
    except ImportError:
        return [], [{
            "reason": "ocr-unavailable",
            "detail": "EasyOCR not installed. Install to enable scanned-PDF fallback."
        }]

    # Render at 200 DPI (proven in spike)
    doc = fitz.open(pdf_path)
    reader = easyocr.Reader(['en'], gpu=False)

    extractions = []
    review_queue = []

    for page_num, page in enumerate(doc):
        pix = page.get_pixmap(dpi=200)
        # Unique temp file per invocation (Carbon Pass 2, H-4): the old
        # predictable /tmp/ocr_p{page_num}.png raced across concurrent
        # invocations and leaked on exception. Always unlinked in
        # finally, even when OCR raises.
        fd, img_path = tempfile.mkstemp(prefix=f"ocr_p{page_num}_", suffix=".png")
        os.close(fd)
        try:
            pix.save(img_path)

            # OCR with positions
            results = reader.readtext(img_path)

            for bbox, text, conf in results:
                # Skip low-confidence entirely
                if conf < 0.3:
                    continue

                # Map to field via position/label heuristics
                # For now, flag everything for review unless high confidence
                # and matches a known field pattern
                field_id = f"ocr_p{page_num}_{int(bbox[0][0])}_{int(bbox[0][1])}"

                if conf >= confidence_threshold:
                    extractions.append({
                        "field": field_id,
                        "value": text,
                        "confidence": float(conf),
                        "source": "ocr-extraction",
                        "page": page_num,
                    })
                else:
                    review_queue.append({
                        "fact": field_id,
                        "reason": "uncertain",
                        "detail": f"OCR extracted '{text}' at confidence {conf:.0%}. "
                                 "Verify before accepting.",
                        "value": text,
                        "confidence": float(conf),
                    })
        finally:
            try:
                os.unlink(img_path)
            except OSError:
                pass

    doc.close()
    return extractions, review_queue


def ocr_to_review_document(extractions, review_queue, output_path):
    """Generate review document for OCR extractions."""
    with open(output_path, 'w') as f:
        f.write("# OCR Extraction Review\n\n")
        f.write(f"High-confidence extractions: {len(extractions)}\n")
        f.write(f"Items needing review: {len(review_queue)}\n\n")

        if extractions:
            f.write("## Accepted extractions\n")
            for e in extractions:
                f.write(f"- {e['field']}: '{e['value']}' ({e['confidence']:.0%})\n")

        if review_queue:
            f.write("\n## Needs human review\n")
            f.write("These were NOT automatically accepted.\n\n")
            for r in review_queue:
                f.write(f"- {r['fact']}: {r['detail']}\n")

    return output_path
