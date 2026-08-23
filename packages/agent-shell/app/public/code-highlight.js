// Hand-rolled syntax highlighting for the Document reader's fenced code
// blocks (design contract: otto/tangent/goal-code-in-the-document-reader-renders-great).
// The app is local and self-contained, so no CDN highlighter: this file is
// the whole thing, covering the languages the vault actually uses. An
// unknown language tag still renders as plain escaped code, which keeps the
// monospace block styling from shell.css.

  /** Escapes text before it enters rendered HTML. */
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Walks `code` left to right. At each position, the first rule whose sticky
   * regex matches right there wins the token; a position no rule claims
   * becomes one unstyled character. Order rules from most to least specific.
   */
  function tokenize(code, rules) {
    const tokens = [];
    let i = 0;
    while (i < code.length) {
      let token = null;
      for (const rule of rules) {
        rule.regex.lastIndex = i;
        const found = rule.regex.exec(code);
        if (found && found.index === i && found[0].length) {
          token = { text: found[0], type: rule.type };
          break;
        }
      }
      if (!token) token = { text: code[i], type: null };
      tokens.push(token);
      i += token.text.length;
    }
    return tokens;
  }

  const JS_KEYWORDS = "const|let|var|function|return|if|else|for|while|class|extends|import|export|from|default|async|await|new|this|super|try|catch|finally|throw|typeof|instanceof|in|of|switch|case|break|continue|do|yield|static|get|set|void|delete|null|undefined|true|false|interface|type|enum|implements|private|public|protected|readonly|as|is|namespace|declare|abstract|module";

  const JAVASCRIPT_RULES = [
    { type: "comment", regex: /\/\/[^\n]*/y },
    { type: "comment", regex: /\/\*[\s\S]*?\*\//y },
    { type: "string", regex: /`(?:\\.|[^`\\])*`/y },
    { type: "string", regex: /"(?:\\.|[^"\\\n])*"/y },
    { type: "string", regex: /'(?:\\.|[^'\\\n])*'/y },
    { type: "number", regex: /\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y },
    { type: "keyword", regex: new RegExp(`\\b(?:${JS_KEYWORDS})\\b`, "y") },
    { type: "function", regex: /\b[A-Za-z_$][\w$]*(?=\s*\()/y },
    { type: "property", regex: /(?<=\.)[A-Za-z_$][\w$]*/y },
  ];

  const BASH_KEYWORDS = "if|then|elif|else|fi|for|do|done|while|until|case|esac|function|return|export|local|declare|readonly|in|select|break|continue|shift|exit|set|unset|trap|eval|source|alias";

  const BASH_RULES = [
    { type: "comment", regex: /#[^\n]*/y },
    { type: "string", regex: /"(?:\\.|[^"\\])*"/y },
    { type: "string", regex: /'[^']*'/y },
    { type: "variable", regex: /\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\$[0-9@*#?$!-]/y },
    { type: "keyword", regex: new RegExp(`\\b(?:${BASH_KEYWORDS})\\b`, "y") },
  ];

  const JSON_RULES = [
    { type: "property", regex: /"(?:\\.|[^"\\])*"(?=\s*:)/y },
    { type: "string", regex: /"(?:\\.|[^"\\])*"/y },
    { type: "number", regex: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y },
    { type: "keyword", regex: /\b(?:true|false|null)\b/y },
  ];

  const MARKDOWN_RULES = [
    { type: "quote", regex: /^>.*$/my },
    { type: "heading", regex: /^#{1,6} [^\n]*/my },
    { type: "code", regex: /`[^`\n]+`/y },
    { type: "link", regex: /\[[^\]]*\]\([^)]*\)/y },
    { type: "bold", regex: /\*\*[^*\n]+\*\*/y },
    { type: "list", regex: /^\s*[-*+] /my },
  ];

  const LANGUAGES = {
    javascript: JAVASCRIPT_RULES,
    typescript: JAVASCRIPT_RULES,
    json: JSON_RULES,
    bash: BASH_RULES,
    markdown: MARKDOWN_RULES,
  };

  const ALIASES = {
    js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    ts: "typescript", tsx: "typescript",
    json5: "json", jsonc: "json",
    sh: "bash", shell: "bash", zsh: "bash", console: "bash",
    md: "markdown",
  };

  /** The canonical language name this highlighter knows for one fence tag, or null. */
  function normalizeLanguage(tag) {
    const key = String(tag ?? "").trim().toLowerCase();
    if (!key) return null;
    const name = ALIASES[key] ?? key;
    return LANGUAGES[name] ? name : null;
  }

  /** Highlighted HTML for one fenced code block's body; escaped plain text when the language tag is unknown. */
  function highlightHtml(code, tag) {
    const language = normalizeLanguage(tag);
    if (!language) return escapeHtml(code);
    return tokenize(code, LANGUAGES[language])
      .map((token) => (token.type ? `<span class="tok-${token.type}">${escapeHtml(token.text)}</span>` : escapeHtml(token.text)))
      .join("");
  }

export default { highlightHtml, normalizeLanguage };
