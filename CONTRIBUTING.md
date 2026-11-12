# Contributing

Install Node 22 and pnpm 10. The `.nvmrc` file pins the Node version.

```bash
pnpm install
pnpm test
pnpm lint
pnpm build
pnpm examples
```

`pnpm test` runs the unit tests. Redis tests use `REDIS_URL` when it is set, and otherwise `redis://127.0.0.1:6379`. If `REDIS_URL` is set and Redis does not answer, those tests fail. If it is unset and nothing is listening, those tests are skipped. Unkey tests mock HTTP and do not need a root key.

Add a changeset when you change a package that would be published. This repo does not publish to npm.

```bash
pnpm exec changeset
```

Run `pnpm format` before you commit if Biome reports a formatting diff.
