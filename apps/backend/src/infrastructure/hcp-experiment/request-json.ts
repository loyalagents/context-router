/** Query/MCP-only bounded JSON reader. OAuth and human form parsing stay separate. */
import type { IncomingMessage } from "node:http";

export class RequestJsonError extends Error {
  constructor(readonly kind: "media" | "parse" | "duplicate" | "size") {
    super("Invalid JSON request");
  }
}

/** Scan before JSON.parse discards duplicate decoded member names. */
export function parseRequestJson(text: string): any {
  let at = 0;
  const fail = (): never => {
    throw new RequestJsonError("parse");
  };
  const space = () => {
    while (/[\x20\t\r\n]/.test(text[at] ?? "x")) at++;
  };
  const string = (): string => {
    const start = at++;
    for (; at < text.length; at++) {
      if (text[at] === "\\") {
        at++;
        continue;
      }
      if (text[at] === '"') {
        try {
          return JSON.parse(text.slice(start, ++at));
        } catch {
          fail();
        }
      }
    }
    return fail();
  };
  const value = (depth: number): void => {
    if (depth > 64) fail();
    space();
    const first = text[at];
    if (first === '"') {
      string();
      return;
    }
    if (first === "{" || first === "[") {
      if (depth >= 64) fail();
      at++;
      space();
      const end = first === "{" ? "}" : "]",
        names = new Set<string>();
      if (text[at] === end) {
        at++;
        return;
      }
      for (;;) {
        space();
        if (first === "{") {
          if (text[at] !== '"') fail();
          const name = string();
          if (names.has(name)) throw new RequestJsonError("duplicate");
          names.add(name);
          space();
          if (text[at++] !== ":") fail();
        }
        value(depth + 1);
        space();
        const next = text[at++];
        if (next === end) return;
        if (next !== ",") fail();
      }
    }
    const token =
      /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(
        text.slice(at),
      );
    if (!token) fail();
    at += token![0].length;
  };
  value(0);
  space();
  if (at !== text.length) fail();
  try {
    return JSON.parse(text);
  } catch {
    return fail();
  }
}

export async function requestJson(req: IncomingMessage): Promise<any> {
  for (const name of ["content-type", "content-encoding"])
    if (
      req.rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === name)
        .length > 1
    )
      throw new RequestJsonError("media");
  if (
    !/^\s*application\/json\s*(?:;\s*charset\s*=\s*(?:utf-8|"utf-8")\s*)?$/i.test(
      String(req.headers["content-type"] ?? ""),
    ) ||
    (req.headers["content-encoding"] !== undefined &&
      String(req.headers["content-encoding"]).toLowerCase() !== "identity")
  )
    throw new RequestJsonError("media");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32768) throw new RequestJsonError("size");
    chunks.push(chunk);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      Buffer.concat(chunks),
    );
  } catch {
    throw new RequestJsonError("parse");
  }
  return parseRequestJson(text);
}
