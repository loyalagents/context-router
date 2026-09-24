import type { DatabaseSync } from "node:sqlite";
// Adapter-private SQL predicate matching the reference adapter's LIKE semantics.
// No RegExp, recursion, public limit, or alternate query/pagination path.
const MANY = Symbol("many");
const ONE = Symbol("one");
export function compileLike(pattern: string) {
  if (pattern.includes("\0")) throw new Error("Invalid text");
  const tokens: Array<string | symbol> = [];
  let escaped = false;
  for (const char of pattern) {
    if (escaped) {
      tokens.push(char);
      escaped = false;
    } else if (char === "\\") escaped = true;
    else if (char === "%") {
      if (tokens.at(-1) !== MANY) tokens.push(MANY);
    } else tokens.push(char === "_" ? ONE : char);
  }
  if (escaped) throw new Error("Invalid pattern");
  return (value: string) => {
    if (value.includes("\0")) throw new Error("Invalid text");
    const input = Array.from(value);
    let cursor = 0;
    let token = 0;
    let star = -1;
    let retry = 0;
    while (cursor < input.length) {
      if (tokens[token] === ONE || tokens[token] === input[cursor]) {
        cursor++;
        token++;
      } else if (tokens[token] === MANY) {
        star = token++;
        retry = cursor;
      } else if (star >= 0) {
        token = star + 1;
        cursor = ++retry;
      } else return false;
    }
    while (tokens[token] === MANY) token++;
    return token === tokens.length;
  };
}

export function installLike(db: DatabaseSync) {
  let lastPattern: string | undefined;
  let predicate: ((value: string) => boolean) | undefined;
  db.function(
    "storage_like",
    { deterministic: true, directOnly: true },
    (pattern, value) => {
      if (value === null) return null;
      if (typeof pattern !== "string" || typeof value !== "string")
        throw new Error("Invalid text");
      if (pattern !== lastPattern) {
        predicate = compileLike(pattern);
        lastPattern = pattern;
      }
      return predicate(value) ? 1 : 0;
    },
  );
}
