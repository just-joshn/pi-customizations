#!/usr/bin/env python3
"""Authenticate commander@14.0.0 registry signature against npm v1 keys. Exit 0 if valid."""
from __future__ import annotations

import base64
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
REF = ROOT / "parity/reference/npm/commander-14.0.0"
KEYS_PATH = OUT / "npm-v1-keys.json"
REG_PATH = REF / "registry.json"
TGZ_PATH = REF / "package.tgz"


def main() -> int:
    if not KEYS_PATH.exists():
        print("BLOCKER: npm-v1-keys.json missing; cannot authenticate without inventing keys")
        return 2

    keys = json.loads(KEYS_PATH.read_text())
    reg = json.loads(REG_PATH.read_text())
    sig_entry = reg["dist"]["signatures"][0]
    want_keyid = sig_entry["keyid"]
    key = next((k for k in keys["keys"] if k.get("keyid") == want_keyid), None)
    if key is None:
        print(f"BLOCKER: keyid {want_keyid} not present in npm-v1-keys.json")
        return 2

    message = f"{reg['name']}@{reg['version']}:{reg['dist']['integrity']}".encode()
    der = base64.b64decode(key["key"])
    sig_der = base64.b64decode(sig_entry["sig"])
    pem = (
        "-----BEGIN PUBLIC KEY-----\n"
        + base64.encodebytes(der).decode()
        + "-----END PUBLIC KEY-----\n"
    )
    (OUT / "npm-signing-key.pem").write_text(pem)
    (OUT / "signature-message.txt").write_bytes(message)
    (OUT / "package.sig").write_bytes(sig_der)

    tgz = TGZ_PATH.read_bytes()
    sha512_b64 = base64.b64encode(hashlib.sha512(tgz).digest()).decode()
    integrity_ok = sha512_b64 == reg["dist"]["integrity"].removeprefix("sha512-")
    tarball_sha256 = hashlib.sha256(tgz).hexdigest()

    proc = subprocess.run(
        [
            "openssl",
            "dgst",
            "-sha256",
            "-verify",
            str(OUT / "npm-signing-key.pem"),
            "-signature",
            str(OUT / "package.sig"),
            str(OUT / "signature-message.txt"),
        ],
        capture_output=True,
        text=True,
    )
    openssl_ok = proc.returncode == 0 and "Verified OK" in (proc.stdout + proc.stderr)

    result = {
        "signatureAuthenticated": openssl_ok and integrity_ok,
        "keyid": want_keyid,
        "keyExpires": key.get("expires"),
        "keysSource": "https://registry.npmjs.org/-/npm/v1/keys",
        "keysLocalPath": str(KEYS_PATH.relative_to(ROOT)),
        "message": message.decode(),
        "integrityMatchedTarball": integrity_ok,
        "tarballSha256": tarball_sha256,
        "opensslReturncode": proc.returncode,
        "opensslStdout": proc.stdout.strip(),
        "opensslStderr": proc.stderr.strip(),
        "method": "openssl dgst -sha256 -verify against npm v1 ECDSA P-256 key matching registry keyid",
        "didNotInventSignature": True,
        "registrySignaturePresent": True,
        "attestationsPresentInRegistrySnapshot": reg["dist"].get("attestations") is not None,
    }
    (OUT / "signature-auth.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0 if result["signatureAuthenticated"] else 1


if __name__ == "__main__":
    sys.exit(main())
