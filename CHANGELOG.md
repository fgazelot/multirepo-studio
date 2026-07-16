# Changelog

## 0.3.1 (2026-07-16)

- **Branch conflict handling**: when a branch already exists, offers to delete and recreate or skip — no more blocked repos

## 0.3.0 (2026-07-16)

- **Draft MR/PR**: option in Change Set form to create draft/WIP merge requests (GitHub `draft` field, GitLab `Draft:` prefix)
- **Post-publish Dashboard**: WebView opens automatically after publishing, showing MR/PR state (open/merged/closed) and pipeline/checks status with auto-refresh every 15 seconds
- **Smart Retry**: select which repos to retry, transient errors (429, 5xx, network) auto-retried with exponential backoff (up to 3 attempts)
- **Change Set History**: last 20 published Change Sets are persisted — browse and reopen any past dashboard
- New commands: **Open Dashboard**, **Change Set History**
- **Discard All Changes**: discard uncommitted changes or save them to a new branch first

## 0.2.0 (2026-07-15)

- **GitHub support**: create Pull Requests on GitHub repositories alongside GitLab Merge Requests
- Auto-detection of platform (GitHub/GitLab) from each repository's remote URL
- Mix GitHub and GitLab repos in the same workspace
- New command: **Configure GitHub Token**
- **Search & Replace Across Repos**: find a string across all repositories, preview matches, replace everywhere
- New command: **Search & Replace Across Repos** (also available in sidebar toolbar)

## 0.1.0 (2026-07-15)

Initial release.

- Automatic detection of Git repositories in Multi Root Workspaces (recursive scan)
- Sidebar TreeView grouped by parent folder (product line, team, etc.)
- **Publish Change Set**: create branch, commit, push, and open GitLab Merge Requests across all modified repos with a single action
- Smart detection: if repos are already on a feature branch, pushes to existing branches instead of creating new ones
- **Switch All to Default Branch**: reset all repos to their default branch with automatic stash of uncommitted changes
- Retry failed MR creation without re-pushing
- Configurable notification template for Slack/Teams/Discord messages (copied to clipboard)
- GitLab token stored securely in OS keychain
- Detailed Output panel report with clickable MR links
