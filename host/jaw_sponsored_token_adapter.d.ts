import type {
  EvmAddress,
  Hex,
  JawSponsoredTokenAllowedCall,
  JawSponsoredTokenContractCall,
  JawSponsoredTokenSigningRequest,
  JawSponsoredTokenWalletConfiguration,
} from "../index.d.ts"

export interface JawEip1193Provider {
  request(request: {readonly method: string; readonly params?: readonly unknown[]}): Promise<unknown>
}

export interface JawSdkObject {
  readonly provider: JawEip1193Provider
}

export interface CreateJawSponsoredTokenHostAdapterOptions {
  readonly jawObject?: JawSdkObject
  readonly enabled?: boolean
  readonly chainId?: Hex
  readonly tokenAddress?: EvmAddress
  readonly permissionId?: Hex
  readonly spenderAddress?: EvmAddress
  /** Public identifier exposed to miniapps; it must not contain credentials. */
  readonly paymasterId?: string
  /** Host-only ERC-7677 service URL used for sponsored calls. */
  readonly paymasterServiceUrl?: string
  readonly allowedCalls?: readonly JawSponsoredTokenAllowedCall[]
}

export interface JawSponsoredTokenHostAdapter {
  readonly kind: "jaw-sponsored-token"
  readonly capability: "wallet.jaw_sponsored_token"
  available(): boolean
  getConfiguration(): Promise<JawSponsoredTokenWalletConfiguration>
  getAccounts(): Promise<EvmAddress[]>
  connect(): Promise<EvmAddress[]>
  personalSign(request: JawSponsoredTokenSigningRequest): Promise<Hex>
  callContract(call: JawSponsoredTokenContractCall): Promise<Hex>
}

export declare const createJawSponsoredTokenHostAdapter: (
  options?: CreateJawSponsoredTokenHostAdapterOptions
) => JawSponsoredTokenHostAdapter
