export type GreetingParts = {
  name: string;
};

/** Formats a greeting for the named person; fixture entry point exercised by the indexer tests. */
export function formatGreeting(parts: GreetingParts): string {
  return helper(parts.name);
}

/** Builds the greeting string; fixture callee for caller/callee edge tests. */
function helper(name: string): string {
  return `hello ${name}`;
}

export class Greeter {
  /** Greets by delegating to formatGreeting; fixture method for symbol tests. */
  greet(name: string): string {
    return formatGreeting({ name });
  }
}
