/*
 * dsh-kp-notes — 客户端的 Git 提交面板。
 *
 * 面板本身(宿主 client/dialogs.js 里的 GitDialog)只管画; 这里管状态与动作:
 *   1. 角标数字: 一级画布 = 整个学习库的未提交改动, 画布 = 这张画布 notes/ 范围内的改动;
 *   2. 提交(可选顺手推送) / 仅推送 / 拉取(不提交, fetch+merge 下来, 冲突留给用户);
 *   3. 让模型读一遍改动清单, 给几条候选 commit message。
 *
 * 依赖一律从外面传进来(deps 里是 React 与 api 模块的成员), 模块之间不互相 import。
 */
export function createGitPanel({ React, api }) {
	const { useState, useCallback } = React;
	const { useGit, postGit, defaultGitMessage } = api;

	function useGitPanel({ t, gitRoot, gitScope, level1, reload, flash, setRootTick }) {
		const { data: gitData, error: gitError, reload: gitReload } = useGit(gitRoot !== '', gitRoot, gitScope);
		const [gitOpen, setGitOpen] = useState(false);
		const [gitBusy, setGitBusy] = useState(null);
		const [gitResult, setGitResult] = useState(null);
		const [gitForm, setGitForm] = useState({ scope: 'notes', message: '' });
		const [gitAi, setGitAi] = useState({ busy: false, candidates: [], error: null });
		const gitCounts = (gitData && gitData.counts) || { plugin: 0, notes: 0, other: 0, total: 0 };
		/* 角标: 一级画布 = 整个学习库的未提交改动; 画布 = 这张画布 notes/ 范围内的改动 */
		const gitPending = (gitData && (typeof gitData.scopeTotal === 'number' ? gitData.scopeTotal : (level1 ? gitCounts.total : gitCounts.notes))) || 0;
		const gitOutside = Math.max(0, gitCounts.total - gitPending);
		const openGit = useCallback(() => {
			setGitResult(null);
			setGitAi({ busy: false, candidates: [], error: null });
			setGitForm({ scope: gitScope, message: defaultGitMessage(t, gitData, gitScope) });
			setGitOpen(true);
			gitReload(true);
		}, [gitData, gitReload, t, gitScope]);
		/* 让模型读一遍改动清单, 给几条候选 commit message(第 1 条自动填进去) */
		const generateGitMessage = useCallback(async () => {
			setGitAi({ busy: true, candidates: [], error: null });
			try {
				const data = await postGit({ action: 'message', scope: gitScope }, gitRoot);
				const candidates = (data && data.candidates) || [];
				setGitAi({ busy: false, candidates, error: data && data.ok === false ? data.message || data.error || 'ai-failed' : null });
				if (candidates.length > 0) setGitForm((form) => Object.assign({}, form, { message: candidates[0] }));
			} catch (error) {
				setGitAi({ busy: false, candidates: [], error: (error && error.message) || String(error) });
			}
		}, [gitScope]);
		const submitGit = useCallback(
			async (push) => {
				setGitBusy(push === true ? 'push' : 'commit');
				setGitResult(null);
				try {
					const data = await postGit({ action: 'commit', message: gitForm.message.trim(), scope: gitScope, push: push === true }, gitRoot);
					setGitResult({ ok: data.ok === true, data });
					if (data.ok === true) flash(data.committed === 0 && data.pushed ? t('gitPushed') : t('gitCommitted') + (data.hash ? ' · ' + data.hash : '') + (data.pushed ? ' · ' + t('gitPushed') : ''));
					/* 提交时顺手合并过远程更新: 磁盘上的笔记变了, 让列表重扫一遍 */
					if (data.ok === true && data.pull && data.pull.skipped !== true && data.pull.upToDate !== true) {
						setRootTick((value) => value + 1);
						if (!level1) reload(true);
					}
				} catch (error) {
					setGitResult({ ok: false, error: (error && error.message) || String(error) });
				} finally {
					setGitBusy(null);
					gitReload(true);
				}
			},
			[flash, gitForm.message, gitReload, level1, reload, t, gitScope],
		);
		/* 拉取: 不提交, 只把远程更新 fetch+merge 下来(冲突保留给用户解决), 拉完重扫画布 */
		const pullGit = useCallback(async () => {
			setGitBusy('pull');
			setGitResult(null);
			try {
				const data = await postGit({ action: 'pull' }, gitRoot);
				setGitResult({ ok: data.ok === true, data });
				if (data.ok === true) {
					flash(data.upToDate === true ? t('gitUpToDate') : t('gitPulled'));
					setRootTick((value) => value + 1);
					if (!level1) await reload(true);
				}
			} catch (error) {
				setGitResult({ ok: false, error: (error && error.message) || String(error) });
			} finally {
				setGitBusy(null);
				gitReload(true);
			}
		}, [flash, gitReload, level1, reload, t]);
		/* 仅推送: 不提交, 直接把本地已有的提交推到远程 */
		const pushOnlyGit = useCallback(async () => {
			setGitBusy('pushonly');
			setGitResult(null);
			try {
				const data = await postGit({ action: 'push' }, gitRoot);
				setGitResult({ ok: data.ok === true, data });
				if (data.ok === true) flash(t('gitPushed'));
			} catch (error) {
				setGitResult({ ok: false, error: (error && error.message) || String(error) });
			} finally {
				setGitBusy(null);
				gitReload(true);
			}
		}, [flash, gitReload, t]);
		return {
			gitData, gitError, gitReload, gitCounts, gitPending, gitOutside,
			gitOpen, setGitOpen, gitBusy, gitResult, gitForm, setGitForm, gitAi, setGitAi,
			openGit, generateGitMessage, submitGit, pullGit, pushOnlyGit,
		};
	}

	return { useGitPanel };
}
