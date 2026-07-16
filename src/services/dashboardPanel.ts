import * as vscode from 'vscode';
import { PlatformService, PlatformType, MRStatusResponse, detectPlatform } from './platformService';
import { GitService } from './gitService';

export interface DashboardEntry {
	repoName: string;
	group?: string;
	repoPath: string;
	platform: PlatformType;
	mrId: number;
	mrUrl: string;
	isDraft: boolean;
}

export class DashboardPanel {
	private static instance: DashboardPanel | undefined;
	private panel: vscode.WebviewPanel;
	private entries: DashboardEntry[] = [];
	private statuses: Map<string, MRStatusResponse> = new Map();
	private refreshInterval: NodeJS.Timeout | undefined;
	private disposed = false;

	private constructor(
		private readonly platforms: Map<PlatformType, PlatformService>,
		private readonly git: GitService,
	) {
		this.panel = vscode.window.createWebviewPanel(
			'multirepoStudio.dashboard',
			'MultiRepo Studio — Dashboard',
			vscode.ViewColumn.One,
			{ enableScripts: true, retainContextWhenHidden: true },
		);

		this.panel.onDidDispose(() => {
			this.disposed = true;
			if (this.refreshInterval) { clearInterval(this.refreshInterval); }
			DashboardPanel.instance = undefined;
		});

		this.panel.webview.onDidReceiveMessage(async (msg) => {
			if (msg.command === 'refresh') {
				await this.refreshStatuses();
			} else if (msg.command === 'openUrl') {
				vscode.env.openExternal(vscode.Uri.parse(msg.url));
			}
		});
	}

	static open(
		platforms: Map<PlatformType, PlatformService>,
		git: GitService,
		entries: DashboardEntry[],
	): DashboardPanel {
		if (DashboardPanel.instance) {
			DashboardPanel.instance.entries = entries;
			DashboardPanel.instance.statuses.clear();
			DashboardPanel.instance.panel.reveal();
			DashboardPanel.instance.render();
			DashboardPanel.instance.refreshStatuses();
			return DashboardPanel.instance;
		}

		const dashboard = new DashboardPanel(platforms, git);
		DashboardPanel.instance = dashboard;
		dashboard.entries = entries;
		dashboard.render();
		dashboard.refreshStatuses();
		dashboard.startAutoRefresh();
		return dashboard;
	}

	private startAutoRefresh(): void {
		this.refreshInterval = setInterval(() => {
			if (!this.disposed) {
				this.refreshStatuses();
			}
		}, 15000);
	}

	private async refreshStatuses(): Promise<void> {
		const updates = this.entries.map(async (entry) => {
			const key = `${entry.platform}:${entry.repoName}:${entry.mrId}`;
			try {
				const remoteUrl = await this.git.getRemoteUrl(entry.repoPath);
				if (!remoteUrl) { return; }
				const platform = this.platforms.get(entry.platform);
				if (!platform) { return; }
				const status = await platform.getMergeRequestStatus(remoteUrl, entry.mrId);
				this.statuses.set(key, status);
			} catch {
				// keep previous status on error
			}
		});

		await Promise.all(updates);

		if (!this.disposed) {
			this.render();
		}
	}

	private render(): void {
		this.panel.webview.html = this.getHtml();
	}

