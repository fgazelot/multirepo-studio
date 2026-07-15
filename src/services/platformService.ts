import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';

export interface PullRequestResponse {
	id: number;
	url: string;
	title: string;
}

export type PlatformType = 'github' | 'gitlab';

export interface PlatformService {
	readonly type: PlatformType;
	configureToken(): Promise<void>;
	getToken(): Promise<string | undefined>;
	createPullRequest(
		remoteUrl: string,
		sourceBranch: string,
		targetBranch: string,
		title: string,
		description: string,
	): Promise<PullRequestResponse>;
}

interface RemoteProject {
	host: string;
	projectPath: string;
}

export function parseRemoteUrl(remoteUrl: string): RemoteProject | null {
	const sshMatch = remoteUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
	if (sshMatch) {
		return { host: sshMatch[1], projectPath: sshMatch[2] };
	}

	const httpsMatch = remoteUrl.match(/^https?:\/\/(?:[^@]+@)?([^/]+)\/(.+?)(?:\.git)?$/);
	if (httpsMatch) {
		return { host: httpsMatch[1], projectPath: httpsMatch[2] };
	}

	return null;
}

export function detectPlatform(remoteUrl: string): PlatformType {
	const project = parseRemoteUrl(remoteUrl);
	if (project && project.host.includes('github.com')) {
		return 'github';
	}
	return 'gitlab';
}

export function httpRequest<T>(
	host: string,
	path: string,
	method: string,
	headers: Record<string, string>,
	body?: string,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const isHttps = !host.includes(':') || host.startsWith('https');
		const mod = isHttps ? https : http;

		const options = {
			hostname: host.replace(/:\d+$/, ''),
			port: host.match(/:(\d+)$/)?.[1] || (isHttps ? 443 : 80),
			path,
			method,
			headers: {
				...headers,
				...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}),
			},
		};

		const req = mod.request(options, (res) => {
			let data = '';
			res.on('data', (chunk) => (data += chunk));
			res.on('end', () => {
				if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
					resolve(JSON.parse(data));
				} else {
					const errorMsg = (() => {
						try {
							const parsed = JSON.parse(data);
							return parsed.message || parsed.error || parsed.errors || data;
						} catch {
							return data;
						}
					})();
					reject(new Error(`API ${res.statusCode}: ${JSON.stringify(errorMsg)}`));
				}
			});
		});

		req.on('error', reject);
		if (body) { req.write(body); }
		req.end();
	});
}
