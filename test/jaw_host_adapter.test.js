import assert from "node:assert/strict"
import test from "node:test"

import {createJawSponsoredTokenHostAdapter} from "../host/jaw_sponsored_token_adapter.js"

const tokenAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const gameContract = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
const account = "0xcccccccccccccccccccccccccccccccccccccccc"
const spenderAddress = "0xdddddddddddddddddddddddddddddddddddddddd"
const permissionId = "0x" + "11".repeat(32)
const transferSelector = "0xa9059cbb"
const playSelector = "0x12345678"
const paymasterId = "example-server-paymaster"
const paymasterServiceUrl = "https://paymaster.example/rpc"

const fixture = ({enabled = true, permissionToken = tokenAddress} = {}) => {
  const requests = []
  const provider = {
    request: async request => {
      requests.push(request)
      if (request.method === "eth_chainId") return "0x2105"
      if (request.method === "eth_accounts") return [account]
      if (request.method === "eth_requestAccounts") return [account]
      if (request.method === "personal_sign") return "0x" + "12".repeat(65)
      if (request.method === "wallet_getPermissions") {
        return [{
          permissionId,
          account,
          spender: spenderAddress,
          start: 1,
          end: 4_102_444_800,
          salt: "0x01",
          calls: [
            {target: tokenAddress, selector: transferSelector},
            {target: gameContract, selector: playSelector},
          ],
          spends: [{
            token: permissionToken,
            allowance: "1000000",
            unit: "day",
            multiplier: 1,
          }],
          chainId: "0x2105",
        }]
      }
      if (request.method === "wallet_sendCalls") return {id: "0x1234"}
      throw Object.assign(new Error("unsupported"), {code: 4200})
    },
  }
  const adapter = createJawSponsoredTokenHostAdapter({
    jawObject: {provider},
    enabled,
    chainId: "0x2105",
    tokenAddress,
    permissionId,
    spenderAddress,
    paymasterId,
    paymasterServiceUrl,
    allowedCalls: [
      {target: tokenAddress, selectors: [transferSelector]},
      {target: gameContract, selectors: [playSelector]},
    ],
  })
  return {adapter, requests}
}

test("executes only permission-bound zero-value calls through the supplied JAW provider", async () => {
  const {adapter, requests} = fixture()

  const result = await adapter.callContract({
    from: account,
    to: gameContract,
    data: playSelector + "00".repeat(32),
  })

  assert.equal(result, "0x1234")
  assert.deepEqual(await adapter.getConfiguration(), {
    provider: "jaw",
    chainId: "0x2105",
    tokenAddress,
    paymaster: {standard: "erc7677", id: paymasterId},
    allowedCalls: [
      {target: tokenAddress, selectors: [transferSelector]},
      {target: gameContract, selectors: [playSelector]},
    ],
  })
  assert.deepEqual(requests.at(-1), {
    method: "wallet_sendCalls",
    params: [{
      version: "1.0",
      chainId: "0x2105",
      from: account,
      calls: [{
        to: gameContract,
        data: playSelector + "00".repeat(32),
        value: "0x0",
      }],
      capabilities: {
        permissions: {id: permissionId},
        paymasterService: {url: paymasterServiceUrl},
      },
    }],
  })
})

test("rejects calls outside the configured contract, selector, and account boundaries", async () => {
  const {adapter, requests} = fixture()

  await assert.rejects(
    adapter.callContract({
      from: account,
      to: "0xdddddddddddddddddddddddddddddddddddddddd",
      data: playSelector,
    }),
    error => error.code === 4100
  )
  await assert.rejects(
    adapter.callContract({
      from: account,
      to: gameContract,
      data: "0x87654321",
    }),
    error => error.code === 4100
  )
  await assert.rejects(
    adapter.callContract({
      from: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      to: gameContract,
      data: playSelector,
    }),
    error => error.code === 4100
  )
  assert.equal(requests.some(request => request.method === "wallet_sendCalls"), false)
})

test("rejects enabled adapters without a JAW permission identifier", () => {
  assert.throws(
    () => createJawSponsoredTokenHostAdapter({
      jawObject: {provider: {request: async () => []}},
      enabled: true,
      chainId: "0x2105",
      tokenAddress,
      paymasterId,
      paymasterServiceUrl,
      allowedCalls: [{target: tokenAddress, selectors: [transferSelector]}],
    }),
    /Invalid JAW sponsored-token configuration/
  )
})

test("fails closed when the JAW permission can spend a different token", async () => {
  const {adapter, requests} = fixture({
    permissionToken: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  })

  await assert.rejects(
    adapter.callContract({from: account, to: gameContract, data: playSelector}),
    error => error.code === 4100
  )
  assert.equal(requests.some(request => request.method === "wallet_sendCalls"), false)
})

test("supports the scoped account and personal-sign operations", async () => {
  const {adapter, requests} = fixture()

  assert.deepEqual(await adapter.getAccounts(), [account])
  assert.deepEqual(await adapter.connect(), [account])
  assert.equal(
    await adapter.personalSign({message: "0x68656c6c6f", account}),
    "0x" + "12".repeat(65)
  )
  assert.deepEqual(requests.at(-1), {
    method: "personal_sign",
    params: ["0x68656c6c6f", account],
  })
})

test("fails closed when a server administrator disables the adapter", async () => {
  const {adapter, requests} = fixture({enabled: false})

  assert.equal(adapter.available(), false)
  await assert.rejects(adapter.getConfiguration(), error => error.code === 4200)
  await assert.rejects(adapter.connect(), error => error.code === 4200)
  await assert.rejects(
    adapter.personalSign({message: "0x00", account}),
    error => error.code === 4200
  )
  assert.deepEqual(requests, [])
})
