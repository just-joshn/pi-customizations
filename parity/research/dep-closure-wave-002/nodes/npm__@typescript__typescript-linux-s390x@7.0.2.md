# npm:@typescript/typescript-linux-s390x@7.0.2

Previously incomplete: True

## Disposition

Lock entry, registry metadata, tarball, and package.json read. No further npm dependencies. Platform os/cpu constraints recorded. Native binary contents inventoried at file-hash level where unpacked.

proposeReadingComplete: True
proposeDependenciesEnumerated: True

## Sources

- `parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/bun.lock` sha256=`667d9cf7222e9aae3fa42a4be383e657784216e9df115da02227fbc5ac7bbe46` bytes=6679
  - packages["typescript"] optionalDependencies fragment:
```
    "typescript": ["typescript@7.0.2", "", { "optionalDependencies": { "@typescript/typescript-aix-ppc64": "7.0.2", "@typescript/typescript-darwin-arm64": "7.0.2", "@typescript/typescript-darwin-x64": "7.0.2", "@typescript/typescript-freebsd-arm64": "7.0.2", "@typescript/typescript-freebsd-x64": "7.0.2", "@typescript/typescript-linux-arm": "7.0.2", "@typescript/typescript-linux-arm64": "7.0.2", "@typescript/typescript-linux-loong64": "7.0.2", "@typescript/typescript-linux-mips64el": "7.0.2", "@typescript/typescript-linux-ppc64": "7.0.2", "@typescript/typescript-linux-riscv64": "7.0.2", "@typescript/typescript-linux-s390x": "7.0.2", "@typescript/typescript-linux-x64": "7.0.2", "@typescript/ty
```
- `parity/research/dep-closure-wave-002/npm/@typescript__typescript-linux-s390x@7.0.2/registry.json` sha256=`48873c77feef3844df02767235a03c2d35e402ac86af4c9205910b4abfe4b6ef` bytes=2412
  - dist.integrity + name/version:
```
{
  "name": "@typescript/typescript-linux-s390x",
  "version": "7.0.2",
  "integrity": "sha512-IkwJc3L7yhytWd/ewjyxNDfOmswCm9GWMJT/ue/dU4aZNbwZeYAetq42VyLmsmSjvoX7z74X6ZaYCtzAr0EuGw==",
  "tarball": "https://registry.npmjs.org/@typescript/typescript-linux-s390x/-/typescript-linux-s390x-7.0.2.tgz"
}
```
- `parity/research/dep-closure-wave-002/npm/@typescript__typescript-linux-s390x@7.0.2/unpacked/package/package.json` sha256=`e068cbdcf525ec6c0e27a6ba2d610419883b4e9821edb150f7d0258577947a9c` bytes=1046
  - name/version/os/cpu/deps:
```
{
  "name": "@typescript/typescript-linux-s390x",
  "version": "7.0.2",
  "dependencies": null,
  "optionalDependencies": null,
  "os": [
    "linux"
  ],
  "cpu": [
    "s390x"
  ]
}
```
- `parity/research/dep-closure-wave-002/npm/@typescript__typescript-linux-s390x@7.0.2/file-inventory.json` sha256=`2056dbea874f881604e51052d00e16fad94f1b5a07a0c760de101f4bbacafec6` bytes=18565
  - inventory summary:
```
{
  "inventoriedFileCount": 113,
  "totalUnpackedFiles": 114
}
```
