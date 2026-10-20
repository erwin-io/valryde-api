# Agent D policy identity correction: post-merge synchronization

State: PREPARED / NOT EXECUTED. Apply only after Tech Lead approval and the
documentation PR on `docs/correct-agent-d-repository` is merged into
`erwin-io/valryde-api` main. Opening this PR does not authorize merging it or
synchronizing an unmerged policy. No feature checklist completion is claimed.

Canonical policy revision: **1.2**, revised **2026-10-21**. Only Agent D's repository
identity, its explicit GitHub/local references and revision metadata are corrected.
All other reporting rules, ownership, checklist assignments and status paths remain
unchanged. Seven API handoffs contain the same identity-only substitution.

Correct Agent D repository:
[erwin-io/valryde-mobile-driver-operator](https://github.com/erwin-io/valryde-mobile-driver-operator).
Correct local workspace: `C:\Development\valryde\valryde-mobile-driver-operator`.
GitHub repository existence and local directory were confirmed during preparation.

## Instructions for the four receiving agents

| Agent | Workspace | Persistent status to update |
|---|---|---|
| C | C:\Development\valryde\valryde-mobile-commuter | docs/agent-status/AGENT_C_STATUS.md |
| D | C:\Development\valryde\valryde-mobile-driver-operator | docs/agent-status/AGENT_D_STATUS.md |
| E | C:\Development\valryde\valryde-web-admin | docs/agent-status/AGENT_E_STATUS.md |
| Infrastructure | C:\Development\valryde\valryde-infra | docs/agent-status/TRACCAR_INFRASTRUCTURE_STATUS.md |

1. Confirm Tech Lead acceptance and the PR's actual merged state. Read your own
   instructions/status and inspect local changes. Do not overwrite another agent's
   in-progress policy edits; reconcile differences first. Git-enabled workspaces
   use a focused documentation branch and their normal PR review process. Do not
   initialize Git in Infrastructure just to synchronize this file.
2. Fetch the canonical policy **from the actual merged commit**, not from a developer
   checkout or an open branch. The commands below locate the merged PR by its exact
   branch name, reject no/multiple matches and download immutable merge content.
3. Inspect the old/new policy diff. Expected change is revision1.1 to1.2, Agent D's
   corrected repository identity, explicit GitHub/local reference and revision note.
   Preserve all other rules/agent assignments. The canonical file must contain none
   of the obsolete repository identifier. Preserve historical status/activity entries
   as history rather than rewriting them.
4. Back up the existing local policy outside source if needed; replace only
   `docs/00_SHARED_AGENT_STATUS_REPORTING_POLICY.md` with the reviewed canonical bytes.
   Verify the SHA256 matches the merged canonical content. Inspect any remaining
   obsolete Agent D references in current owned instructions/handoffs and apply only
   the equivalent approved identity correction through normal review; never copy
   unrelated API handoffs over local work. Do not mass-edit frozen evidence/backups.
5. In your existing persistent status, record revision1.2, source PR URL, immutable
   merge SHA, new policy SHA256, files changed and documentation-only validation.
   Report any unresolved current references. No source/API/schema/runtime change.
6. Return a synchronization confirmation to the Tech Lead through the owner-approved
   coordination channel. This preparation did not message any other chat/agent.

## Exact PowerShell retrieval and application sequence

Run only after merge. The first block is read-only remote retrieval plus a temporary
local candidate; it does not overwrite your policy.

```powershell
$merged = @(gh pr list --repo erwin-io/valryde-api --state merged --head docs/correct-agent-d-repository --limit 100 --json number,url,mergeCommit | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $merged.Count -ne 1 -or -not $merged[0].mergeCommit.oid) { throw 'Exactly one accepted, merged policy PR is required' }
$mergeSha = $merged[0].mergeCommit.oid
$encoded = gh api "repos/erwin-io/valryde-api/contents/docs/00_SHARED_AGENT_STATUS_REPORTING_POLICY.md?ref=$mergeSha" --jq .content
if ($LASTEXITCODE -ne 0) { throw 'Canonical policy retrieval failed' }
$bytes = [Convert]::FromBase64String(($encoded -join '') -replace '\s', '')
$candidateText = [Text.Encoding]::UTF8.GetString($bytes)
if ($candidateText -notmatch '\*\*Version:\*\* 1\.2' -or $candidateText -match 'valryde-mobile-operator') { throw 'Unexpected policy revision or obsolete Agent D repository' }
$candidate = Join-Path ([IO.Path]::GetTempPath()) ('valryde-policy-' + $mergeSha + '.md')
[IO.File]::WriteAllBytes($candidate, $bytes)
Get-FileHash -LiteralPath $candidate -Algorithm SHA256
```

Choose **only your assigned workspace** from the table; the next block uses Agent D
as the concrete example. Inspect the diff before executing the copy block.

```powershell
$workspace = 'C:\Development\valryde\valryde-mobile-driver-operator'
$target = Join-Path $workspace 'docs\00_SHARED_AGENT_STATUS_REPORTING_POLICY.md'
git diff --no-index -- $target $candidate
```

`git diff --no-index` exits1 for expected differences; review the actual diff.
Infrastructure can use the same comparison command without initializing Git.
After approval of that exact difference:

```powershell
$backup = Join-Path ([IO.Path]::GetTempPath()) ('valryde-policy-before-' + [guid]::NewGuid().ToString('N') + '.md')
Copy-Item -LiteralPath $target -Destination $backup -ErrorAction Stop
[IO.File]::WriteAllBytes($target, $bytes)
if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash) { throw 'Policy synchronization hash mismatch' }
$merged[0].url
$mergeSha
```

The operator confirms Tech Lead acceptance from the actual review record; merged
state alone does not substitute for that decision. Record the result in your own
status and follow your repository's documentation PR process. No automatic push,
merge, database operation, service change or infrastructure deployment is part of
this synchronization.

Canonical activity record for this Infrastructure-owned correction remains
`C:\Development\valryde\valryde-infra\docs\agent-status\TRACCAR_INFRASTRUCTURE_STATUS.md`.
This document is a synchronization instruction, not a duplicate agent status file.
