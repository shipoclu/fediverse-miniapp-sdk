import {
  normalizeEvmAddress,
  normalizeEvmQuantity,
  normalizeEvmWalletErrorCode,
  normalizeJawSponsoredTokenCall,
  normalizeJawSponsoredTokenConfiguration,
  normalizeJawSponsoredTokenPermissionId,
  normalizeJawSponsoredTokenPermissions,
  normalizeJawSponsoredTokenResult,
  normalizeJawSponsoredTokenSendCallsResult,
  normalizeJawSponsoredTokenSigningRequest,
} from "../wallet/evm_wallet_schema.js"

const adapterError = (code, message) => Object.assign(new Error(message), {code})

const disabledAdapter = () => {
  const unavailable = () => Promise.reject(adapterError(4200, "Sponsored-token wallet disabled"))
  return Object.freeze({
    kind: "jaw-sponsored-token",
    capability: "wallet.jaw_sponsored_token",
    available: () => false,
    getConfiguration: unavailable,
    getAccounts: unavailable,
    connect: unavailable,
    personalSign: unavailable,
    callContract: unavailable,
  })
}

const validJawProvider = jawObject =>
  !!jawObject &&
  typeof jawObject === "object" &&
  !!jawObject.provider &&
  typeof jawObject.provider === "object" &&
  typeof jawObject.provider.request === "function"

const normalizePaymasterServiceUrl = value => {
  try {
    if (typeof value !== "string") throw new TypeError()
    const url = new URL(value)
    const localHttp =
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    if ((url.protocol !== "https:" && !localHttp) || url.hash) throw new TypeError()
    return url.toString()
  } catch (_error) {
    throw new TypeError("Invalid JAW paymaster service URL")
  }
}

