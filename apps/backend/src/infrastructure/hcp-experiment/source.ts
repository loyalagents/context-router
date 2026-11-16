/** Source-only synthetic admission. No installed roots, migration, repair or reset. */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  createHash,
  randomBytes,
  X509Certificate,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import { execFileSync } from "node:child_process";
import { hcpSourceToolEnvironment } from "../../config/hcp-source-tools";
import {
  privateRoot,
  regular,
  pin,
  samePin,
  assertRoot,
  syncDirectory,
} from "../filesystem/private-files";
import { SyntheticExperiment } from "./store";
import { syntheticFixtures } from "./fixtures";
import { createSyntheticAuthorization } from "../../composition/hcp-authorization";

export class SourceRefusal extends Error {}
const refuse = (): never => {
  throw new SourceRefusal(
    "Source instance ownership or configuration refused. Preserve this sandbox; no repair or reset was attempted.",
  );
};
const digest = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");
const ROOTS = ["browser", "data", "launcher", "tls"];
const TLS_FILES = [
  "ca.key",
  "ca.pem",
  "ca.srl",
  "extensions",
  "leaf.csr",
  "leaf.key",
  "leaf.pem",
];
function sandboxRoot(sandbox: string) {
  if (
    typeof sandbox !== "string" ||
    !path.isAbsolute(sandbox) ||
    path.resolve(sandbox) !== sandbox
  )
    refuse();
  return privateRoot(sandbox);
}
function read(file: string): Buffer {
  const expected = pin(regular(file));
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!samePin(fs.fstatSync(fd), expected)) refuse();
    const bytes = fs.readFileSync(fd);
    if (!samePin(regular(file), expected)) refuse();
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}
function write(file: string, value: string) {
  const fd = fs.openSync(
    file,
    fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      fs.constants.O_WRONLY |
      fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.writeFileSync(fd, value);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  syncDirectory(privateRoot(path.dirname(file)));
}
export function sourceConfiguration(port: number) {
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) refuse();
  const issuer = `https://as.hcp.test:${port}`;
  return {
    issuer,
    resource: issuer,
    clients: ["a", "b"].map((id) => ({
      id,
      name: `Controlled client ${id.toUpperCase()}`,
      operator: {
        id: "https://example.test/operators/synthetic",
        name: "Synthetic fixture operator",
      },
      redirectUri: `https://client-${id}.hcp.test:${port}/callback`,
    })),
  };
}
function certificates(directory: string) {
  const run = (args: string[]) =>
    execFileSync("openssl", args, {
      cwd: directory,
      stdio: "ignore",
      timeout: 15_000,
      env: hcpSourceToolEnvironment(),
    });
  run([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-days",
    "7",
    "-subj",
    "/CN=Owned HCP source synthetic CA",
    "-keyout",
    "ca.key",
    "-out",
    "ca.pem",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
  ]);
  run([
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-subj",
    "/CN=as.hcp.test",
    "-keyout",
    "leaf.key",
    "-out",
    "leaf.csr",
  ]);
  write(
    path.join(directory, "extensions"),
    "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:as.hcp.test\n",
  );
  run([
    "x509",
    "-req",
    "-in",
    "leaf.csr",
    "-CA",
    "ca.pem",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-days",
    "7",
    "-sha256",
    "-extfile",
    "extensions",
    "-out",
    "leaf.pem",
  ]);
  // Only freshly created, exclusively owned fixture outputs are narrowed.
  for (const name of TLS_FILES) {
    const file = path.join(directory, name),
      stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid())
      refuse();
    fs.chmodSync(file, 0o600);
    const fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
  syncDirectory(privateRoot(directory));
}
function tlsMaterial(sandbox: string) {
  const tls = {
    key: read(path.join(sandbox, "tls/leaf.key")),
    cert: read(path.join(sandbox, "tls/leaf.pem")),
    ca: read(path.join(sandbox, "tls/ca.pem")),
  };
  const leaf = new X509Certificate(tls.cert),
    ca = new X509Certificate(tls.ca),
    now = Date.now();
  if (
    [leaf, ca].some(
      (cert) =>
        Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) <= now,
    )
  )
    throw new SourceRefusal(
      "The source TLS identity is expired or not yet valid. Certificates are never regenerated on reopen; preserve this instance.",
    );
  if (
    !ca.ca ||
    !leaf.verify(ca.publicKey) ||
    leaf.checkHost("as.hcp.test") !== "as.hcp.test" ||
    !createPublicKey(createPrivateKey(tls.key)).equals(leaf.publicKey)
  )
    refuse();
  return tls;
}
export async function initializeSource(
  sandbox: string,
  port: number,
  approve: (review: any) => Promise<string>,
) {
  const root = sandboxRoot(sandbox),
    configuration = sourceConfiguration(port);
  if (fs.readdirSync(sandbox).length) refuse();
  for (const name of ["launcher", "tls", "browser"])
    privateRoot(path.join(sandbox, name), true);
  const humanCredential = randomBytes(32).toString("base64url");
  write(path.join(sandbox, "launcher/human.credential"), humanCredential);
  certificates(path.join(sandbox, "tls"));
  tlsMaterial(sandbox);
  const fixtures = syntheticFixtures();
  // A distinct, plainly synthetic string target; existing structured fixtures remain intact.
  const statement = structuredClone(fixtures[1]);
  statement.classification.categories = ["general_preferences"];
  statement.versions[0].content.value =
    "Synthetic dashboard persona prefers a concise written summary.";
  fixtures.push(statement);
  const expired = structuredClone(statement);
  expired.versions[0].content.value =
    "Synthetic expired travel preference, retained for inspection.";
  expired.versions[0].assertion.validUntil = "2000-01-01T00:00:00.000Z";
  fixtures.push(expired);
  const store = SyntheticExperiment.create(
    { sandbox, root: path.join(sandbox, "data") },
    { pendingApproval: true, fixtures },
  );
  let subjectId: string;
  try {
    const authority = store.authorization(configuration, humanCredential),
      review = authority.reviewBootstrap(humanCredential);
    if ((await approve(review)) !== `approve ${review.digest}`)
      throw new SourceRefusal(
        "Synthetic fixture approval cancelled; this partial sandbox is retained and cannot serve.",
      );
    authority.approveBootstrap(humanCredential, review.reviewId, review.digest);
    if (!authority.entryReadEnabled()) refuse();
    subjectId = authority.accountId();
  } finally {
    store.close();
  }
  assertRoot(root);
  const files = [
    "launcher/human.credential",
    "data/synthetic-manifest.json",
    ...TLS_FILES.map((n) => `tls/${n}`),
  ];
  const descriptor = {
    kind: "cr-hcp-source",
    version: 1,
    sandbox,
    configuration,
    subjectId,
    roots: Object.fromEntries(
      ROOTS.map((name) => [name, pin(fs.lstatSync(path.join(sandbox, name)))]),
    ),
    data: pin(regular(path.join(sandbox, "data/entries.sqlite"))),
    files: Object.fromEntries(
      files.map((name) => [
        name,
        {
          pin: pin(regular(path.join(sandbox, name))),
          digest: digest(read(path.join(sandbox, name))),
        },
      ]),
    ),
  };
  // Last publication; absence never implies a ready instance, including after interruption.
  write(path.join(sandbox, "launcher/ready.json"), JSON.stringify(descriptor));
  return {
    issuer: configuration.issuer,
    credentialFile: path.join(sandbox, "launcher/human.credential"),
  };
}
export function readSource(sandbox: string) {
  const root = sandboxRoot(sandbox);
  if (fs.readdirSync(sandbox).sort().join() !== ROOTS.join()) refuse();
  privateRoot(path.join(sandbox, "launcher"));
  const descriptor = JSON.parse(
    read(path.join(sandbox, "launcher/ready.json")).toString(),
  );
  const port = Number(new URL(descriptor.configuration?.issuer).port);
  if (
    descriptor.kind !== "cr-hcp-source" ||
    descriptor.version !== 1 ||
    descriptor.sandbox !== sandbox ||
    JSON.stringify(descriptor.configuration) !==
      JSON.stringify(sourceConfiguration(port)) ||
    Object.keys(descriptor).sort().join() !==
      "configuration,data,files,kind,roots,sandbox,subjectId,version" ||
    Object.keys(descriptor.roots).sort().join() !== ROOTS.join()
  )
    refuse();
  for (const name of ROOTS) {
    privateRoot(path.join(sandbox, name));
    if (
      !samePin(fs.lstatSync(path.join(sandbox, name)), descriptor.roots[name])
    )
      refuse();
  }
  const expected = [
    "launcher/human.credential",
    "data/synthetic-manifest.json",
    ...TLS_FILES.map((n) => `tls/${n}`),
  ].sort();
  if (
    Object.keys(descriptor.files).sort().join() !== expected.join() ||
    fs.readdirSync(path.join(sandbox, "tls")).sort().join() !== TLS_FILES.join()
  )
    refuse();
  for (const name of expected) {
    const file = path.join(sandbox, name);
    if (
      !samePin(regular(file), descriptor.files[name].pin) ||
      digest(read(file)) !== descriptor.files[name].digest
    )
      refuse();
  }
  if (
    !samePin(
      regular(path.join(sandbox, "data/entries.sqlite")),
      descriptor.data,
    )
  )
    refuse();
  const humanCredential = read(
    path.join(sandbox, "launcher/human.credential"),
  ).toString();
  if (!/^[A-Za-z0-9_-]{43}$/.test(humanCredential)) refuse();
  const tls = tlsMaterial(sandbox);
  assertRoot(root);
  return { descriptor, humanCredential, tls };
}
export async function serveSource(sandbox: string) {
  const { descriptor, humanCredential, tls } = readSource(sandbox);
  // Validate the closed bootstrap and stable subject without opening a socket.
  const store = SyntheticExperiment.open({
    sandbox,
    root: path.join(sandbox, "data"),
  });
  try {
    const authority = store.authorization(
      descriptor.configuration,
      humanCredential,
    );
    if (
      !authority.entryReadEnabled() ||
      authority.bootstrapPending() ||
      authority.accountId() !== descriptor.subjectId
    )
      refuse();
  } finally {
    store.close();
  }
  return createSyntheticAuthorization(
    { sandbox, root: path.join(sandbox, "data") },
    {
      reopen: true,
      port: Number(new URL(descriptor.configuration.issuer).port),
      humanCredential,
      tls,
      clients: descriptor.configuration.clients,
    },
  );
}
