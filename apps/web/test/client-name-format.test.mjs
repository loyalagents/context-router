import test from "node:test";
import assert from "node:assert/strict";
import {
  activityClientKey,
  activityChangeId,
  localClientId,
  usableClientName,
} from "../lib/local-client-name.ts";

test("activity fragments accept one exact instance and never interpret names or extra parameters", () => {
  const id = "--" + "A".repeat(20);
  assert.equal(activityClientKey("#mcp-client=" + id), "local:" + id);
  assert.equal(localClientId("local:" + id), id);
  for (const hash of [
    "",
    "#mcp-client=short",
    "#mcp-client=" + id + "&other=x",
    "#mcp-client=" + id + "&mcp-client=" + id,
    "#mcp-client=%41" + id.slice(1),
    "#other=" + id,
    "#mcp-client=" + id + "x",
  ])
    assert.equal(activityClientKey(hash), "");
  for (const key of ["codex", id, "local:short", "other:local:" + id])
    assert.equal(localClientId(key), null);
  for (const name of ["", "  ", "x".repeat(65), "line\nfeed", "nul\0", null])
    assert.equal(usableClientName(name), false);
  assert.equal(usableClientName("<script>literal</script>"), true);
});


test('activity change fragments bind an exact client and event and reject malformed additions',()=>{
 const id='A'.repeat(22),event='a'.repeat(32),hash='#mcp-client='+id+'&change='+event;
 assert.equal(activityClientKey(hash),'local:'+id);assert.equal(activityChangeId(hash),event);
 assert.equal(activityChangeId('#mcp-client='+id),null);
 for(const malformed of [hash+'x',hash+'&other=x','#change='+event,'#mcp-client='+id+'&change=short']){assert.equal(activityClientKey(malformed),'');assert.equal(activityChangeId(malformed),null);}
});
