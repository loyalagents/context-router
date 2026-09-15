import baseline from "../../test/contracts/fixtures/mcp-contract-baseline.json";
import { collectMcpContractBaseline } from "../../test/contracts/mcp-contract-collector";

describe("MCP public contract baseline", () => {
  it("matches server, tool, resource, OAuth, DCR, challenge, and visibility fixtures", () => {
    expect(collectMcpContractBaseline()).toEqual(baseline);
  });

  it("keeps exactly six mutation operations and no structured output schema", () => {
    const mutationTool = baseline.tools.find(
      (tool) => tool.descriptor.name === "mutatePreferences",
    );
    expect(
      mutationTool?.descriptor.inputSchema.properties.operation.enum,
    ).toEqual([
      "SUGGEST_PREFERENCE",
      "SET_PREFERENCE",
      "CREATE_DEFINITION",
      "UPDATE_DEFINITION",
      "ARCHIVE_DEFINITION",
      "DELETE_PREFERENCE",
    ]);
    expect(mutationTool?.descriptor).not.toHaveProperty("outputSchema");
    expect(mutationTool?.resultEnvelope).toBe("text-only");
  });
});
