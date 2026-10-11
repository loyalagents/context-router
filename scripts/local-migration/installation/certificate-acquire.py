"""P1 only: acquire reviewed small prebuilt closure; never import or run scripts.

All outputs are private temporary fixtures, not a package-manager installation.
HTTPS registry integrity is verified; this is not npm provenance-signature proof.
"""
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import tarfile
import tempfile
import urllib.parse
import urllib.request

os.umask(0o077)
root = Path(tempfile.mkdtemp(prefix="context-router-cert-p1-")).resolve()
print(root, flush=True)
versions = {f"@peculiar/asn1-{part}": "2.9.4" for part in
            "cms csr ecc pkcs9 rsa schema x509 x509-post-quantum x509-attr pfx pkcs8 asym-key".split()}
versions.update({"@peculiar/x509": "2.1.0", "@peculiar/utils": "2.0.2",
                 "asn1js": "3.0.10", "pvtsutils": "1.3.6", "pvutils": "1.1.5",
                 "tsyringe": "4.10.0", "tslib": "2.8.1", "reflect-metadata": "0.2.2"})
entries = list(versions.items()) + [("tslib", "1.14.1")]
assert len(entries) == 21

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError("Unexpected registry redirect")

opener = urllib.request.build_opener(NoRedirect)
def download(url, maximum):
    parsed = urllib.parse.urlsplit(url)
    assert parsed.scheme == "https" and parsed.netloc == "registry.npmjs.org"
    with opener.open(url, timeout=15) as response:
        assert response.status == 200
        value = response.read(maximum + 1)
        assert len(value) <= maximum
        return value

records = []
unpacked_total = 0
for name, version in entries:
    encoded = urllib.parse.quote(name, safe="")
    metadata = json.loads(download(f"https://registry.npmjs.org/{encoded}/{version}", 1_000_000))
    assert metadata["name"] == name and metadata["version"] == version
    assert not metadata.get("optionalDependencies")
    assert not metadata.get("bin")
    assert not any(key in metadata.get("scripts", {}) for key in ("preinstall", "install", "postinstall"))
    integrity = metadata["dist"]["integrity"]
    assert integrity.startswith("sha512-")
    if name == "@peculiar/x509":
        assert integrity == "sha512-IYbg1R03CSQGWwl24kGyqrdVtixNSbRaDvBg1r5wyYjTP+VwPQkka1BzTgU5+vxiuwqg04OxdvdJ1xYYFIdUSA=="
    archive = download(metadata["dist"]["tarball"], 1_000_000)
    assert hashlib.sha512(archive).digest() == base64.b64decode(integrity[7:], validate=True)
    destination = root / "node_modules" / name
    if name == "tslib" and version == "1.14.1":
        destination = root / "node_modules/tsyringe/node_modules/tslib"
    destination.mkdir(parents=True, mode=0o700)
    license_files = []
    file_count = 0
    unpacked = 0
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for member in tar:
            relative = PurePosixPath(member.name)
            assert not relative.is_absolute() and ".." not in relative.parts
            assert relative.parts[0] == "package"
            if member.isdir():
                continue
            assert member.isfile() and 0 <= member.size <= 1_000_000
            target = destination.joinpath(*relative.parts[1:])
            assert target != destination
            unpacked += member.size
            unpacked_total += member.size
            assert unpacked_total <= 3_000_000
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with target.open("xb") as output:
                output.write(tar.extractfile(member).read())
            file_count += 1
            if "license" in target.name.lower() or "copyright" in target.name.lower():
                license_files.append(str(target.relative_to(destination)))
    manifest = json.loads((destination / "package.json").read_text())
    assert manifest["name"] == name and manifest["version"] == version
    assert manifest.get("dependencies", {}) == metadata.get("dependencies", {})
    assert not any(key in manifest.get("scripts", {}) for key in ("preinstall", "install", "postinstall"))
    assert license_files, f"Missing actual license: {name}"
    records.append({"name": name, "version": version, "integrity": integrity,
                    "archiveBytes": len(archive), "unpackedBytes": unpacked,
                    "files": file_count, "dependencies": manifest.get("dependencies", {}),
                    "scripts": manifest.get("scripts", {}), "license": manifest.get("license"),
                    "licenseFiles": license_files, "tarball": metadata["dist"]["tarball"]})
    (root / "acquisition.json").write_text(json.dumps({"complete": False, "packages": records}, indent=2) + "\n")
assert unpacked_total == 2_266_576
(root / "acquisition.json").write_text(json.dumps({"complete": True, "unpackedBytes": unpacked_total,
    "packages": records, "limitations": ["Registry HTTPS and SHA-512 integrity verified; provenance signatures not verified.",
    "No package imports, build scripts, installation, or product dependencies changed."]}, indent=2) + "\n")
print(f"Acquired {len(records)} exact package versions; {unpacked_total} unpacked bytes; no execution", flush=True)
