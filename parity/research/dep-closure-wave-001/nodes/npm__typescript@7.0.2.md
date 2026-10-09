# npm:typescript@7.0.2

Previously incomplete: True

## Disposition

Lock optionalDependencies enumerated against registry/package.json. Tarball retrieved and package.json hashed. Full distribution tree not read; readingComplete stays false.

proposeReadingComplete: False
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
- `parity/research/dep-closure-wave-001/npm/typescript@7.0.2/registry.json` sha256=`28a8ef314c6bbc3fddb831088f80eb2fcac6351cb618c8ac029f7229f587b8aa` bytes=4833
  - dist.integrity + name/version:
```
{
  "name": "typescript",
  "version": "7.0.2",
  "integrity": "sha512-8FYau96o3NKOhbjKi/qNvG/W5jhzxkbdm5sj9AbZ/5T5sWqn3hJgLfGx27sRKZWTvyzCP8dLRBTf5tBTSRVUNA==",
  "tarball": "https://registry.npmjs.org/typescript/-/typescript-7.0.2.tgz"
}
```
- `parity/research/dep-closure-wave-001/npm/typescript@7.0.2/package.json` sha256=`3722b30210616a13a3213ded11575ba6b2dbab10c32a5ef67afca8513e27017e` bytes=3087
  - name/version/optionalDependencies|dependencies:
```
{
  "name": "typescript",
  "version": "7.0.2",
  "dependencies": null,
  "optionalDependencies": {
    "@typescript/typescript-win32-x64": "7.0.2",
    "@typescript/typescript-win32-arm64": "7.0.2",
    "@typescript/typescript-linux-x64": "7.0.2",
    "@typescript/typescript-linux-arm": "7.0.2",
    "@typescript/typescript-linux-arm64": "7.0.2",
    "@typescript/typescript-darwin-x64": "7.0.2",
    "@typescript/typescript-darwin-arm64": "7.0.2",
    "@typescript/typescript-aix-ppc64": "7.0.2",
    "@typescript/typescript-freebsd-arm64": "7.0.2",
    "@typescript/typescript-freebsd-x64": "7.0.2",
    "@typescript/typescript-linux-loong64": "7.0.2",
    "@typescript/typescript-linux-mips64el": "7.0.2",
    "@typescript/typescript-linux-ppc64": "7.0.2",
    "@typescript/typescript-linux-riscv64": "7.0.2",
    "@typescript/typescript-linux-s390x": "7.0.2",
    "@typescript/typescript-netbsd-arm64": "7.0.2",
    "@typescript/typescript-netbsd-x64": "7.0.2",
    "@typescript/typescript-openbsd-arm64": "7.0.2",
    "@typescript/typescript-openbsd-x64": "7.0.2",
    "@typescript/typescript-sunos-x64": "7.0.2"
  },
  "os": null,
  "cpu": null
}
```
