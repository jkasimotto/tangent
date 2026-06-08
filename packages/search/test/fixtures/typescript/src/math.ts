export type GreetingParts = {
  name: string;
};

export function formatGreeting(parts: GreetingParts): string {
  return helper(parts.name);
}

function helper(name: string): string {
  return `hello ${name}`;
}

export class Greeter {
  greet(name: string): string {
    return formatGreeting({ name });
  }
}
