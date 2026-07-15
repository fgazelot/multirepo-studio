# Changelog

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
