export function parseStrictJson<T>(text: string, validate: (value: unknown) => value is T): T {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const value: unknown = JSON.parse(cleaned);
  if (!validate(value)) {
    throw new Error("The AI response did not match the expected format.");
  }
  return value;
}
