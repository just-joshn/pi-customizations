# npm:@typescript/typescript-linux-loong64@7.0.2

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
- `parity/research/dep-closure-wave-002/npm/@typescript__typescript-linux-loong64@7.0.2/registry.json` sha256=`0bf3a7ae354c3885ca2cd7b65753ef9d44595bdc60ddf4d4829e1c98bcffee45` bytes=2428
  - dist.integrity + name/version:
```
{
  "name": "@typescript/typescript-linux-loong64",
  "version": "7.0.2",
  "integrity": "sha512-uEHck9i8hoAzXPiYRib1O7miOnz23SxIeVl6F4LXox+qov1K35jHcEW6VHKvZI+pyvl7fZEP4MCU5LYvIq1GuQ==",
  "tarball": "https://registry.npmjs.org/@typescript/typescript-linux-loong64/-/typescript-linux-loong64-7.0.2.tgz"
}
```
- `parity/research/dep-closure-wave-002/npm/@typescript__typescript-linux-loong64@7.0.2/unpacked/package/package.json` sha256=`4a0f84f61577ca3c6a7396b436a99e3d8d4e94a148b0b1352499cc619d9341b5` bytes=1050
  - name/version/os/cpu/deps:
```
{
  "name": "@typescript/typescript-linux-loong64",
  "version": "7.0.2",
  "dependencies": null,
  "optionalDependencies": null,
  "os": [
    "linux"
  ],
  "cpu": [
    "loong64"
  ]
}
```
- `parity/research/dep-closure-wave-002/npm/@typescript__typescript-linux-loong64@7.0.2/file-inventory.json` sha256=`d6d74027a40287a782f6f3467418a9c91b5454856219711833a67673ef698738` bytes=18565
  - inventory summary:
```
{
  "inventoriedFileCount": 113,
  "totalUnpackedFiles": 114
}
```