	private getHtml(): string {
		const rows = this.entries.map(entry => {
			const key = `${entry.platform}:${entry.repoName}:${entry.mrId}`;
			const status = this.statuses.get(key);
			const prLabel = entry.platform === 'github' ? 'PR' : 'MR';

			const repoDisplay = entry.group ? `${entry.group}/${entry.repoName}` : entry.repoName;
			const mrLabel = `${prLabel} #${entry.mrId}`;
			const draftBadge = (status?.isDraft ?? entry.isDraft) ? '<span class="badge draft">Draft</span>' : '';

			let stateClass = 'open';
			let stateLabel = 'Open';
			if (status) {
				stateClass = status.state;
				stateLabel = status.state === 'open' ? 'Open' : status.state === 'merged' ? 'Merged' : 'Closed';
			}

			let pipelineHtml = '<span class="pipeline unknown">—</span>';
			if (status?.pipeline) {
				const ps = status.pipeline.status;
				const icon = ps === 'passed' ? '&#10003;'
					: ps === 'failed' ? '&#10007;'
					: ps === 'running' ? '&#9654;'
					: ps === 'pending' ? '&#9679;'
					: ps === 'cancelled' ? '&#9632;'
					: '—';
				const label = ps.charAt(0).toUpperCase() + ps.slice(1);
				const clickAttr = status.pipeline.url ? ` class="pipeline ${ps} clickable" onclick="openUrl('${status.pipeline.url}')"` : ` class="pipeline ${ps}"`;
				pipelineHtml = `<span${clickAttr}>${icon} ${label}</span>`;
			}

			return `<tr>
				<td class="repo">${this.escapeHtml(repoDisplay)}</td>
				<td><a class="mr-link" onclick="openUrl('${entry.mrUrl}')">${mrLabel}</a> ${draftBadge}</td>
				<td><span class="badge state-${stateClass}">${stateLabel}</span></td>
				<td>${pipelineHtml}</td>
			</tr>`;
		}).join('\n');

		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
	body {
		font-family: var(--vscode-font-family, system-ui, sans-serif);
		font-size: var(--vscode-font-size, 13px);
		color: var(--vscode-foreground);
		background: var(--vscode-editor-background);
		padding: 16px 20px;
		margin: 0;
	}
	h1 {
		font-size: 16px;
		font-weight: 500;
		margin: 0 0 4px 0;
	}
	.subtitle {
		color: var(--vscode-descriptionForeground);
		font-size: 12px;
		margin-bottom: 16px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th {
		text-align: left;
		font-weight: 500;
		padding: 8px 12px;
		border-bottom: 1px solid var(--vscode-widget-border, #333);
		color: var(--vscode-descriptionForeground);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}
	td {
		padding: 10px 12px;
		border-bottom: 1px solid var(--vscode-widget-border, #222);
	}
	tr:hover { background: var(--vscode-list-hoverBackground); }
	.repo { font-weight: 500; }
	.mr-link {
		color: var(--vscode-textLink-foreground);
		cursor: pointer;
		text-decoration: none;
	}
	.mr-link:hover { text-decoration: underline; }
	.badge {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 10px;
		font-size: 11px;
		font-weight: 500;
	}
	.draft {
		background: var(--vscode-badge-background);
		color: var(--vscode-badge-foreground);
		margin-left: 6px;
	}
	.state-open { background: #238636; color: #fff; }
	.state-merged { background: #8957e5; color: #fff; }
	.state-closed { background: #da3633; color: #fff; }
	.pipeline {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		border-radius: 10px;
		font-size: 12px;
	}
	.pipeline.clickable { cursor: pointer; }
	.pipeline.clickable:hover { text-decoration: underline; }
	.pipeline.passed { background: #238636; color: #fff; }
	.pipeline.failed { background: #da3633; color: #fff; }
	.pipeline.running { background: #1f6feb; color: #fff; }
	.pipeline.pending { background: #d29922; color: #fff; }
	.pipeline.cancelled { background: #6e7681; color: #fff; }
	.pipeline.unknown { color: var(--vscode-descriptionForeground); }
	.toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 16px;
	}
	.refresh-btn {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border: none;
		padding: 4px 12px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
	}
	.refresh-btn:hover { background: var(--vscode-button-hoverBackground); }
	.auto-label {
		color: var(--vscode-descriptionForeground);
		font-size: 11px;
	}
</style>
</head>
<body>
	<div class="toolbar">
		<h1>Change Set Dashboard</h1>
		<button class="refresh-btn" onclick="refresh()">Refresh</button>
		<span class="auto-label">Auto-refresh every 15s</span>
	</div>
	<div class="subtitle">${this.entries.length} MR/PR(s) tracked</div>
	<table>
		<thead>
			<tr>
				<th>Repository</th>
				<th>MR / PR</th>
				<th>State</th>
				<th>Pipeline / Checks</th>
			</tr>
		</thead>
		<tbody>
			${rows}
		</tbody>
	</table>
	<script>
		const vscode = acquireVsCodeApi();
		function refresh() { vscode.postMessage({ command: 'refresh' }); }
		function openUrl(url) { vscode.postMessage({ command: 'openUrl', url }); }
	</script>
</body>
</html>`;
	}

	private escapeHtml(text: string): string {
		return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}
}
