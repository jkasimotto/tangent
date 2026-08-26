/** An HTTP failure that the composition root can return without hiding it. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * Reads one bounded JSON object; malformed and empty bodies become {}. The
 * parsed body is also kept on the request as `parsedBody`, so a composition
 * root can judge a finished request (who called it, what it named) without
 * every route handler passing the body back out.
 */
export async function readJson(request, { maxBytes = 2 * 1024 * 1024, rejectMalformed = false, malformedMessage = "request body must be one complete JSON object" } = {}) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > maxBytes) {
      request.resume();
      throw new HttpError(413, `request body exceeds ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }
  if (!chunks.length) {
    if (rejectMalformed) throw new HttpError(400, malformedMessage);
    return remember(request, {});
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      if (rejectMalformed) throw new HttpError(400, malformedMessage);
      return remember(request, {});
    }
    return remember(request, value);
  } catch {
    if (rejectMalformed) throw new HttpError(400, malformedMessage);
    return remember(request, {});
  }
}

/** Keeps the parsed body on the request and returns it. */
function remember(request, value) {
  request.parsedBody = value;
  return value;
}

/** Sends one JSON response. */
export function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  response.end(body);
}
