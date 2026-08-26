/**
 * What one Journal capture did, in Julian's words. Capture always writes the
 * file first, so the words are never in doubt; the commit and the brain half
 * can still fail. The surface must not claim a delivery that did not happen,
 * because an unwoken brain looks the same as a delivered one until Julian
 * opens it, and an uncommitted Journal looks the same as a saved one.
 */
export function journalCaptureToast(result) {
  const route = result?.route ?? "";
  if (route === "brain-opened") return "Saved to the Journal and sent to the Area brain.";
  if (route === "brain-resumed" || route === "brain-started") return "Saved to the Journal and woke the Area brain.";
  if (route === "not-started") return `Saved to the Journal. The Area brain did not start: ${result?.brainError ?? "unknown reason"}.`;
  if (route === "no-brain") return "Saved to the Journal. It waits for this Area's first brain.";
  if (route === "not-committed") return `Written to the Journal file, but the vault did not save it, so the Area brain was not told: ${result?.commitError ?? "unknown reason"}.`;
  return "Saved to the Journal.";
}

export default { journalCaptureToast };
