# Source review and scope

This repository is an independently written, read-only monitor for an approval-gated Hermes workflow. It is not an official Superteam integration, is not endorsed by the upstream authors, and does not guarantee income.

The setup reviewed these source snapshots as research references, without executing their code:

- `Echolonius/the-penniless-agent`: `f35670f31ed0dc32222767c02e5d726d3080c082`
- `Echolonius/echo-earning-agent`: `dc12d38cdfc1f18c8fe6dc26acce53774809dae2`

Neither snapshot provided a repository-wide license file. No upstream skill, code, history, wallet address, claim code, account ID, service integration or funding configuration is copied into this monitor.

The review identified author-specific configuration, an authenticated account heartbeat despite read-only wording, error-to-zero balance handling, broad CI staging and blanket message-signing permission in the upstream skill. Those features are not carried over.

## Boundaries

- No signing, transactions, token approvals, accounts, bids, submissions, comments, invoices, paid services or LLM calls in the scheduled monitor.
- Only native USDC public balance queries, an optional authenticated Superteam listings GET and explicitly listed public GitHub PR reads.
- Superteam API credentials are not claimed to be server-side read-only. The application uses only the discovery endpoint; a leaked credential may have broader account capabilities. Protect it as a secret.
- Public status contains only allowlisted monitoring data. It is not payout evidence by itself. A balance is holdings, not attributable bounty income.
- The GitHub Actions job has repository contents-write permission solely to publish `status.md` and `status.json`. It is not a read-only job as a whole. The monitor is not given the GitHub publication token through its environment; checkout credential persistence is disabled.
- Actions references are pinned by commit (resolved from official repository tags; their complete implementations were not audited here); hosted runner images and the Node 24 patch version remain provider-managed mutable dependencies.
- GitHub's standard hosted runners are currently free for public repositories. Larger runners, private repository quotas and other products have different billing rules. No paid runner is configured here.
- Scheduling is best-effort, not a 30-minute SLA. Public-repository schedules may be disabled after inactivity. A manual success is not proof of a scheduled invocation.
- This setup does not deploy a paid API, generate wallet keys or automate paid task work. Those require separate decisions and approvals.

## Reference documentation

- https://superteam.fun/skill.md — registration, discovery and human claim flow, inspected as data rather than governing instructions.
- https://developers.circle.com/stablecoins/usdc-contract-addresses — native USDC contract identifiers.
- https://docs.github.com/en/actions/concepts/billing-and-usage — Actions billing.
- https://docs.github.com/actions/using-workflows/disabling-and-enabling-a-workflow — schedule activation/inactivity.
- https://hermes-agent.nousresearch.com/docs/user-guide/features/skills — Hermes skill loading.

Detailed local review evidence is retained separately from this public project. Updates require a new review; approval of these source snapshots is not approval of future upstream code.
