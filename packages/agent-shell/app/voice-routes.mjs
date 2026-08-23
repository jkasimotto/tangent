import { readJson, sendJson } from "./http-json.mjs";

/** Creates the HTTP routes for spoken and typed command routing. */
export function createVoiceRoutes(operations) {
  const unavailable = { error: "no Groq key: set GROQ_API_KEY or keep one in otto-launcher/.env" };

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    if (request.method === "POST" && url.pathname === "/api/voice") { await voice(request, response, url); return true; }
    if (request.method === "POST" && url.pathname === "/api/command") { await command(request, response); return true; }
    return false;
  }

  /** Transcribes and routes one audio request. */
  async function voice(request, response, url) {
    if (!operations.available()) { sendJson(response, 503, unavailable); return; }
    const focused = url.searchParams.get("focused") || operations.chatSession;
    try {
      const audio = await readBinary(request);
      if (audio.length < 200) { sendJson(response, 400, { error: "no audio" }); return; }
      const visible = String(request.headers["x-visible-areas"] ?? "").split(",").filter(Boolean);
      const context = await operations.context(focused, visible);
      const transcript = await operations.transcribe(audio, request.headers["content-type"], operations.nameHints(context));
      sendJson(response, 200, { transcript, ...await operations.route(transcript, focused, context) });
    } catch (error) {
      sendJson(response, 500, { error: String(error.message ?? error) });
    }
  }

  /** Routes one typed command through the same action grammar. */
  async function command(request, response) {
    if (!operations.available()) { sendJson(response, 503, unavailable); return; }
    const body = await readJson(request);
    const text = String(body.text ?? "").trim();
    if (!text) { sendJson(response, 400, { error: "text required" }); return; }
    try {
      const focused = body.focused || operations.chatSession;
      const context = await operations.context(focused, Array.isArray(body.visibleAreas) ? body.visibleAreas : []);
      sendJson(response, 200, { transcript: text, ...await operations.route(text, focused, context) });
    } catch (error) {
      sendJson(response, 500, { error: String(error.message ?? error) });
    }
  }

  /** Collects an audio body without converting its bytes to text. */
  async function readBinary(request) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  return { handle };
}
