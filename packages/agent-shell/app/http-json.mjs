/** Reads a JSON object request body; malformed and empty bodies become {}. */
export async function readJson(request) {
  try {
    let data = "";
    for await (const chunk of request) data += chunk;
    const value = JSON.parse(data);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** Sends one JSON response. */
export function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}
