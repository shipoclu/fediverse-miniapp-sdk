# Fediverse Miniapp SDK

The app-side JavaScript SDK for the version 1 Fediverse miniapp protocol. It
runs inside a miniapp iframe and communicates with a compatible host over an
origin-pinned, launch-bound `MessagePort`.

This package intentionally contains raw ES modules and matching handwritten
TypeScript declarations. It has no runtime dependencies and no build or
`prepare` step. The package version is independent of the wire-protocol version;
the current `0.1.x` package speaks protocol `"1"`.

## Install from Git over SSH

After this directory has its own Git repository, install a pinned commit or tag
from the repository's eventual SSH URL:

```sh
npm install 'git+ssh://git@GIT_HOST/NAMESPACE/fediverse-miniapp-sdk.git#COMMIT_OR_TAG'
```

For a reproducible application, commit the resulting lockfile and use a release
tag or full commit hash rather than a moving branch.

The corresponding `package.json` dependency will resemble:

```json
{
  "dependencies": {
    "@fediverse-miniapps/sdk": "git+ssh://git@GIT_HOST/NAMESPACE/fediverse-miniapp-sdk.git#COMMIT_OR_TAG"
  }
}
```

The package is marked `private` to prevent accidental publication to the npm
registry. That setting does not prevent installation from Git.

## Use

```js
import {createFediverseMiniAppSDK} from "@fediverse-miniapps/sdk"

const sdk = createFediverseMiniAppSDK({
  allowedHostOrigin: origin => acceptsPublicFediverseOrigin(origin),
})

const bootstrap = await sdk.connect()
await sdk.ready()

const launchInfo = await sdk.getLaunchInfo()
```

The SDK installs its one-time bootstrap listener when
`createFediverseMiniAppSDK` runs. Create it synchronously during the entry
module's initial evaluation, before rendering a framework or awaiting a lazy
import.

TypeScript resolves `index.d.ts` through the package export automatically:

```ts
import {
  createFediverseMiniAppSDK,
  type MiniAppLaunchInfo,
} from "@fediverse-miniapps/sdk"

const sdk = createFediverseMiniAppSDK({
  allowedHostOrigin: origin => acceptsPublicFediverseOrigin(origin),
})

const launchInfo: MiniAppLaunchInfo = await sdk.getLaunchInfo()
```

## Serve without bundling

The raw entry module imports `./wallet/evm_wallet_schema.js`. A static miniapp
can copy or expose the complete installed package directory at one fixed URL;
do not copy `index.js` by itself and do not expose all of `node_modules`.

For example, a deployment step may copy only this package:

```sh
mkdir -p public/vendor/fediverse-miniapp-sdk
cp node_modules/@fediverse-miniapps/sdk/index.js \
  node_modules/@fediverse-miniapps/sdk/index.d.ts \
  public/vendor/fediverse-miniapp-sdk/
cp -R node_modules/@fediverse-miniapps/sdk/wallet \
  public/vendor/fediverse-miniapp-sdk/wallet
```

The browser can then import:

```js
import {createFediverseMiniAppSDK} from "/vendor/fediverse-miniapp-sdk/index.js"
```

Serve `.js` with a JavaScript MIME type from the miniapp's exact HTTPS origin.
Keep `index.js`, `index.d.ts`, and `wallet/` pinned to the same Git revision.

## Security boundary

This package is the untrusted iframe application's side of the protocol. It:

- accepts bootstrap only from the exact parent window and an app-approved,
  canonical host origin;
- pins the transferred private channel, host origin, protocol version, and
  random launch ID for the SDK lifetime;
- correlates bounded requests and responses and rejects unknown or malformed
  results;
- normalizes the allowlisted EIP-1193 wallet surface before crossing the host
  boundary; and
- never receives wallet private keys, OAuth refresh tokens, or host sessions.

The host broker, iframe sandbox, OAuth server, compose UI, permission checks,
injected-wallet execution, and ActivityPub implementation deliberately remain
outside this package. A miniapp must still treat all launch and note context as
untrusted input. `allowedHostOrigin` must make a real decision; the SDK has no
accept-any-host default.

## Development

Run the raw-module protocol tests:

```sh
npm test
```

Check the public TypeScript declarations when Deno is available:

```sh
npm run typecheck
```

Run both:

```sh
npm run check
```

There is intentionally no build command. Changes to `index.js` and
`index.d.ts` are one atomic SDK change and must be tested together.

## License

Licensed under the [MIT License](./LICENSE).
