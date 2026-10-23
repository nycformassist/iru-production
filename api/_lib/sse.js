/**
 * lib/sse.js — Consumption of the /api/analyze Server-Sent Events stream.
 * Shared by the browser client (src/App.tsx) and the test-suite.
 *
 * The contract: the server writes `data: {json}\n\n` events; the terminal
 * event ('done', or 'error' with a fallback) carries the WHOLE assessment
 * — several KB of JSON on ONE line.
 *
 * D2 (browser E2E, 2026-10-22): the client used to split EACH network
 * chunk on '\n' and parse the pieces independently. A line straddling a
 * chunk boundary — routine under real TCP/TLS segmentation — failed
 * JSON.parse and was silently skipped, so the assessment never arrived:
 * "Analysis could not be generated." + "Readiness Score: 0%", even though
 * the endpoint had streamed a perfectly good result. (This is also why
 * direct API calls, which read the full body at once, always worked.)
 *
 * This consumer therefore BUFFERS: decoded text accumulates across reads,
 * only complete lines are parsed, and the trailing partial line is held
 * for the next chunk. Decoding uses { stream: true } so a multi-byte
 * UTF-8 character split across chunks is not corrupted either.
 */

/**
 * Yield parsed SSE event objects from a fetch body reader.
 * Malformed lines are skipped (same tolerance as the server expects of
 * any SSE consumer); non-'data:' lines are ignored.
 */
export async function* sseEvents(reader) {
  const decoder = new TextDecoder();
  let buffer = '';
  const drain = (flush) => {
    const lines = buffer.split('\n');
    buffer = flush ? '' : lines.pop() || '';
    if (flush && lines[lines.length - 1] === '') lines.pop();
    const events = [];
    for (const rawLine of lines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trimStart();
      if (!payload) continue;
      try { events.push(JSON.parse(payload)); } catch { /* skip malformed line */ }
    }
    return events;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      yield* drain(false);
    }
  }
  buffer += decoder.decode();
  yield* drain(true);
}

/**
 * Consume an /api/analyze stream to completion.
 * Returns { assessment, aiUnavailable } with the client's semantics:
 * the last terminal event carrying an assessment wins; any terminal
 * event flagged ai_unavailable marks the result as the fallback.
 */
export async function readAnalyzeStream(reader) {
  let assessment = null;
  let aiUnavailable = false;
  for await (const event of sseEvents(reader)) {
    if (event && (event.type === 'done' || event.type === 'error')) {
      if (event.assessment) assessment = event.assessment;
      if (event.status === 'ai_unavailable') aiUnavailable = true;
    }
  }
  return { assessment, aiUnavailable };
}
