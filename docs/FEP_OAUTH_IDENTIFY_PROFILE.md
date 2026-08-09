# Draft FEP: OAuth `identify` and `profile` scopes for Fediverse applications

## Status

Draft proposal. This document is intended for discussion with ActivityPub and
Mastodon-API implementers. It has no allocated FEP identifier yet.

## Summary

This proposal defines two narrow OAuth scopes for an application that needs to
authenticate a Fediverse person without being granted broad account, timeline,
or write access:

- `identify` proves the authenticated account's stable Fediverse subject and
  fully-qualified handle.
- `profile` is additive to `identify` and permits limited public presentation
  claims: the account's display name, public profile URL, and avatar.

An implementation supporting this proposal exposes those claims from the
existing Mastodon-compatible endpoint:

```http
GET /api/v1/accounts/verify_credentials
Authorization: Bearer <access token>
```

This is an OAuth-profile extension. It does **not** claim OpenID Connect
conformance: in particular, it does not define ID tokens, a `userinfo`
endpoint, JWT signing, OIDC discovery, or the `openid` scope.

The profile is useful for Miniapps, but is deliberately general-purpose. A
non-Miniapp web application can use it as a privacy-preserving “sign in with
Fediverse” flow.

## Motivation

Mastodon-compatible servers commonly use `read` or `read:accounts` for
`/api/v1/accounts/verify_credentials`. Those broad scopes let an application
do more than establish who approved it. Some implementations also return an
email address or account settings in a self-account response. That is not
appropriate when an application merely needs to associate its own local
account with a Fediverse person.

Federated applications need a stable, portable identifier. A bare username is
not sufficient: `alice` on one server is not `alice` on another. An ActivityPub
actor IRI is a stable subject identifier within the normal lifecycle of an
account, while a fully-qualified handle is useful for display and account
selection.

This proposal separates those identity needs from optional visual presentation
and from email disclosure.

## Terminology

- **issuer**: the OAuth authorization server that issued an access token.
- **subject**: the authenticated account's canonical ActivityPub actor IRI.
- **application**: the OAuth client using this profile.
- **identity response**: the JSON response defined below for an `identify`
  grant.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** are to be interpreted as described by RFC 2119 and RFC 8174.

## Scope semantics

### `identify`

`identify` authorizes the application to learn that a currently valid bearer
token is bound to one specific subject. It grants no general Mastodon API read
or write authority.

An issuer MUST NOT treat `identify` as a synonym for `read`, `read:accounts`,
or any broader scope. A bearer token granted only `identify` MUST NOT authorize
timeline, notification, follow-list, direct-message, account-settings, or
posting endpoints solely by virtue of that scope.

### `profile`

`profile` authorizes release of limited, public-facing presentation claims.
It MUST be requested and granted together with `identify`; an issuer MUST
reject or omit a standalone `profile` grant.

`profile` does not grant a general profile-reading API. It only extends the
identity response for the token's subject.

### Email and broad scopes

Neither `identify` nor `profile` authorizes disclosure of an email address,
telephone number, private account settings, session data, a private profile
field, or any non-public relationship or content data. This proposal does not
define an `email` scope.

An issuer MAY separately support broad scopes such as `read` and
`read:accounts`. Their existing semantics are outside this proposal. A token
that has both a broad scope and these narrow scopes retains the authority of
the broad scope; applications seeking minimal disclosure MUST request only
`identify`, plus `profile` when needed.

## Discovery

An issuer that supports this proposal SHOULD list `identify` and `profile` in
its OAuth authorization-server metadata's `scopes_supported` field. It MUST
not advertise either scope unless it implements all requirements in this
document.

For example:

```json
{
  "issuer": "https://social.example",
  "authorization_endpoint": "https://social.example/oauth/authorize",
  "token_endpoint": "https://social.example/oauth/token",
  "scopes_supported": ["identify", "profile", "read", "write"]
}
```

An application MUST discover support before requiring these scopes. It SHOULD
offer a server-specific fallback or decline sign-in clearly when the issuer
does not support them; it MUST NOT silently substitute a broad `read` scope
just to obtain identity.

## Identity endpoint

### Authorization

`GET /api/v1/accounts/verify_credentials` MUST accept a valid bearer token
with `identify`. The endpoint MUST return `403` or `401` for a token that lacks
both `identify` and the server's pre-existing scope required for the ordinary
Mastodon response.

When a token contains `identify` but no broad account-read scope, the server
MUST return the identity response defined here rather than its ordinary full
Mastodon account response. A token with a broad account-read scope MAY retain
the server's existing full response semantics; applications that need this FEP
profile MUST avoid requesting that broad scope.

Responses for `identify` or `profile` grants MUST include:

```http
Cache-Control: no-store
Pragma: no-cache
```

### `identify` response

For an `identify`-only token, the response body MUST be exactly this object:

```json
{
  "sub": "https://social.example/users/alice",
  "acct": "alice@social.example"
}
```

