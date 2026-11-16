# Contributing

Thanks for helping. Bug reports, ideas, docs fixes and code are all welcome.

## Set up

You need Node 22.17 or newer (`.nvmrc` has the version we use) and a 4Shadow API key for the map lab ([free at 4shadow.io](https://4shadow.io/signup)).

```sh
git clone git@github.com:similie/4Shadow-js.git
cd 4Shadow-js
npm install
cp apps/map-lab/.env.example apps/map-lab/.env.local   # then set FORESHADOW_API_KEY
npm run lab                                             # http://localhost:5181
```

## Scripts

| Command               | What it does                                                        |
| --------------------- | ------------------------------------------------------------------- |
| `npm run check`       | Everything CI checks: formatting, types, tests. Run it before a PR. |
| `npm test`            | Unit tests of every workspace (vitest).                             |
| `npm run typecheck`   | TypeScript and Svelte checks.                                       |
| `npm run format`      | Formats the code with Prettier.                                     |
| `npm run build`       | Builds the SDK into `packages/sdk/dist`.                            |
| `npm run build:lab`   | Builds the SDK and the map lab's Node server.                       |
| `npm run lab`         | The map lab with live reload.                                       |
| `npm run screenshots` | Retakes the README's screenshots from a running lab (needs Chrome). |

The SDK's tests run against a fake server. To also run them against a real one: `FORESHADOW_TEST_URL=https://api.4shadow.io npm test -w packages/sdk` (with `FORESHADOW_API_KEY` set).

## Making a change

- **Open an issue first** for anything bigger than a fix, so we can agree on the approach before you spend time on it.
- **Keep the SDK dependency-free.** It runs in Node, browsers, Deno and Bun.
- **Map code goes in `apps/map-lab/src/lib/weather/`** and stays free of Svelte, so it can become a package.
- **Add a test** for new behaviour. Map rendering is hard to unit-test; for that, describe what you checked and add a screenshot.
- **Write for people.** Comments, docs and messages in plain words, saying what something does and why.
- **Update `CHANGELOG.md`** under "Unreleased" when users would notice the change.
- **Never commit a key, a webhook secret or an `.env` file.**

CI runs formatting, types, tests on Node 22, 24 and 26, both builds, and the Docker image. A PR needs it green and one maintainer's review.

## Releasing the SDK

Releases are automatic: when `main` gets a version of `@similie/4shadow` that npm doesn't have, the [Release SDK](.github/workflows/release.yml) workflow publishes it (with provenance), tags the commit `sdk-vX.Y.Z` and makes a GitHub release from the changelog.

1. In a pull request, bump the version: `npm version patch -w packages/sdk --no-git-tag-version` (or `minor`, `major`).
2. In `packages/sdk/CHANGELOG.md`, move the "Unreleased" notes under a heading for the new version, such as `## 0.1.1`.
3. Merge. The workflow does the rest; watch it in the Actions tab.

Only maintainers can release: npm accepts publishes for this package only from that workflow on this repository ([trusted publishing](https://docs.npmjs.com/trusted-publishers)), so there is no npm token to leak.

## License

By contributing, you agree that your contribution is released under the [MIT License](LICENSE).
