# Platform, Network And Hosting Options

- Status: wanted options; unactivated, no implementation or release commitment
- Owner: product owner assigns a coordinator when a specific outcome is chosen

These replace optional numbered migration Steps 10–11 and retain other deferred
capabilities without expanding the colleague pilot.

| Option | Direction and boundary |
| --- | --- |
| Windows/Linux app | Reuse application ports and supported OS primitives. Qualify native dependencies, launch/stop, secure paths/permissions, credentials, signing/distribution and real installed lifecycle per OS. Current macOS evidence is not portable proof. |
| Other Apple Silicon configurations | Start with the pilot's actual hardware/RAM/OS. Measure memory, performance and supported model envelope before advertising support. |
| LAN context server | Separate explicit mode with authenticated per-client authority, TLS and reviewed network/origin/Host/discovery boundaries. Same-network location is not trust. Keep loopback defaults. No public tunnel implicitly authorized. |
| Future hosted deployment | Use retained storage/model/identity ports; independently plan PostgreSQL or hosted-model adapters, multi-user isolation, secrets, deployment and public authentication. SQLite-to-PostgreSQL data migration only if future requirements demand it. |
| Cloud sync | Still deferred. Hosting a server is not bidirectional sync; conflict resolution, cross-device identity and data authority need a separate product decision. |
| Product import/export | Not equivalent to offline matching-pair backup/restore. Define scope, sensitive-data handling, identity/grant implications and compatibility before implementation. |
| Image/OCR input | Unsupported by the selected local baseline. Qualify parser/model capability and every UI/MCP upload/discovery/validation consumer together. |
| Automatic updates / wider distribution | Separate from assisted private download and replacement. Signing, integrity, rollback/reset consent, model compatibility, interrupted updates and disk retention need qualification. |

Claude/ChatGPT connections are owned by [MCP onboarding](../mcp-onboarding/README.md),
not a reason to activate LAN/public hosting. Optional hosted inference is owned by
[provider choice](../model-provider-selection/README.md), not a commitment to host
the application. Keep these decisions separate and use the
[interface policy](../../../useful/INTERFACE_EVOLUTION.md) for any public transition.