- `sub` MUST be the account's canonical ActivityPub actor IRI. It is the
  application-facing stable subject identifier and MUST NOT be an opaque local
  database ID.
- `acct` MUST be the account's fully-qualified Fediverse handle, including the
  domain. It is a display and account-selection value, not the stable key.

The server MUST NOT add other members to an `identify`-only response. A fixed,
small response prevents an implementation's future account fields from
becoming accidental identity claims.

### `identify profile` response

For a token that contains both `identify` and `profile`, the response body
MUST contain these members:

```json
{
  "sub": "https://social.example/users/alice",
  "acct": "alice@social.example",
  "preferred_username": "alice",
  "name": "Alice Example",
  "profile": "https://social.example/@alice",
  "picture": "https://media.social.example/.../avatar.webp"
}
```

In addition to the `identify` members:

- `preferred_username` is the issuer's current local username. It is mutable
  and MUST NOT be used as the subject key.
- `name` is the account's current display name. It is mutable and MAY be an
  empty string.
- `profile` is the account's public human-facing profile URL. It is mutable.
- `picture` is the current public avatar URL. It is mutable. An issuer SHOULD
  return a same-origin or issuer-controlled media-proxy URL so the claim does
  not cause the application to contact an unrelated media origin merely to
  display account selection UI.

An issuer MAY omit `picture` only when the account has no avatar URL. It MUST
otherwise include all fields above, using an empty string where its existing
account model has no value. It MUST NOT add other members to this response.

## Privacy and security requirements

1. The issuer MUST authenticate the bearer token before producing either
   response and MUST bind the response to the token's user, never to a request
   parameter.
2. The issuer MUST require exact OAuth redirect-URI validation, authorization
   code flow, and PKCE for public/browser clients. These protections are
   especially important because the endpoint is a sign-in assertion.
3. An application MUST use `sub` together with the issuer origin as its durable
   external account key. It MUST NOT key accounts only by `acct`, username,
   display name, or avatar URL.
4. Applications MUST treat `name`, `profile`, and `picture` as untrusted,
   mutable display data. They do not prove ownership of a domain, organization,
   trademark, or person.
5. Applications MUST NOT use this response as evidence that the user controls
   an email address, legal identity, age, location, or any other attribute not
   present in the response.
6. Servers MUST NOT return a redirect from this endpoint to a login page. An
   invalid or absent bearer token MUST result in an OAuth-appropriate error.
7. Servers SHOULD rate-limit failed bearer-token attempts and SHOULD avoid
   logging bearer tokens or complete identity response bodies.

## Miniapp profile

A Miniapp-compatible host implementing this proposal MUST require `identify`
for every OAuth-based Miniapp identity request. It MAY request `profile` only
when the app declares that it needs profile presentation data. A host MUST NOT
replace an unsupported `identify` request with broad `read` access.

For backwards compatibility with the current Fediverse Mini Apps V1 profile,
hosts MAY continue exposing a narrow Miniapp-specific identity endpoint. New
Miniapp SDK versions SHOULD prefer this proposal when the issuer advertises
both scopes. The Miniapps protocol specification should version that migration
explicitly; an app MUST NOT assume every deployed V1 host has adopted this
proposal.

## Compatibility

This proposal deliberately changes no response for ordinary clients using the
server's existing account-read scopes. A client requesting `identify` is
opting into this profile and must understand the narrow response shape.

Mastodon, Misskey, and other OAuth providers that do not advertise `identify`
and `profile` are not conforming issuers. Their support for OAuth does not by
itself make this profile available.

## Example authorization request

```text
https://social.example/oauth/authorize?
  response_type=code&
  client_id=CLIENT_ID&
  redirect_uri=https%3A%2F%2Fapp.example%2Foauth%2Fcallback&
  scope=identify%20profile&
  code_challenge=BASE64URL_SHA256_VERIFIER&
  code_challenge_method=S256&
  state=RANDOM_STATE
```

The application exchanges the code using the normal OAuth authorization-code
flow, then calls `verify_credentials` with the resulting token. `state`, PKCE,
and exact redirect-URI validation remain mandatory OAuth concerns; neither
scope weakens them.

## Open questions

1. Should the response endpoint remain `verify_credentials`, as specified
   here, or should a future revision define a dedicated, OIDC-like identity
   endpoint? Reusing the well-known Mastodon path is convenient, but a distinct
   path would avoid a response whose schema varies by scope.
2. Should a future `email` scope be standardized? This proposal intentionally
   does not define it because email verification and disclosure policy vary
   substantially by server.
3. Should `picture` always be issuer-proxied, or may an issuer return an
   original remote avatar URL when the account chose one? The current text
   favors issuer-controlled URLs for privacy.

## References

- RFC 6749 — The OAuth 2.0 Authorization Framework
- RFC 7636 — Proof Key for Code Exchange by OAuth Public Clients
- RFC 8414 — OAuth 2.0 Authorization Server Metadata
- RFC 8252 — OAuth 2.0 for Native Apps
- ActivityPub — W3C Recommendation
