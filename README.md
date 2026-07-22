# Fediverse Miniapp SDK

The app-side JavaScript SDK for the version 1 Fediverse miniapp protocol. It
runs inside a miniapp iframe and communicates with a compatible host over an
origin-pinned, launch-bound `MessagePort`.

This package intentionally contains raw ES modules and matching handwritten
TypeScript declarations. It has no runtime dependencies and no build or
`prepare` step. The package version is independent of the wire-protocol version;
the current `0.1.x` package speaks protocol `"1"`.

Fediverse server and frontend maintainers should start with the
[Server Implementers Guide](./SERVER_IMPLEMENTERS.md), which covers host
bootstrap, capability policy, request dispatch, and sponsored-wallet setup.
The [normative protocol specification](./docs/MINIAPPS.md) and
[miniapp developer tutorial](./docs/MINIAPP_IMPLEMENTER_GUIDE.md) are maintained
alongside the SDK.

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

## JAW sponsored-token wallet

This branch adds an experimental, host-mediated JAW wallet capability for a
separate low-value smart account. A compatible host advertises
`wallet.jaw_sponsored_token`; when it does not, every sponsored-token method
fails with `CAPABILITY_UNAVAILABLE`.

The miniapp uses the SDK object rather than `window.ethereum`:

```js
if (!(await sdk.wallet.sponsoredToken.isAvailable())) {
  showSponsoredWalletDisabledMessage()
  return
}

const configuration = await sdk.wallet.sponsoredToken.getConfiguration()
const [account] = await sdk.wallet.sponsoredToken.connect()

console.log(configuration.chainId)
console.log(configuration.tokenAddress)
console.log(configuration.paymaster.id)

const callId = await sdk.wallet.sponsoredToken.callContract({
  from: account,
  to: configuration.allowedCalls[0].target,
  data: "0xa9059cbb...",
})

const signature = await sdk.wallet.sponsoredToken.personalSign({
  account,
  message: "0x68656c6c6f",
})
```

`isAvailable()` is always callable after SDK connection, including when the
host has disabled or does not support the capability. It reads the immutable
bootstrap capability set locally and does not prompt, contact JAW, or send a
wallet request to the host. Other sponsored-token methods remain capability
gated and fail with `CAPABILITY_UNAVAILABLE` when it returns `false`.

`getConfiguration()` is launch-host specific. It reports that server's chain,
token address, public paymaster identity, and allowed contract selectors; the
SDK has no default network, token, or paymaster policy that overrides these
values. A miniapp must query them for each launch rather than assume that two
Fediverse servers use the same configuration.

`callContract` returns JAW's batch call ID, not an Ethereum transaction hash.
There is deliberately no raw provider or generic transaction method on
`sponsoredToken`. Contract calls require `from`, `to`, and at least a four-byte
function selector in `data`. They cannot contain `value`, gas fields, access
lists, contract creation, typed-data signing, or arbitrary wallet RPC.
Connection, signing, and contract calls also require current browser user
activation.

### Host integration

The optional host adapter wraps a JAW SDK object without reading an injected
Ethereum provider:

```js
import {JAW} from "@jaw.id/core"
import {
  createJawSponsoredTokenHostAdapter,
} from "@fediverse-miniapps/sdk/host/jaw-sponsored-token"

const jawObject = JAW.create({
  apiKey: serverConfiguration.jawApiKey,
  defaultChainId: 8453,
})

const adapter = createJawSponsoredTokenHostAdapter({
  jawObject,
  enabled: serverConfiguration.jawSponsoredTokenWalletEnabled,
  chainId: "0x2105",
  tokenAddress: "0x1111111111111111111111111111111111111111",
  permissionId: userJawPermission.permissionId,
  spenderAddress: sessionSpenderAddress,
  paymasterId: serverConfiguration.publicPaymasterId,
  paymasterServiceUrl: serverConfiguration.privatePaymasterServiceUrl,
  allowedCalls: [
    {
      target: "0x1111111111111111111111111111111111111111",
      selectors: ["0xa9059cbb"],
    },
    {
      target: "0x2222222222222222222222222222222222222222",
      selectors: ["0x12345678"],
    },
  ],
})

const capabilities = adapter.available() ? [adapter.capability] : []
```

Setting `enabled: false` produces a fail-closed adapter that makes no JAW
provider requests. A server administrator disables the feature by doing that
and omitting `wallet.jaw_sponsored_token` from the bootstrap capabilities.
Disabling either side is sufficient; production hosts should do both.

The adapter supplies the browser-hosted ERC-7677 `paymasterServiceUrl` to JAW
for every contract call. Only `paymasterId` is returned to the miniapp; it is a
public server-defined identifier and must not contain credentials. Because a
browser-visible service URL cannot safely contain a secret, use a same-origin
server proxy that adds upstream credentials on the backend. This SDK does not
silently fall back to an injected wallet and does not fund gas itself. The host
must dispatch only the five documented operations:
`get_configuration`, `get_accounts`, `connect`, `personal_sign`, and
`call_contract`.

Before constructing an enabled adapter, trusted host UI must obtain a JAW
permission with `wallet_grantPermissions` and retain its `permissionId` for the
connected account. The grant must contain exactly the configured target and
selector pairs and exactly one positive spend limit whose `token` is the
configured token. It must not include JAW's native-token sentinel. Permission
approval belongs in host-owned UI and is never exposed as a miniapp operation.

For example, the relevant part of the user-approved grant is:

```js
const userJawPermission = await jawObject.provider.request({
  method: "wallet_grantPermissions",
  params: [{
    address: connectedAccount,
    chainId: "0x2105",
    expiry: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    spender: sessionSpenderAddress,
    permissions: {
      calls: [
        {
          target: "0x1111111111111111111111111111111111111111",
          selector: "0xa9059cbb",
        },
        {
          target: "0x2222222222222222222222222222222222222222",
          selector: "0x12345678",
        },
      ],
      spends: [{
        token: "0x1111111111111111111111111111111111111111",
        allowance: "1000000",
        unit: "day",
        multiplier: 1,
      }],
    },
  }],
})
```

Use the JAW-supported session/delegated spender for `sessionSpenderAddress`;
never place a private spender key in miniapp code. On every contract call, the
adapter reads the permission back with `wallet_getPermissions` and fails closed
unless its account, delegated spender, chain, active lifetime, complete
call-selector set, and sole spend token match the server configuration. It then
invokes `wallet_sendCalls` with that permission ID and an explicit native value
of `0x0`. JAW's on-chain permission manager remains the authoritative
enforcement layer.

See JAW's [`wallet_grantPermissions`](https://docs.jaw.id/api-reference/wallet_grantPermissions)
and [`wallet_sendCalls`](https://docs.jaw.id/api-reference/wallet_sendCalls)
documentation for the underlying permission and delegated-call formats.

The configured token address does not prove that an allowed game contract has
only token-related side effects. Keep the permission allowance low, constrain
every selector, constrain the paymaster independently, and use a dedicated
low-value smart account that never holds ETH or unrelated assets. `personalSign`
is not constrained by JAW's token-spend permission, so the SDK limits it to the
connected dedicated account and requires user activation, but the host should
still show a trusted signing confirmation.

For a complete host lifecycle and configuration example, see the
[Server Implementers Guide](./SERVER_IMPLEMENTERS.md).

`composeNote` does not require OAuth. It asks the host to open an editable,
host-owned composer and resolves when that request is accepted or rejected;
only the user can submit the post from trusted host UI. The miniapp manifest
must still declare `compose_note`, and the host may deny the capability under
its current app or domain policy.

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
