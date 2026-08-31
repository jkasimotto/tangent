import { sendJson } from "./http-json.mjs";
import { randomUUID } from "node:crypto";

/** Creates the spoken Area-message route. */
export function createVoiceRoutes(operations) {
  const unavailable = { error: "no Groq key: set GROQ_API_KEY or keep one in otto-launcher/.env" };

  /** Handles one matching request and reports whether this router owned it. */
  async function handle(request, response, url) {
    if (request.method === "POST" && url.pathname === "/api/voice") { await voice(request, response, url); return true; }
    return false;
  }

  /** Transcribes and routes one audio request. */
  async function voice(request, response, url) {
    if (!operations.available()) { sendJson(response, 503, unavailable); return; }
    try {
      const audio = await readBinary(request);
      if (audio.length < 200) { sendJson(response, 400, { error: "no audio" }); return; }
      const area = url.searchParams.get("area") || String(request.headers["x-capture-area"] ?? "");
      if (!area) { sendJson(response, 400, { error: "capture Area required" }); return; }
      const transcript = await operations.transcribe(audio, request.headers["content-type"], [area.split("/").at(-1)]);
      const result = await operations.send({
        to: area,
        text: transcript,
        from: "Agent Shell voice",
        idempotencyKey: request.headers["x-idempotency-key"] || randomUUID(),
      });
      if (result.status !== 200) { sendJson(response, result.status, { error: result.error }); return; }
      sendJson(response, 200, { transcript, delivery: result.value });
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
