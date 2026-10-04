import baseline from "./fixtures/mcp-contract-baseline.json";
import { collectMcpContractBaseline } from "./mcp-contract-collector";

describe("MCP public contract baseline", () => {
  it("records least-privilege token profiles and the separately qualified local transport", () => {
    const contract = collectMcpContractBaseline() as any;
    for (const profile of ["claude-absent-scope", "claude-empty-scope", "claude-unrecognized-scope"])
      expect(contract.visibility[profile]).toEqual({ tools: [], resources: [] });
    expect(contract.local.transport.protocols).toEqual(["2025-06-18", "2025-11-25"]);
    expect(contract.local.resources.map((r: any) => r.uri)).toEqual(["schema://graphql", "context-router://capabilities"]);
  });
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
