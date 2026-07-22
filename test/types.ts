import {
  createFediverseMiniAppSDK,
  type EvmAddress,
  type Hex,
  type MiniAppComposePublishedReceipt,
  type MiniAppNotificationPermission,
} from "../index.d.ts"
import {createJawSponsoredTokenHostAdapter} from "../host/jaw_sponsored_token_adapter.d.ts"

const sdk = createFediverseMiniAppSDK({allowedHostOrigin: origin => origin === "https://social.example"})
const bootstrap = await sdk.connect()
const issuer: string = bootstrap.issuer
const launchInfo = await sdk.getLaunchInfo()
const sharedFrom: string = launchInfo.sourceNoteId
const context = await sdk.getContext()
const noteId: string = context.note.id
const provider = sdk.wallet.getProvider()
const chainId: Hex = await provider.request({method: "eth_chainId", params: []})
const accounts: EvmAddress[] = await provider.request({method: "eth_requestAccounts", params: []})
const signature: Hex = await provider.request({
  method: "personal_sign",
  params: ["0x68656c6c6f", accounts[0]],
})
const transactionHash: Hex = await provider.request({
  method: "eth_sendTransaction",
  params: [{
    from: accounts[0],
    to: "0x2222222222222222222222222222222222222222",
    type: "0x2",
    accessList: [{
      address: "0x2222222222222222222222222222222222222222",
      storageKeys: ["0x0000000000000000000000000000000000000000000000000000000000000000"],
    }],
  }],
})
const sponsoredTokenConfiguration = await sdk.wallet.sponsoredToken.getConfiguration()
const sponsoredTokenAvailable: boolean = await sdk.wallet.sponsoredToken.isAvailable()
const sponsoredTokenAddress: EvmAddress = sponsoredTokenConfiguration.tokenAddress
const sponsoredPaymasterId: string = sponsoredTokenConfiguration.paymaster.id
const sponsoredContractHash: Hex = await sdk.wallet.sponsoredToken.callContract({
  from: accounts[0],
  to: sponsoredTokenConfiguration.allowedCalls[0].target,
  data: "0xa9059cbb",
})
const sponsoredSignature: Hex = await sdk.wallet.sponsoredToken.personalSign({
  message: "0x68656c6c6f",
  account: accounts[0],
})
const hostAdapter = createJawSponsoredTokenHostAdapter({
  jawObject: {
    provider: {
      request: async () => "0x2105",
    },
  },
  enabled: true,
  chainId: "0x2105",
  tokenAddress: "0x1111111111111111111111111111111111111111",
  permissionId: "0x1111111111111111111111111111111111111111111111111111111111111111",
  spenderAddress: "0x2222222222222222222222222222222222222222",
  paymasterId: "example-server-paymaster",
  paymasterServiceUrl: "https://paymaster.example/rpc",
  allowedCalls: [{
    target: "0x1111111111111111111111111111111111111111",
    selectors: ["0xa9059cbb"],
  }],
})
const hostWalletAvailable: boolean = hostAdapter.available()
const notificationPermission: MiniAppNotificationPermission =
  await sdk.notifications.getPermission()
const requestedNotificationPermission: MiniAppNotificationPermission =
  await sdk.notifications.requestPermission()
const browserAuthorization = await sdk.requestAuth({
  completionMode: "browser_code",
  clientId: "browser-client",
  redirectUri: "https://app.example/oauth/callback",
  scopes: ["identify"],
  state: "sssssssssssssssssssssssssssssssssssssssssss",
  codeChallenge: "ccccccccccccccccccccccccccccccccccccccccccc",
})
const authorizationCode: string = browserAuthorization.authorizationCode
const composeResult = await sdk.composeNote({text: "Share this result"})
if (composeResult.status === "accepted") {
  const composeRequestId: string = composeResult.requestId
  void composeRequestId
}

sdk.on("composeNotePublished", (receipt: MiniAppComposePublishedReceipt) => {
  const publishedId: string = receipt.id
  void publishedId
})

void issuer
void sharedFrom
void noteId
void chainId
void signature
void transactionHash
void sponsoredTokenAddress
void sponsoredTokenAvailable
void sponsoredPaymasterId
void sponsoredContractHash
void sponsoredSignature
void hostWalletAvailable
void notificationPermission
void requestedNotificationPermission
void authorizationCode
