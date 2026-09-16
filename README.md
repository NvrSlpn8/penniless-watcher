# Read-only earning watcher

Original dependency-free implementation for Node.js 24. No upstream source was copied. This is a one-shot monitor, not an earning bot or a payment verifier.

## Run locally

From this directory in Git Bash:

```sh
"C:/Program Files/nodejs/node.exe" --test agent.test.mjs
"C:/Program Files/nodejs/node.exe" agent.mjs
```

On other systems with Node 24 on PATH, use `node --test agent.test.mjs` and `node agent.mjs`. No npm install is needed. The CLI always reads and writes beside `agent.mjs`, not relative to the shell directory. It replaces `status.json` and `status.md`; it creates no historical log. Run once per desired observation (scheduling is external).

Initial `config.json` deliberately leaves `baseWallet` and `solanaWallet` empty. Wallet setup is LAST; this program does not generate wallets. An empty wallet renders `NOT_CONFIGURED`, never zero. Config must contain exactly these two string fields; unknown keys are rejected. Base accepts a 40-hex-digit address prefixed with `0x`; Solana must decode from base58 to exactly 32 bytes.

`ledger.json` starts with `{"approvedPRs":[]}`. To explicitly approve an individual public PR for read-only watching, manually add an entry of this exact form:

```json
{"approvedPRs":[{"url":"https://github.com/OWNER/REPOSITORY/pull/123","approved":true}]}
```

This example is a format illustration, not an approved target. Up to 50 unique PRs are accepted. Query strings, fragments, other hosts, unapproved entries, and unknown ledger fields are rejected. There is no repository search, PR discovery, PR creation, or write access. GitHub reads are unauthenticated public API GETs, so rate limits and private repositories may produce `UNKNOWN`. No GitHub login is performed.

## Superteam credentials and schema

With no `SUPERTEAM_API_KEY` environment variable, listings are skipped entirely with `PENDING_REGISTRATION` (meaning no credential is configured here, not an assertion about external account state). If externally provisioned, the environment key is sent only as a Bearer header to the fixed Superteam endpoint. Never put a credential in config, ledger, this README, or a committed file. This watcher neither registers accounts nor reads credential vaults. The parent operator manages any approved registration separately.

The parser accepts the JSON **array** response shape reported by the parent from its authenticated read: entries have `title`, `slug`, `agentAccess`, `status`, `type`, `deadline`, `token`, and numeric `rewardAmount`. Recognized types are `bounty`, `hackathon`, and `project` (projects still require a finite numeric reward field; other compensation shapes fail closed). Only `AGENT_ALLOWED` / `AGENT_ONLY`, `OPEN`, future-deadline entries are retained. An unsupported/malformed shape fails closed as `UNKNOWN_SCHEMA` with no retained items. Additional fields are discarded. The tests use synthetic fixtures matching that reported shape; this implementation's authenticated live verification is left to the parent operator.

The request is exactly `GET https://superteam.fun/api/agents/listings/live?take=50`. Results are always labeled `LIMITED_SLICE_MAX_50`, never all available listings; no pagination is attempted. Listing URLs are constructed solely as `https://superteam.fun/earn/listing/{safe-slug}/`. Titles lose Markdown/HTML delimiter characters and Unicode control/format characters, are length bounded, and have the known key redacted. Remote descriptions are discarded. Deadline, safe token symbol and numeric `potentialPotAmount` are retained as potential-only listing metadata. A listing's total pot is not a guaranteed individual payout.

## Financial interpretation

- Base: `eth_call` / `balanceOf` on USDC contract `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` via `https://mainnet.base.org`, using `latest`.
- Solana: `getTokenAccountsByOwner`, `jsonParsed`, `finalized`, USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, via `https://api.mainnet-beta.solana.com`.
- Amounts use BigInt and six-decimal formatting, including values beyond JavaScript's safe integer range. Solana validates mint, owner, decimals, account type, unique account addresses, and unsigned 64-bit amounts.
- HTTP, RPC, malformed response, rate-limit, and network errors yield `UNKNOWN`, not zero.
- Balances and baseline balances are **not income**. No delta accounting is performed. Merged PRs and listings remain `POTENTIAL_ONLY`.
- Verified earnings are always `NOT_VERIFIED`. This version deliberately does not import or certify payout receipts. Claiming earned income would require separately verified, human-attested transaction-plus-task attribution; reward estimates or balance changes are insufficient.

## Security and operational boundaries

Runtime network destinations are fixed to the two RPCs, Superteam, and the public GitHub pull endpoint derived from explicit approved URLs. Requests reject redirects, time out after at most 10 seconds, and cap decoded responses at 1 MiB. Inputs are capped at 64 KiB. Errors are generic, not raw response bodies or exception messages. No private keys, signatures, funds movement, submissions, package installation, paid service integrations, or arbitrary URL fetches exist in the CLI. Exported functions support injected fetch implementations solely for local tests; do not inject untrusted code.

Output timestamps are generated at runtime in UTC. `runtimeSource` is `GITHUB_ACTIONS` when that environment flag equals `true`, otherwise `LOCAL`; it is a runtime label, not cryptographic provenance. The CLI exits nonzero for invalid local input or unavailable output; remote failures are represented in status and do not force a nonzero exit. Inspect statuses, not just exit code. Output replacement is not a transactional two-file operation; do not run overlapping instances or treat partial writes after interruption as authoritative.

## Tests and limits

Tests were developed one vertical behavior at a time: a failing assertion was observed before each implementation slice, then the complete suite rerun. Network tests are **mocked fixtures**, not claims of live balances, PRs, or payouts. The no-wallet/no-key local CLI run is real and makes no network requests. Wallet balances and authenticated listings require separate live verification when configuration is authorized.

Public RPCs can be unavailable or rate-limited. Base `latest` can reorganize. Token values do not establish fiat value or earned revenue. Solana supports the specified classic USDC mint only, not arbitrary tokens or token programs. Unknown listing access modes/types fail closed rather than guessing. This watcher does not assess task legitimacy, reward eligibility, deadline changes after observation, or payout authenticity.
