"""Reviewed P1-V.1 acquisition only; never imports packages or runs scripts."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import tarfile
import tempfile
import urllib.request

os.umask(0o077)
root = Path(tempfile.mkdtemp(prefix="context-router-node-signature-")).resolve()
print(root, flush=True)
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError("Unexpected redirect")
opener = urllib.request.build_opener(NoRedirect)
def fetch(url, maximum):
    with opener.open(url, timeout=15) as response:
        assert response.status == 200
        value = response.read(maximum + 1)
        assert len(value) <= maximum
        return value
archive = fetch("https://registry.npmjs.org/openpgp/-/openpgp-6.3.2.tgz", 8 * 1024 ** 2)
integrity = "wcZTzHz41LV8Y48zH/JlD1JT8YdNmpWOuMAjQ/podvvCwsjBEU37K3znJh4UQcj3hksE5z9TzvhbUbwzsGvlLQ=="
assert hashlib.sha512(archive).digest() == base64.b64decode(integrity, validate=True)
total = 0
files = []
with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
    for member in tar:
        relative = PurePosixPath(member.name)
        assert not relative.is_absolute() and ".." not in relative.parts and relative.parts[0] == "package"
        if member.isdir():
            continue
        assert member.isfile() and 0 <= member.size <= 20 * 1024 ** 2
        total += member.size
        assert total <= 20 * 1024 ** 2
        target = root.joinpath(*relative.parts)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        value = tar.extractfile(member).read()
        with target.open("xb") as output:
            output.write(value)
        files.append({"path": str(relative), "bytes": len(value), "sha256": hashlib.sha256(value).hexdigest()})
assert total == 17_421_480 and len(files) == 43
manifest = json.loads((root / "package/package.json").read_text())
assert manifest["name"] == "openpgp" and manifest["version"] == "6.3.2"
assert not manifest.get("dependencies")
assert not any(key in manifest.get("scripts", {}) for key in ("preinstall", "install", "postinstall"))
assert (root / "package/LICENSE").is_file()
inputs = [
    ("key.asc", "https://raw.githubusercontent.com/nodejs/release-keys/481637f813e912c4aa3622d7964ab426c97b8e8d/keys/5BE8A3F6C8A5C01D106C0AD820B1A390B168D356.asc", 924,
     "5115095e2f8010c75da052ecb1cfb3af630e084f0f8daa93a863557b01b0f90a"),
    ("checksums.asc", "https://nodejs.org/dist/v24.21.0/SHASUMS256.txt.asc", 3449,
     "dd0fe71660e64f4dc01342664835509c84679d8a87ab4d76cc2f15fdda82ea3e"),
]
for name, url, length, digest in inputs:
    value = fetch(url, 65536)
    assert len(value) == length and hashlib.sha256(value).hexdigest() == digest
    with (root / name).open("xb") as output:
        output.write(value)
(root / "acquisition.json").write_text(json.dumps({"revision": "P1-V.1", "archiveSha512": integrity,
    "archiveBytes": len(archive), "unpackedBytes": total, "files": files,
    "scriptsExecuted": False, "importsExecuted": False}, indent=2) + "\n")
print(f"Acquired {len(files)} regular files ({total} bytes) and two pinned small inputs; no execution", flush=True)
