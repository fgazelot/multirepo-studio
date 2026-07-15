# MultiRepo Studio

**Orchestrate cross-repository changes on GitLab from a single VS Code workspace.**

When a change spans multiple repositories (version upgrade, Ansible variable, Terraform module, Helm chart...), you normally have to: open each repo, create a branch, make the change, commit, push, create a Merge Request. Repeat for every repo.

MultiRepo Studio reduces this to **one action**. You work in a standard VS Code Multi Root Workspace, modify your files across repos, and click **Publish Change Set**. The extension handles everything else.

## Features

### Publish Change Set

One command to rule them all. Enter your branch name, commit message, and MR details once — the extension creates branches, commits, pushes, and opens GitLab Merge Requests across all modified repositories in parallel.

### Smart Detection

Already working on a feature branch? The extension detects it and offers to push a new commit to the existing branch instead of creating a new one. No separate command needed.

### Switch All to Default Branch

Starting a new task? One click resets all repositories to their default branch. Uncommitted changes are automatically stashed — nothing is lost.

### Grouped TreeView

Repositories are displayed in the sidebar, grouped by parent folder (product line, team, environment...). Each repo shows its current branch and number of changed files.

### Notification Template

Configure a message template that gets copied to your clipboard after publishing. Paste it in Slack, Teams, or Discord to notify your team. Fully customizable with variables: `{repo}`, `{mrUrl}`, `{mrIid}`, `{description}`, `{reviewTime}`, `{reviewCount}`.

### Error Handling

- Distinguishes between git failures and MR creation failures
- Retry MR creation without re-pushing
- Automatic stash on branch switch
- Pre-publish safety checks (conflicts, rebase, detached HEAD)

## Getting Started

1. Install the extension from the VS Code Marketplace
2. Open a folder containing multiple Git repositories (or use a Multi Root Workspace)
3. Configure your GitLab token: `Ctrl+Shift+P` → **MultiRepo Studio: Configure GitLab Token**
4. Modify files across your repos
5. `Ctrl+Shift+P` → **MultiRepo Studio: Publish Change Set**

### GitLab Token

You need a GitLab Personal Access Token with the `api` scope. The token is stored securely in your OS keychain via VS Code's SecretStorage API.

## Commands

| Command | Description |
|---------|-------------|
| **Publish Change Set** | Create branches, commit, push, and open MRs on all modified repos |
| **Switch All to Default Branch** | Reset all repos to their default branch (auto-stash) |
| **Refresh Repositories** | Manually refresh the repository list |
| **Configure GitLab Token** | Store your GitLab PAT securely |
| **Retry Failed Merge Requests** | Retry MR creation for repos that were pushed but MR failed |

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

- [ ] MR dashboard with pipeline status
- [ ] Draft Merge Requests
- [ ] Automatic reviewers
- [ ] Labels
- [ ] Change Set history
- [ ] GitHub support
- [ ] Bitbucket support

## Support

If you find this extension useful, consider supporting the project:

- [Buy me a coffee](https://buymeacoffee.com/fgazelot)
- [GitHub Sponsors](https://github.com/sponsors/fgazelot)
- Star the [GitHub repository](https://github.com/fgazelot/multirepo-studio)

## License

[MIT](LICENSE)
