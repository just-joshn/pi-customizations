# npm:@typescript/typescript-win32-x64@7.0.2

Previously incomplete: True

## Disposition

Lock entry, registry metadata, tarball, and package.json read. No further npm dependencies. Platform os/cpu constraints recorded. Native binary contents inventoried at file-hash level where unpacked.

proposeReadingComplete: True
proposeDependenciesEnumerated: True

## Sources

- `parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/bun.lock` sha256=`667d9cf7222e9aae3fa42a4be383e657784216e9df115da02227fbc5ac7bbe46` bytes=6679
  - packages["typescript"]:
```
    "typescript": ["typescript@7.0.2", "", { "optionalDependencies": { "@typescript/typescript-aix-ppc64": "7.0.2", "@typescript/typescript-darwin-arm64": "7.0.2", "@typescript/typescript-darwin-x64": "7.0.2", "@typescript/typescript-freebsd-arm64": "7.0.2", "@typescript/typescript-freebsd-x64": "7.0.2", "@typescript/typescript-linux-arm": "7.0.2", "@typescript/typescript-linux-arm64": "7.0.2", "@typescript/typescript-linux-loong64": "7.0.2", "@typescript/typescript-linux-mips64el": "7.0.2", "@t
```
  - packages["bun-types"]:
```
    "bun-types": ["bun-types@1.3.14", "", { "dependencies": { "@types/node": "*" } }, "sha512-4N0ig0fEomHt5R0KCFWjovxow98rIoRwKolrYdCcknNwMekCXRnWEUvgu5soYV8QXtVsrUD8B95MBOZGPvr6KQ=="],
```
  - packages["@types/node"]:
```
    "@types/node": ["@types/node@26.1.2", "", { "dependencies": { "undici-types": "~8.3.0" } }, "sha512-Vu4a5UFA9rIIFJ7rB/Vaafh9lrCQszopTCx6KjFboXTGQbPNasehVR5TEiithSDGyd1DEiUByggTZsg8jukeIg=="],
```
  - packages["undici-types"]:
```
    "undici-types": ["undici-types@8.3.0", "", {}, "sha512-j375ScV60dom+YkPFIfTLcOiPxkN/buHz5GobjLhixFuANaNs3C9l4GmrWqejgXWJ7BbJcFYpTEUkS1Ge8bpZQ=="],
```
- `parity/research/dep-closure-wave-001/npm/@typescript__typescript-win32-x64@7.0.2/registry.json` sha256=`55cd9d76319ab3ba552fd43fcba11e579fac14c5e232146917cf59fc69914a28` bytes=2396
  - dist.integrity + name/version:
```
{
  "name": "@typescript/typescript-win32-x64",
  "version": "7.0.2",
  "integrity": "sha512-0BQ3HkAHHlKLSp1qRvf3SUhGpGsDuhB/jgFw75guyqbxJqEaS0Cw/VFO8i2nHglJUzQCRtMMR/IBAKE3ETMC4g==",
  "tarball": "https://registry.npmjs.org/@typescript/typescript-win32-x64/-/typescript-win32-x64-7.0.2.tgz"
}
```
- `parity/research/dep-closure-wave-001/npm/@typescript__typescript-win32-x64@7.0.2/unpacked/package/package.json` sha256=`6d8ec7623880a902bb225c53571112e2bbf0273412b2c534070b1193d2be0f6b` bytes=1042
  - name/version/optionalDependencies|dependencies:
```
{
  "name": "@typescript/typescript-win32-x64",
  "version": "7.0.2",
  "dependencies": null,
  "optionalDependencies": null,
  "os": [
    "win32"
  ],
  "cpu": [
    "x64"
  ]
}
```
