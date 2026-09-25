# Step 06 Integration Evidence

Root remains sole repository writer. The three independent selection approvals at `eee89f960e235daa1f2b5b77312eb114f1fc80ac` authorize CP2 under the reviewed plan; fresh final review is separate.

## Shared AI Contract

New contract tests first failed for the absent execution module, capabilities/status and optional controls. Minimal provider-neutral types now expose immutable capabilities, bounded status, optional AbortSignal and an absolute monotonic deadline, plus fixed typed errors. The workflow helper creates one local 180-second budget or preserves a shorter caller deadline; hosted execution without controls stays unchanged, while explicit unsupported controls reject before provider calls. The no-model adapter retains its fixed unavailable message and adds truthful empty capabilities/status. Direct mocks, shared test application and evaluation harness carry additive capability/status fields.

Targeted contract/hosted/no-model tests passed (10 tests); all five current consumer suites plus the contract suite passed (78 tests). Backend build passed with Node 24.21.0/pnpm 10.25.0. Consumer control propagation, production adapter and actual composition remain next slices; this is not final integration evidence.