export const createJawSponsoredTokenHostAdapter = ({
  jawObject,
  enabled = false,
  chainId,
  tokenAddress,
  permissionId,
  spenderAddress,
  paymasterId,
  paymasterServiceUrl,
  allowedCalls,
} = {}) => {
  if (typeof enabled !== "boolean") throw new TypeError("Invalid JAW adapter enabled state")
  if (!enabled) return disabledAdapter()
  if (!validJawProvider(jawObject)) throw new TypeError("Invalid JAW provider")

  let configuration
  try {
    configuration = normalizeJawSponsoredTokenConfiguration({
      provider: "jaw",
      chainId,
      tokenAddress,
      paymaster: {standard: "erc7677", id: paymasterId},
      allowedCalls,
    })
    permissionId = normalizeJawSponsoredTokenPermissionId(permissionId)
    spenderAddress = normalizeEvmAddress(spenderAddress)
    paymasterServiceUrl = normalizePaymasterServiceUrl(paymasterServiceUrl)
  } catch (_error) {
    throw new TypeError("Invalid JAW sponsored-token configuration")
  }

  const provider = jawObject.provider
  const providerRequest = async (payload, operation) => {
    try {
      const result = await provider.request(payload)
      return normalizeJawSponsoredTokenResult(operation, result)
    } catch (error) {
      if (error instanceof TypeError && error.message === "Invalid wallet parameters") {
        throw adapterError(-32603, "Invalid JAW wallet response")
      }
      throw adapterError(normalizeEvmWalletErrorCode(error?.code), "JAW wallet request failed")
    }
  }

  const requireConfiguredChain = async () => {
    let current
    try {
      current = normalizeEvmQuantity(
        await provider.request({method: "eth_chainId", params: []}),
        256
      )
    } catch (error) {
      throw adapterError(normalizeEvmWalletErrorCode(error?.code), "JAW chain unavailable")
    }
    if (current !== configuration.chainId) {
      throw adapterError(4901, "JAW wallet is connected to the wrong chain")
    }
  }

  const getAccounts = async () => {
    await requireConfiguredChain()
    return providerRequest({method: "eth_accounts", params: []}, "get_accounts")
  }

  const requireAccount = async account => {
    const accounts = await getAccounts()
    if (!accounts.includes(account)) throw adapterError(4100, "JAW account is not connected")
  }

  const requireScopedPermission = async account => {
    let permissions
    try {
      permissions = normalizeJawSponsoredTokenPermissions(
        await provider.request({
          method: "wallet_getPermissions",
          params: [{address: account}],
        })
      )
    } catch (error) {
      if (error instanceof TypeError && error.message === "Invalid wallet parameters") {
        throw adapterError(-32603, "Invalid JAW permission response")
      }
      throw adapterError(normalizeEvmWalletErrorCode(error?.code), "JAW permission unavailable")
    }

    const permission = permissions.find(candidate => candidate.permissionId === permissionId)
    const now = Math.floor(Date.now() / 1000)
    const expectedCalls = new Set(
      configuration.allowedCalls.flatMap(({target, selectors}) =>
        selectors.map(selector => `${target}:${selector}`)
      )
    )
    const actualCalls = new Set(
      permission?.calls.map(({target, selector}) => `${target}:${selector}`) ?? []
    )
    const callsMatch =
      permission?.calls.length === expectedCalls.size &&
      actualCalls.size === expectedCalls.size &&
      [...expectedCalls].every(call => actualCalls.has(call))
    const tokenSpend = permission?.spends.length === 1 ? permission.spends[0] : null
    if (
      !permission ||
      permission.account !== account ||
      permission.spender !== spenderAddress ||
      permission.chainId !== configuration.chainId ||
      permission.start > now ||
      permission.end <= now ||
      !callsMatch ||
      tokenSpend?.token !== configuration.tokenAddress ||
      BigInt(tokenSpend.allowance) < 1n
    ) {
      throw adapterError(4100, "JAW permission does not match the sponsored-token policy")
    }
  }

  return Object.freeze({
    kind: "jaw-sponsored-token",
    capability: "wallet.jaw_sponsored_token",
    available: () => true,
    getConfiguration: async () => configuration,
    getAccounts,
    connect: async () => {
      await requireConfiguredChain()
      return providerRequest({method: "eth_requestAccounts", params: []}, "connect")
    },
    personalSign: async request => {
      let normalized
      try {
        normalized = normalizeJawSponsoredTokenSigningRequest(request)
      } catch (_error) {
        throw adapterError(-32602, "Invalid sponsored-token signing request")
      }
      await requireAccount(normalized.account)
      return providerRequest(
        {
          method: "personal_sign",
          params: [normalized.message, normalized.account],
        },
        "personal_sign"
      )
    },
    callContract: async call => {
      let normalized
      try {
        normalized = normalizeJawSponsoredTokenCall(call)
      } catch (_error) {
        throw adapterError(-32602, "Invalid sponsored-token contract call")
      }
      const allowedCall = configuration.allowedCalls.find(({target}) => target === normalized.to)
      const selector = normalized.data.slice(0, 10)
      if (!allowedCall?.selectors.includes(selector)) {
        throw adapterError(4100, "Contract call is not enabled for this sponsored-token wallet")
      }
      await requireAccount(normalized.from)
      await requireScopedPermission(normalized.from)
      try {
        const result = await provider.request({
          method: "wallet_sendCalls",
          params: [{
            version: "1.0",
            chainId: configuration.chainId,
            from: normalized.from,
            calls: [{
              to: normalized.to,
              data: normalized.data,
              value: "0x0",
            }],
            capabilities: {
              permissions: {id: permissionId},
              paymasterService: {url: paymasterServiceUrl},
            },
          }],
        })
        return normalizeJawSponsoredTokenSendCallsResult(result)
      } catch (error) {
        if (error instanceof TypeError && error.message === "Invalid wallet parameters") {
          throw adapterError(-32603, "Invalid JAW wallet response")
        }
        throw adapterError(normalizeEvmWalletErrorCode(error?.code), "JAW wallet request failed")
      }
    },
  })
}
