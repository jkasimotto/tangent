import { formatGreeting } from "./math";

test("formatGreeting", () => {
  expect(formatGreeting({ name: "Ada" })).toBe("hello Ada");
});
