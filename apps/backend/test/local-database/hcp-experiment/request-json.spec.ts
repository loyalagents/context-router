import {
  parseRequestJson,
  RequestJsonError,
} from "../../../src/infrastructure/hcp-experiment/request-json";

it("compares decoded JSON names locally at every depth, without normalizing different names", () => {
  for (const text of ['{"x":1,"x":2}', '{"outer":[{"a":1,"\\u0061":2}]}'])
    expect(() => parseRequestJson(text)).toThrow(RequestJsonError);
  for (const text of [
    '{"a":{"x":1},"b":{"x":2}}',
    '{"é":1,"é":2}',
    '{"__proto__":{"x":1},"constructor":2}',
    '{"quote\\\"":"back\\\\slash"}',
    "[null,true,false,-0,1.2,1e+3]",
  ])
    expect(parseRequestJson(text)).toEqual(JSON.parse(text));
});
it("rejects invalid JSON and bounds nesting before recursion can exhaust the stack", () => {
  for (const text of [
    '{"a":1,}',
    "[1,]",
    "01",
    "+1",
    "NaN",
    '{"a":"\\x12"}',
    '"\n"',
    "{} {}",
    "[",
    '"unterminated',
    "[".repeat(66) + "0" + "]".repeat(66),
  ])
    expect(() => parseRequestJson(text)).toThrow(RequestJsonError);
});

it("allows exactly 64 containers and refuses 65, including empty innermost containers", () => {
  for (const [open, close, leaf] of [
    ["[", "]", "0"],
    ['{"x":', "}", "0"],
    ["[", "]", ""],
    ['{"x":', "}", "{}"],
  ]) {
    const offset = leaf === "{}" ? 1 : 0;
    const accepted =
      open.repeat(64 - offset) + leaf + close.repeat(64 - offset);
    const refused = open.repeat(65 - offset) + leaf + close.repeat(65 - offset);
    expect(parseRequestJson(accepted)).toEqual(JSON.parse(accepted));
    expect(() => parseRequestJson(refused)).toThrow(RequestJsonError);
  }
});
