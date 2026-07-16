export type Frontmatter = Record<string, string>;

/**
 * Splits a markdown file's optional leading `---` frontmatter block from its body. Values are
 * treated as plain strings: the vault's thread frontmatter is intentionally flat (outcome, status,
 * opened, closed only, per the vault's "no new frontmatter fields" rule), never nested YAML.
 */
export function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const [, block, body] = match;
  const frontmatter: Frontmatter = {};
  for (const line of block!.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) frontmatter[key] = value;
  }
  return { frontmatter, body: body! };
}
