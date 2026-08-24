/** Maps an array while keeping at most `limit` mapper calls in flight. */
export async function mapWithConcurrency(items, limit, mapper) {
  const values = Array.from(items);
  if (!values.length) return [];
  const concurrency = Math.max(1, Math.min(values.length, Math.floor(Number(limit)) || 1));
  const output = new Array(values.length);
  let next = 0;

  /** Claims one index at a time until the shared input is exhausted. */
  async function worker() {
    while (next < values.length) {
      const index = next;
      next += 1;
      output[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return output;
}
