export type CliOptionSpec = {
  name: string;
  aliases?: string[];
  description?: string;
  takesValue?: boolean;
  values?: string[];
};

export type CliCommandSpec = {
  name: string;
  aliases?: string[];
  description?: string;
  args?: string;
  values?: string[];
  options?: CliOptionSpec[];
  subcommands?: CliCommandSpec[];
  hidden?: boolean;
};

export type CliCompletionShell = "bash" | "zsh" | "fish";

/** Returns whether a CLI token matches a command by name or alias. */
export function commandMatches(spec: CliCommandSpec, token: string): boolean {
  return spec.name === token || Boolean(spec.aliases?.includes(token));
}

/** Returns subcommands that are not hidden. */
export function visibleSubcommands(spec: CliCommandSpec): CliCommandSpec[] {
  return (spec.subcommands || []).filter((command) => !command.hidden);
}

/** Renders a formatted help string for a CLI command. */
export function renderCommandHelp(spec: CliCommandSpec, commandPath = spec.name): string {
  const lines: string[] = [commandPath, ""];
  if (spec.description) lines.push(spec.description, "");
  const subcommands = visibleSubcommands(spec);
  if (subcommands.length) {
    lines.push("Commands:");
    const width = Math.max(...subcommands.map((command) => commandName(command).length));
    for (const command of subcommands) {
      lines.push(`  ${commandName(command).padEnd(width)}  ${command.description || ""}`.trimEnd());
    }
    lines.push("");
  }
  const options = visibleOptions(spec);
  if (options.length) {
    lines.push("Options:");
    const width = Math.max(...options.map((option) => optionLabel(option).length));
    for (const option of options) {
      lines.push(`  ${optionLabel(option).padEnd(width)}  ${option.description || ""}`.trimEnd());
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/** Returns completion candidates for the last argv token. */
export function completeCommand(spec: CliCommandSpec, argv: string[]): string[] {
  const current = argv.at(-1) || "";
  const prior = argv.length ? argv.slice(0, -1) : [];
  const state = walkCommand(spec, prior);
  if (state.optionValue) return filterPrefix(state.optionValue.values || [], current);
  if (current.startsWith("-")) return filterPrefix(optionCompletions(state.command), current);
  return filterPrefix([...commandCompletions(state.command), ...(state.command.values || [])], current);
}

/** Returns a shell completion script for the named command. */
export function completionScript(shell: CliCompletionShell, commandName: string): string {
  if (shell === "bash") {
    return `_${commandName}_completion() {
  local IFS=$'\\n'
  COMPREPLY=( $(COMP_CWORD="$COMP_CWORD" ${commandName} __complete "\${COMP_WORDS[@]:1}") )
}
complete -F _${commandName}_completion ${commandName}
`;
  }

  if (shell === "zsh") {
    return `#compdef ${commandName}
_${commandName}_completion() {
  local -a completions
  completions=("\${(@f)$(${commandName} __complete "\${words[@]:2}")}")
  compadd -- "\${completions[@]}"
}
compdef _${commandName}_completion ${commandName}
`;
  }

  return `complete -c ${commandName} -f -a '(${commandName} __complete (commandline -opc)[2..-1])'
`;
}

/** Walks the command tree along argv and returns the active command and any pending option. */
function walkCommand(root: CliCommandSpec, argv: string[]): { command: CliCommandSpec; optionValue?: CliOptionSpec } {
  let command = root;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    const option = token.startsWith("-") ? findOption(command, token.split("=", 1)[0]!) : undefined;
    if (option?.takesValue && !token.includes("=")) {
      if (index === argv.length - 1) return { command, optionValue: option };
      index += 1;
      continue;
    }
    if (option) continue;
    const child = (command.subcommands || []).find((subcommand) => commandMatches(subcommand, token));
    if (child) command = child;
  }
  return { command };
}

/** Finds the option in a command that matches the given CLI token. */
function findOption(command: CliCommandSpec, token: string): CliOptionSpec | undefined {
  return visibleOptions(command).find((option) => optionTokens(option).includes(token));
}

/** Returns options that are not marked as internal. */
function visibleOptions(command: CliCommandSpec): CliOptionSpec[] {
  return (command.options || []).filter((option) => !option.name.startsWith("_"));
}

/** Returns all name and alias tokens for visible subcommands. */
function commandCompletions(command: CliCommandSpec): string[] {
  return visibleSubcommands(command).flatMap((subcommand) => [subcommand.name, ...(subcommand.aliases || [])]);
}

/** Returns all option tokens for visible options of a command. */
function optionCompletions(command: CliCommandSpec): string[] {
  return visibleOptions(command).flatMap(optionTokens);
}

/** Returns the --name and alias tokens for an option. */
function optionTokens(option: CliOptionSpec): string[] {
  return [`--${option.name}`, ...(option.aliases || [])];
}

/** Returns a display label for an option including any value placeholder. */
function optionLabel(option: CliOptionSpec): string {
  const value = option.takesValue ? ` <value>` : "";
  return optionTokens(option).join(", ") + value;
}

/** Returns a display name for a command including its args placeholder if present. */
function commandName(command: CliCommandSpec): string {
  return `${command.name}${command.args ? ` ${command.args}` : ""}`;
}

/** Returns deduplicated, sorted values that start with the given prefix. */
function filterPrefix(values: string[], prefix: string): string[] {
  return [...new Set(values)].filter((value) => value.startsWith(prefix)).sort();
}

export * from "./cli/args.js";
export * from "./config.js";
export * from "./fs.js";
export * from "./hash.js";
export * from "./time.js";
