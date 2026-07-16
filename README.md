# MultiRepo Studio

[![CI](https://github.com/fgazelot/multirepo-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/fgazelot/multirepo-studio/actions/workflows/ci.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/fgazelot.multirepo-studio)](https://marketplace.visualstudio.com/items?itemName=fgazelot.multirepo-studio)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Orchestrate cross-repository changes on GitHub and GitLab from a single VS Code workspace.**

When a change spans multiple repositories (version upgrade, Ansible variable, Terraform module, Helm chart...), you normally have to: open each repo, create a branch, make the change, commit, push, create a Pull/Merge Request. Repeat for every repo.

MultiRepo Studio reduces this to **one action**. You work in a standard VS Code Multi Root Workspace, modify your files across repos, and click **Publish Change Set**. The extension handles everything else.

## Supported Platforms

- **GitHub** — Pull Requests via REST API
- **GitLab** — Merge Requests via REST API (including self-hosted instances)

The platform is auto-detected from each repository's remote URL. You can mix GitHub and GitLab repos in the same workspace.

## Features

### Publish Change Set

One command to rule them all. Enter your branch name, commit message, and PR/MR details once — the extension creates branches, commits, pushes, and opens Pull/Merge Requests across all modified repositories in parallel.

### Smart Detection

Already working on a feature branch? The extension detects it and offers to push a new commit to the existing branch instead of creating a new one. No separate command needed.

### Switch All to Default Branch

Starting a new task? One click resets all repositories to their default branch. Uncommitted changes are automatically stashed — nothing is lost.

### Grouped TreeView

Repositories are displayed in the sidebar, grouped by parent folder (product line, team, environment...). Each repo shows its current branch and number of changed files.

### Notification Template

Configure a message template that gets copied to your clipboard after publishing. Paste it in Slack, Teams, or Discord to notify your team. Fully customizable with variables: `{repo}`, `{mrUrl}`, `{mrIid}`, `{description}`, `{reviewTime}`, `{reviewCount}`.

### Search & Replace Across Repos

Find a variable, version, or any string across all your repositories. See exactly where it appears (repo, file, line), then replace it everywhere with one confirmation. The modified files are ready for **Publish Change Set**.

### Draft MR/PR

Create merge requests as drafts (work-in-progress) directly from the Change Set form. Drafts are not mergeable until marked ready — useful for early feedback or WIP changes.

### Post-publish Dashboard

After publishing, a live dashboard opens showing the status of all your MR/PRs: state (open, merged, closed), pipeline/checks (running, passed, failed). Auto-refreshes every 15 seconds — no need to open multiple browser tabs.

### Change Set History

Browse your last 20 published Change Sets. Select any past Change Set to reopen its dashboard with live status polling.

### Error Handling

- Distinguishes between git failures and PR/MR creation failures
- Smart retry with repo selection and error classification (transient vs permanent)
- Transient errors (429, 5xx, network) auto-retried with exponential backoff
- Automatic stash on branch switch
- Pre-publish safety checks (conflicts, rebase, detached HEAD)

## Getting Started

1. Install the extension from the VS Code Marketplace
2. Open a folder containing multiple Git repositories (or use a Multi Root Workspace)
3. Configure your token:
   - **GitHub**: `Ctrl+Shift+P` → **MultiRepo Studio: Configure GitHub Token**
   - **GitLab**: `Ctrl+Shift+P` → **MultiRepo Studio: Configure GitLab Token**
4. Modify files across your repos
5. `Ctrl+Shift+P` → **MultiRepo Studio: Publish Change Set**

### Tokens

- **GitHub**: Personal Access Token with `repo` scope
- **GitLab**: Personal Access Token with `api` scope

Tokens are stored securely in your OS keychain via VS Code's SecretStorage API.

## Commands

| Command | Description |
|---------|-------------|
| **Search & Replace Across Repos** | Find and replace a string across all repositories |
| **Publish Change Set** | Create branches, commit, push, and open PRs/MRs on all modified repos |
| **Switch All to Default Branch** | Reset all repos to their default branch (auto-stash) |
| **Refresh Repositories** | Manually refresh the repository list |
| **Configure GitHub Token** | Store your GitHub PAT securely |
| **Configure GitLab Token** | Store your GitLab PAT securely |
| **Discard All Changes** | Discard uncommitted changes or save to a new branch |
| **Open Dashboard** | Reopen the post-publish dashboard for the latest Change Set |
| **Change Set History** | Browse past Change Sets and reopen their dashboard |
| **Retry Failed Merge Requests** | Retry PR/MR creation with repo selection and smart backoff |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `notificationTemplate.enabled` | `false` | Enable notification message generation |
| `notificationTemplate.template` | See below | Customizable message template |
| `notificationTemplate.separator` | `\n\n---\n\n` | Separator between repo entries |
| `notificationTemplate.promptReviewTime` | `true` | Ask for review time estimate |
| `notificationTemplate.promptReviewCount` | `true` | Ask for number of reviewers |
| `notificationTemplate.defaultReviewTime` | `5m` | Default review time |
| `notificationTemplate.defaultReviewCount` | `1` | Default reviewer count |

### Template Variables

`{repo}` `{mrUrl}` `{mrIid}` `{description}` `{reviewTime}` `{reviewCount}`

### Example Template (Slack)

```
[{repo}]
{description}
{mrUrl}

Temps de relecture :hourglass_flowing_sand: : {reviewTime}
Nombre de relecture :white_check_mark: : {reviewCount}
```

## Use Cases

- **DevOps / Platform Engineering**: Upgrade a tool version across all infrastructure repos
- **Infrastructure-as-Code**: Change an Ansible variable, Terraform module, or Helm value everywhere
- **SRE**: Apply a security patch across all service configurations
- **Microservices**: Update a shared library version in all services

## Roadmap

- [x] GitHub support
- [x] Search & Replace across repos
- [x] MR/PR dashboard with pipeline status
- [x] Draft Pull/Merge Requests
- [x] Smart retry with error classification
- [x] Change Set history
- [ ] Bitbucket support
- [ ] CLI companion

## Support

If you find this extension useful, consider supporting the project:

- [Buy me a coffee](https://buymeacoffee.com/fgazelot)
- [GitHub Sponsors](https://github.com/sponsors/fgazelot)
- Star the [GitHub repository](https://github.com/fgazelot/multirepo-studio)

## License

[MIT](LICENSE)
