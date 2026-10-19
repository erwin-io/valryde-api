# VALRYDE — Claude Code Project Instructions

This repository belongs to the VALRYDE multi-agent software development project.

## Mandatory shared instructions

Before performing any development task, read and follow:

`./AGENTS.md`

Treat `AGENTS.md` as the common VALRYDE engineering instruction entry point, in addition to the approved system documentation and all relevant handoffs.

The shared requirements apply to Claude Code exactly as they apply to other AI development agents.

## Agent-specific documentation

Identify the assigned module and checklist IDs.

Read the matching handoff under:

`handoffs/`

Also read the Tech Lead governance handoff for shared integration and review requirements.

Do not assume the current AI tool determines the module owner. Ownership is determined by the assigned task and VALRYDE's approved responsibility matrix.

## Mandatory status reporting

Read and follow:

`docs/00_SHARED_AGENT_STATUS_REPORTING_POLICY.md`

Read the assigned agent's existing file under:

`docs/agent-status/`

Update the existing status file after meaningful development actions and before ending the work session.

Do not create duplicate agent status files or new status files for every response.

Preserve current progress, verification results, blockers, relevant checklist IDs, and activity history.

## Development and review

- Follow the approved Version 1.0 MVP architecture.
- Respect repository and module ownership boundaries.
- Inspect existing source before editing.
- Run applicable verification.
- Report actual outcomes.
- Do not modify secrets or unrelated files.
- Do not self-merge developer PRs.
- Observe Tech Lead approval and operator-gated requirements.

## Completion

Before concluding a development session:

1. Update the persistent agent status file.
2. Confirm the status matches actual repository/test evidence.
3. Provide a concise completion summary.
4. State any blocker and the exact next action.

When a shared instruction cannot be followed because a required file, permission, or tool is missing, report the limitation rather than silently skipping the requirement.

**`AGENTS.md` and the referenced VALRYDE handoffs remain the authoritative shared engineering instructions.**
