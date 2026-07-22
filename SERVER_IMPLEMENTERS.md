# Server Implementers Guide

This guide is for Fediverse server and frontend maintainers integrating the
Fediverse Miniapp SDK into a trusted host such as Egregoros or Pleroma FE. The
SDK package runs inside the untrusted miniapp iframe. The server frontend owns
the iframe, creates the launch channel, advertises capabilities, presents all
trusted approval UI, and dispatches allowed requests to host adapters.

## Integration boundary

Keep these three layers separate:

1. **Server policy** is loaded by Egregoros, Pleroma, or another host from its
   runtime configuration. It decides whether miniapps and individual
   capabilities are enabled.
2. **Host bridge** runs in the trusted server frontend. It creates a private
   `MessagePort`, bootstraps the miniapp, validates requests, and invokes host
   adapters.
3. **App SDK** runs in the miniapp iframe. It validates the host origin and
   exposes methods such as `getLaunchInfo()`, `composeNote()`, and
   `wallet.sponsoredToken` to miniapp code.

The server does not pass secrets into the app SDK constructor. It passes public
launch metadata over the private port and keeps account access, sessions,
paymaster credentials, and permission management in trusted host code.

## App-side startup

The miniapp must construct the SDK synchronously during entry-module
evaluation so its one-time bootstrap listener is installed before the host
sends the channel:

```js
import {createFediverseMiniAppSDK} from "@fediverse-miniapps/sdk"

export const sdk = createFediverseMiniAppSDK({
  allowedHostOrigin: origin => configuredFediverseHosts.has(origin),
})

const bootstrap = await sdk.connect()
await sdk.ready()
```

`allowedHostOrigin` must make an exact origin decision. Do not accept suffix
matches such as `hostname.endsWith("example.org")` and do not accept arbitrary
origins merely because the page was embedded.

## Host bootstrap

The immediate parent of the miniapp creates a fresh `MessageChannel` for every
launch and transfers one port to the iframe. Never reuse a port, launch ID, or
pending-request table across launches.

```js
const channel = new MessageChannel()
const launchId = crypto.randomUUID()

const bootstrap = {
  type: "fediverse-miniapp:bootstrap",
  version: "1",
  launchId,
  hostOrigin: window.location.origin,
  issuer: window.location.origin,
  authorizationServerMetadata:
    `${window.location.origin}/.well-known/oauth-authorization-server`,
  authorizationResultRelay:
    `${window.location.origin}/mini-apps/oauth/relay`,
  capabilities,
}

miniappFrame.contentWindow.postMessage(bootstrap, miniappOrigin, [channel.port2])
channel.port1.start()
```

The bootstrap object is intentionally exact. Its `hostOrigin` and `issuer`
must equal the origin that sends it. The OAuth metadata and result-relay URLs
must use the documented same-origin paths. The host must send to the exact
miniapp origin rather than `"*"`.

Advertise a capability only when all of these are true:

- the miniapp declared the capability;
- server policy permits it for that miniapp origin;
- the current user and launch are eligible; and
- the host adapter is available.

Omitting a capability is the normative disabled state. For example, when
`wallet.jaw_sponsored_token` is omitted,
`sdk.wallet.sponsoredToken.isAvailable()` resolves to `false` without sending a
host request.

## Server-owned sponsored-wallet policy

Chain, token, paymaster, and call policy belong to the launching server—not to
the miniapp and not to SDK defaults. A practical Elixir configuration is:

```elixir
config :egregoros, :miniapp_sponsored_wallet,
  enabled: true,
  chain_id: "0x2105",
  token_address: "0x1111111111111111111111111111111111111111",
  paymaster_id: "egregoros-fedi-paymaster",
  paymaster_service_url: "https://social.example/api/miniapps/paymaster",
  allowed_calls: [
    %{
      target: "0x2222222222222222222222222222222222222222",
      selectors: ["0x12345678"]
    }
  ]
```

Pleroma can store the same fields under its own application environment. The
names in persistent server configuration do not have to match this example,
but the normalized object passed to the JavaScript adapter must use the SDK
field names shown below.

Treat the configured values in three groups:

- **Server-wide:** enabled state, chain, token, public paymaster identity, and
  browser-facing paymaster proxy.
- **Per-miniapp:** allowed origin, target contracts, selectors, and any lower
  spending policy imposed on that app.
- **Per-user/session:** JAW account, delegated spender, and permission ID.

Validate runtime configuration during server startup. An invalid enabled
configuration should fail startup or disable the capability; it must not fall
back to a different chain, token, or unrestricted wallet.

