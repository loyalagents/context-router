# Step 09 P1-V Node Signature Probe

- Revision: P1-V.1, proposed, affected independent re-review pending
- Parent scope: P1 checkpoint 1 production closure/authenticated runtime inputs
- Sole writer/operator: `/root`; reviewers read-only

Complete the existing cached Node archive's signature verification without a
personal GPG installation or a new product dependency. Metadata-only independent
inventory recommends one temporary prebuilt `openpgp@6.3.2` package, no declared
runtime dependencies, LGPL-3.0+ retained outside the application. Official source
tag target/gitHead is `5f33328a3b601fb9c9dce310d1ecc137db0dbc75`; npm has registry
signatures but no provenance attestation. Do not claim those signatures verified.

Registry SHA-512 is
`wcZTzHz41LV8Y48zH/JlD1JT8YdNmpWOuMAjQ/podvvCwsjBEU37K3znJh4UQcj3hksE5z9TzvhbUbwzsGvlLQ==`.
Published unpacked size: 17,421,480 bytes, 43 files. Acquire one exact tarball
over HTTPS from registry.npmjs.org, cap at eight MiB, verify the pinned SHA-512,
and exclusively extract only bounded regular files below a new private temporary
root (twenty MiB total). Refuse links/traversal/unexpected package identity. No
package manager, prepare/build/install script, native build or product lock edit.

Before importing, independently inspect actual Node entry
`dist/node/openpgp.mjs`, literal/dynamic imports, bundled WebAssembly/local asset
references, network/process sinks, and LICENSE. Execution remains gated on that
inspection. Acquisition alone does not approve unseen code.

Fetch only two small pinned official inputs, each at most 64 KiB with bounded
HTTPS timeout and no arbitrary redirects:

- Key from the official nodejs/release-keys repository at commit
  `481637f813e912c4aa3622d7964ab426c97b8e8d`, path
  `keys/5BE8A3F6C8A5C01D106C0AD820B1A390B168D356.asc`; expected 924 bytes,
  SHA-256 `5115095e2f8010c75da052ecb1cfb3af630e084f0f8daa93a863557b01b0f90a`.
- `https://nodejs.org/dist/v24.21.0/SHASUMS256.txt.asc`; expected 3,449 bytes,
  SHA-256 `dd0fe71660e64f4dc01342664835509c84679d8a87ab4d76cc2f15fdda82ea3e`.

Trust the exact signer fingerprint
`5BE8A3F6C8A5C01D106C0AD820B1A390B168D356` from the versioned official Node
README. Fingerprint-check the parsed key, verify the clear-signed checksums with
`expectSigned: true`, require exactly one verified signature, then parse only
the fixed `node-v24.21.0-darwin-arm64.tar.xz` entry and compare its SHA-256 to the
existing cached archive. No arbitrary manifest-selected file path, backdated
verification, weakened key/algorithm validation, or unsigned checksum fallback.

One bounded private verifier process using the established trusted host Node
24.21.0 at its fixed absolute toolchain path, with network and child execution
denied. Record that host runtime's identity. The cached target archive and staged
Node remain read-only inputs; never use the runtime being authenticated to
authenticate itself. Maximum 45 seconds active plus ten seconds exact-child
cleanup, whole probe at most one minute. One authentic signature/archive check,
one tampered-message rejection and one wrong-fingerprint rejection. No key
generation, model execution, new runtime archive download, system configuration
or public publishing. Retain safe result, input hashes and private logs; do not
include transient paths in product configuration.

This proves archive signature against the stated official key, within the HTTPS
and inspected verifier supply chain. It does not prove our eventual application
publisher authenticity, signing, notarization, Gatekeeper or update safety.
