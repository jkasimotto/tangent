export type LanguageId = "dart" | "typescript";

export type ParsedImport = {
  kind: string;
  uri: string;
  line: number;
  resolvedPath?: string;
};

export type ParsedSymbol = {
  tempId: number;
  name: string;
  qualifiedName: string;
  kind: string;
  visibility: "public" | "private";
  startLine: number;
  endLine: number;
  signature: string;
  doc: string;
  parentTempId?: number;
  openBracePos?: number;
  closeBracePos?: number;
  startPos: number;
  endPos: number;
};

export type ParsedFile = {
  language: LanguageId;
  path: string;
  absolutePath: string;
  isTest: boolean;
  isGenerated: boolean;
  packageName?: string;
  libraryUri?: string;
  imports: ParsedImport[];
  symbols: ParsedSymbol[];
  cleanSource: string;
  lineStarts: number[];
};

export type LanguageContext = {
  root: string;
  packages: Record<string, string>;
  tsconfig: Record<string, unknown>;
};

export type LanguageAdapter = {
  id: LanguageId;
  displayName: string;
  extensions: readonly string[];
  generatedSuffixes: readonly string[];
  ignoredDirs: readonly string[];
  classLikeKinds: ReadonlySet<string>;
  functionLikeKinds: ReadonlySet<string>;
  createContext(root: string): Promise<LanguageContext>;
  isGeneratedPath(relPath: string): boolean;
  isTestPath(relPath: string): boolean;
  parseFile(path: string, root: string, context: LanguageContext): Promise<ParsedFile>;
  callNames(text: string): Iterable<string>;
  typeNames(text: string): Iterable<string>;
};

export abstract class BaseLanguageAdapter implements LanguageAdapter {
  abstract id: LanguageId;
  abstract displayName: string;
  abstract extensions: readonly string[];
  generatedSuffixes: readonly string[] = [];
  ignoredDirs: readonly string[] = [];
  classLikeKinds = new Set<string>();
  functionLikeKinds = new Set<string>();

  /** Creates context. */
  async createContext(root: string): Promise<LanguageContext> {
    return { root, packages: {}, tsconfig: {} };
  }

  /** Returns whether generated path. */
  isGeneratedPath(relPath: string): boolean {
    const lower = relPath.toLowerCase();
    return this.generatedSuffixes.some((suffix) => lower.endsWith(suffix)) || lower.includes("/generated/") || lower.includes("/gen/");
  }

  /** Returns whether test path. */
  isTestPath(relPath: string): boolean {
    const lower = relPath.toLowerCase();
    return lower.startsWith("test/") || lower.includes("/test/") || lower.includes("/tests/") || lower.includes("__tests__");
  }

  /** Parses file. */
  abstract parseFile(path: string, root: string, context: LanguageContext): Promise<ParsedFile>;

  /** Supports the call names helper. */
  *callNames(_text: string): Iterable<string> {}

  /** Supports the type names helper. */
  *typeNames(_text: string): Iterable<string> {}
}
