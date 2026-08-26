/**
 * What one Journal capture did, in Julian's words. Capture always saves first,
 * so the file is never in doubt; only the brain half changes. The surface must
 * not claim a delivery that did not happen, because an unwoken brain looks the
 * same as a delivered one until Julian opens it.
 */
export function journalCaptureToast(result) {
  const route = result?.route ?? "";
  if (route === "brain-opened") return "Saved to the Journal and sent to the Area brain.";
  if (route === "brain-resumed" || route === "brain-started") return "Saved to the Journal and woke the Area brain.";
  if (route === "not-started") return `Saved to the Journal. The Area brain did not start: ${result?.brainError ?? "unknown reason"}.`;
  if (route === "no-brain") return "Saved to the Journal. It waits for this Area's first brain.";
  return "Saved to the Journal.";
}

export default { journalCaptureToast };
