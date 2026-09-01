/** Small in-process Work metrics with bounded label cardinality. */
export function createWorkTelemetry() {
  const counters = new Map();
  const gauges = new Map();
  const timings = new Map();

  /** Records one bounded-cardinality Work metric. */
  function record(name, value = 1, labels = {}) {
    const key = metricKey(name, labels);
    if (name.endsWith("_total")) counters.set(key, (counters.get(key) ?? 0) + value);
    else if (name.endsWith("_ms")) {
      const row = timings.get(key) ?? { count: 0, sum: 0, max: 0, samples: [], cursor: 0 };
      row.count += 1;
      row.sum += value;
      row.max = Math.max(row.max, value);
      if (row.samples.length < 4_096) row.samples.push(value);
      else {
        row.samples[row.cursor] = value;
        row.cursor = (row.cursor + 1) % row.samples.length;
      }
      timings.set(key, row);
    } else gauges.set(key, value);
  }

  /** Returns a serializable metric snapshot. */
  function snapshot() {
    return {
      counters: Object.fromEntries(counters),
      gauges: Object.fromEntries(gauges),
      timings: Object.fromEntries([...timings].map(([key, row]) => {
        const sorted = [...row.samples].sort((left, right) => left - right);
        /** Returns one sampled percentile. */
        const percentile = (value) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] : 0;
        return [key, { count: row.count, sum: row.sum, max: row.max, mean: row.count ? row.sum / row.count : 0, p50: percentile(0.5), p95: percentile(0.95) }];
      })),
    };
  }

  return { record, snapshot };
}

/** Creates one bounded metric identity. */
function metricKey(name, labels) {
  const suffix = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${String(value).slice(0, 40)}`).join(",");
  return suffix ? `${name}{${suffix}}` : name;
}