## Paymaster proxy

`paymasterServiceUrl` is consumed by browser-side JAW code, so it is observable
by the user even though it is not returned to the miniapp iframe. It must not
contain an upstream secret. The recommended value is a same-origin
Egregoros/Pleroma endpoint that authenticates the user, applies rate and policy
limits, adds any upstream credential on the backend, and forwards only valid
ERC-7677 requests.

The public `paymasterId` returned by `getConfiguration()` is an informational,
stable server-defined identifier. It lets miniapps distinguish policies without
revealing the service URL or credentials.

## Creating the JAW host adapter

The optional adapter is imported only by the trusted host frontend:

```js
import {JAW} from "@jaw.id/core"
import {
  createJawSponsoredTokenHostAdapter,
} from "@fediverse-miniapps/sdk/host/jaw-sponsored-token"

const jawObject = JAW.create({
  apiKey: browserSafeJawClientKey,
  defaultChainId: Number.parseInt(serverPolicy.chainId.slice(2), 16),
})

const adapter = createJawSponsoredTokenHostAdapter({
  jawObject,
  enabled: serverPolicy.enabled,
  chainId: serverPolicy.chainId,
  tokenAddress: serverPolicy.tokenAddress,
  paymasterId: serverPolicy.paymasterId,
  paymasterServiceUrl: serverPolicy.paymasterServiceUrl,
  allowedCalls: serverPolicy.allowedCalls,
  permissionId: userPermission.permissionId,
  spenderAddress: userPermission.spenderAddress,
})
```

Do not use `window.ethereum` to construct this adapter. The generic injected
wallet capability and the JAW sponsored-token capability are separate trust
surfaces.

The permission ID must refer to a current JAW permission for the configured
account, delegated spender, chain, token, and exact target/selector set. Obtain
permission approval in trusted host UI. Never expose `wallet_grantPermissions`
or a delegated private key to the miniapp.

## Dispatching sponsored-wallet requests

The miniapp sends these operations over the launch-bound port:

- `get_configuration`
- `get_accounts`
- `connect`
- `personal_sign`
- `call_contract`

The host maps them to the adapter rather than exposing its provider:

```js
const dispatchSponsoredWalletRequest = async message => {
  switch (message.operation) {
    case "get_configuration":
      return adapter.getConfiguration()
    case "get_accounts":
      return adapter.getAccounts()
    case "connect":
      return adapter.connect()
    case "personal_sign":
      return adapter.personalSign(message.signingRequest)
    case "call_contract":
      return adapter.callContract(message.call)
    default:
      throw Object.assign(new Error("Unsupported wallet operation"), {code: 4200})
  }
}
```

Return successful values in a correlated result envelope:

```js
channel.port1.postMessage({
  type: "jawSponsoredTokenWalletResult",
  version: "1",
  launchId,
  requestId: message.requestId,
  result,
})
```

Return failures with an integer EIP-1193-style `code` and a bounded public
message. Do not relay stack traces, upstream bodies, secrets, or arbitrary
exception text.

The dispatcher must independently validate the exact envelope, protocol
version, launch ID, request ID, operation-specific fields, capability state,
and replay state before invoking the adapter. The `userActivation` boolean sent
by a miniapp is only a hint and is not a trust boundary. Privileged actions
must be confirmed or authorized in trusted host UI.

## Disabling the wallet

Use both controls when a server administrator disables the capability:

1. create a fail-closed adapter with `enabled: false`, or do not create it; and
2. omit `wallet.jaw_sponsored_token` from the launch capabilities.

The disabled adapter makes no JAW requests. Miniapps can detect the state with
`isAvailable()` and should continue without wallet functionality.

## Implementation checklist

- Pin the SDK to a release tag or full Git commit and commit the lockfile.
- Require HTTPS and exact origins for hosts and miniapps.
- Create one channel and unpredictable launch ID per launch.
- Apply global and per-origin capability policy before bootstrapping.
- Keep upstream paymaster and JAW secrets on the backend.
- Use a same-origin, authenticated, rate-limited paymaster proxy.
- Use a dedicated low-value smart account with no ETH or unrelated assets.
- Grant only the configured token spend and exact contract selectors.
- Force native value to zero and use JAW delegated `wallet_sendCalls`.
- Treat `personalSign` as separately sensitive and show trusted confirmation.
- Fail closed on malformed configuration, responses, permission drift, and
  capability mismatches.
- Test enabled, disabled, denied, expired-permission, wrong-chain, wrong-token,
  wrong-selector, replay, timeout, and malformed-message paths.

