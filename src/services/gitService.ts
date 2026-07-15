import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface GitStatus {
	branch: string;
	changedFiles: number;
	isDirty: boolean;
	isDetached: boolean;
	hasConflicts: boolean;
	isRebasing: boolean;
}

export interface PublishResult {
	repoName: string;
	repoPath: string;
	success: boolean;
	error?: string;
}

export class GitService {
	private async git(cwd: string, ...args: string[]): Promise<string> {
		const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
		return stdout.trim();
	}

	async getStatus(repoPath: string): Promise<GitStatus> {
		const [branch, statusOutput, rebaseCheck] = await Promise.all([
			this.git(repoPath, 'rev-parse', '--abbrev-ref', 'HEAD').catch(() => 'unknown'),
			this.git(repoPath, 'status', '--porcelain').catch(() => ''),
			this.git(repoPath, 'rev-parse', '--git-path', 'rebase-merge').catch(() => ''),
		]);

		const lines = statusOutput.split('\n').filter(l => l.length > 0);
		const hasConflicts = lines.some(l => l.startsWith('UU') || l.startsWith('AA') || l.startsWith('DD'));

		const { existsSync } = await import('fs');
		const { join } = await import('path');
		const isRebasing = existsSync(join(repoPath, '.git', 'rebase-merge'))
			|| existsSync(join(repoPath, '.git', 'rebase-apply'));

		return {
			branch: branch === 'HEAD' ? 'detached' : branch,
			changedFiles: lines.length,
			isDirty: lines.length > 0,
			isDetached: branch === 'HEAD',
			hasConflicts,
			isRebasing,
		};
	}

	async getRemoteUrl(repoPath: string): Promise<string | null> {
		try {
			return await this.git(repoPath, 'remote', 'get-url', 'origin');
		} catch {
			return null;
		}
	}

	async switchCreateBranch(repoPath: string, branchName: string): Promise<void> {
		await this.git(repoPath, 'switch', '-c', branchName);
	}

	async addAll(repoPath: string): Promise<void> {
		await this.git(repoPath, 'add', '-A');
	}

	async commit(repoPath: string, message: string): Promise<void> {
		await this.git(repoPath, 'commit', '-m', message);
	}

	async push(repoPath: string, branchName: string): Promise<void> {
		await this.git(repoPath, 'push', '-u', 'origin', branchName);
	}

	async stashChanges(repoPath: string, message: string): Promise<void> {
		await this.git(repoPath, 'stash', 'push', '-u', '-m', message);
	}

	async discardChanges(repoPath: string): Promise<void> {
		await this.git(repoPath, 'checkout', '--', '.');
		await this.git(repoPath, 'clean', '-fd').catch(() => {});
	}

	async switchBack(repoPath: string, originalBranch: string): Promise<void> {
		try {
			await this.git(repoPath, 'switch', originalBranch);
		} catch {
			// best effort
		}
	}

	async branchExists(repoPath: string, branchName: string): Promise<boolean> {
		try {
			await this.git(repoPath, 'rev-parse', '--verify', branchName);
			return true;
		} catch {
			return false;
		}
	}

	async getDefaultBranch(repoPath: string): Promise<string> {
		try {
			const ref = await this.git(repoPath, 'symbolic-ref', 'refs/remotes/origin/HEAD');
			return ref.replace('refs/remotes/origin/', '');
		} catch {
			// Fallback: check if master or main exists
			for (const branch of ['master', 'main']) {
				if (await this.branchExists(repoPath, branch)) {
					return branch;
				}
			}
			return 'master';
		}
	}

	async isClean(repoPath: string): Promise<boolean> {
		const status = await this.getStatus(repoPath);
		return !status.isDirty;
	}
}
