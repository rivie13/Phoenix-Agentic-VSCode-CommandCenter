# Epic/Feature/Subfeature Template Plan

This document defines a shared template strategy for issue intake quality across repos.
It is planning-only and intended to be implemented in each target repo privately.

## Goals

- Ensure every issue has enough information to execute without back-and-forth.
- Preserve hierarchy: Epic -> Feature -> Subfeature -> optional task checklist.
- Enforce scoping quality before work starts.
- Keep board automation reliable through consistent metadata.

## Hierarchy Model

- `Epic`: large outcome spanning multiple features and milestones.
- `Feature`: concrete deliverable under one Epic.
- `Subfeature`: implementable unit under one Feature, usually one PR or small PR set.
- `Tasks`: checklist items inside Subfeature (avoid creating a separate issue unless needed).

## Shared Required Fields (All Templates)

- `Type`: Epic / Feature / Subfeature.
- `Parent links`: Epic link for Feature, Feature link for Subfeature.
- `Repository`: target repo.
- `Base branch`: branch work starts from (example: `main` or `release/x.y`).
- `Proposed branch name`: expected branch naming convention.
- `Problem statement`: what problem this solves.
- `Scope`: in-scope and out-of-scope.
- `Definition of done`: objective completion criteria.
- `Dependencies`: blocking and blocked-by items.
- `Risks`: technical, product, or delivery risks.
- `Validation plan`: how it will be verified (tests/manual/metrics).
- `Board fields`: status, priority, size, area, work mode, owner.

## Type-Specific Requirements

### Epic

- Business/user outcome.
- Success metrics and measurement window.
- Feature breakdown list.
- Milestone/target window.
- Cross-repo impact summary.

### Feature

- User-facing behavior or platform behavior requirements.
- Acceptance criteria list.
- Architecture impact summary.
- Rollout/flag strategy.
- Subfeature breakdown list.

### Subfeature

- Technical implementation requirements.
- File/module/component impact.
- Task checklist (small actionable steps).
- Test additions/changes required.
- PR strategy (single PR vs staged PRs).

## Branching Conventions

Recommended branch pattern:

- Epic: `epic/<short-slug>`
- Feature: `feat/<area>-<short-slug>`
- Subfeature: `subfeat/<area>-<short-slug>`
- Hotfix (if needed): `fix/<area>-<short-slug>`

Each template should ask for:

- `Base branch` (required)
- `Planned branch name` (required)
- `Reason if diverging from convention` (optional)

## Intake Quality Gate (Accept/Reject Rules)

Accept when:

- Parent links are valid for the issue type.
- Problem/scope/done criteria are complete.
- Validation plan is present.
- Branch/base branch fields are present.
- Dependencies and risks are documented (or explicitly `none`).

Reject or mark `needs-info` when:

- Scope is ambiguous.
- No parent linkage.
- No done criteria.
- No validation plan.
- Missing branch/base branch.

## Suggested GitHub Template Layout

- `.github/ISSUE_TEMPLATE/epic.yml`
- `.github/ISSUE_TEMPLATE/feature.yml`
- `.github/ISSUE_TEMPLATE/subfeature.yml`
- `.github/ISSUE_TEMPLATE/config.yml` (disable blank issues if desired)

Recommended YAML sections:

- Required text areas for scope, requirements, acceptance, validation.
- Required dropdowns for priority/size/area/work mode.
- Required input fields for base branch and planned branch.
- Required parent link field with format hint.
- Optional checklist blocks for readiness and QA.

## Suggested Automation Workflow

Add a workflow per repo:

- `.github/workflows/issue-intake-gate.yml`
- Trigger: `issues.opened`, `issues.edited`
- Validate required fields and structure.
- Apply labels:
  - `intake:ready`
  - `intake:needs-info`
  - `type:epic|feature|subfeature`
- Optionally comment with exact missing fields.

## Rollout Plan

1. Pilot in one repo with Feature + Subfeature templates.
2. Add Epic template once parent-link flow is stable.
3. Enable intake gate in warn mode first (label/comment only).
4. Move to stricter enforcement once false positives are low.

