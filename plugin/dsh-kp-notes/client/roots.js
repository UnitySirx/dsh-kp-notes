/*
 * dsh-kp-notes — 客户端的学习画布目录管理。
 *
 * 面板顶上那一层(「我的学习画布」)要做的事都在这儿:
 *   1. 根目录: 一个输入框 + 一个「选择…」按钮(走宿主 uiWorkspace.pickDirectory)。选中一个
 *      根目录, **所有画布都在它下面** —— 它下面每个带 notes/ 或 questions/ 的子目录就是一张画布,
 *      新建的画布也建在它下面, 模板共用 <根>/.templates。弹窗里顺手把这个目录扫给用户看
 *      (发号会写盘, 所以预览走 api.fetchLibrary 的 uids:false = 只读不写);
 *   2. 新建 / 改名 / 移出列表: 目录名就是画布名, 改名就是重命名磁盘目录, 移出列表是把目录搬进
 *      同层的 .remove/ 并记一条墓碑(内容原样留着, 想恢复手工搬回来或者用工具条的回收站);
 *   3. 扫盘核对: 磁盘上已经不在的画布从列表里拿掉(probeRoot 问 host 的 ?path= 浏览接口 exists)。
 *
 * 依赖一律从外面传进来(deps 里是 React / api / 面板和 store 的成员), 模块之间不互相 import。
 */
export function createRoots({ React, api }) {
	const { useState, useEffect, createElement: h } = React;
	const {
		readDefaultRoot, writeDefaultRoot, readRoots, fetchLibrary, postRoot, baseNameOf,
	} = api;

	function useRoots({ t, storeBag, setRootPath, rootPath, dirPicker }) {
		const {
			roots, setRoots, saveRoots, loadRootStats, markRemoved, unmarkRemoved, isRemoved,
			saveLib, flash, setLibRev, setLibTick,
		} = storeBag;
		const [rootInfo, setRootInfo] = useState(null);
		const [rootDialog, setRootDialog] = useState(null);
		/* 根目录弹窗: { path, busy, picking, error, scan, scanning } */
		const [rootDirDialog, setRootDirDialog] = useState(null);
		const enterRoot = (entry) => setRootPath(entry.path);
		const leaveRoot = () => setRootPath(null);
		const openNewRoot = () => setRootDialog({ mode: 'new', name: '', path: '', busy: false, error: null });
		const openRenameRoot = (entry) => setRootDialog({ mode: 'rename', name: entry.name, path: entry.path, busy: false, error: null });
		/* 新学习画布的默认落点: 根目录(所有画布都在它下面); 还没设根目录就用 host 建议的父目录 */
		const canvasParent = () => readDefaultRoot() || (rootInfo && rootInfo.suggestParent) || '/';
		/* 这个路径在这个根目录里 —— 画布就是根目录的自己或它的下一层(见 lib/routes.js 的 scanLibrary) */
		const underRoot = (path, root) => !!(path && root) && (path === root || path.indexOf(root + '/') === 0);
		const parentOfPath = (value) => {
			const cut = String(value).replace(/\/+$/, '').lastIndexOf('/');
			return cut > 0 ? String(value).slice(0, cut) : '';
		};

		/* 磁盘上这张画布还在不在 —— host 的 ?path= 浏览接口会带回 exists */
		const probeRoot = async (path) => {
			try {
				const data = await fetchLibrary(path);
				return !data || data.exists !== false;
			} catch (error) {
				return true;
			}
		};

		/* 「移出列表」= 把画布目录移到同一层的 .remove/ 里(内容原样保留, 想恢复手工移回上一层),
		 * 再记成墓碑从列表里拿掉。移动失败(比如没权限)也只是记墓碑, 不挡用户。 */
		const forgetRoot = async (entry) => {
			try {
				await postRoot({ action: 'remove', path: entry.path });
			} catch (error) {
				/* 移动不成功也照样移出列表 */
			}
			markRemoved(entry.path);
			const list = roots.filter((item) => item.path !== entry.path);
			setRoots(list);
			saveRoots(list);
			loadRootStats(list);
			/* 这个画布没了, 它的视野记录顺手删掉 */
			saveLib({ zoom: { [entry.path]: null } });
			flash(t('rootRemoved'));
		};

		const submitRootDialog = async () => {
			const dialog = rootDialog;
			if (!dialog || dialog.busy) return;
			const name = String(dialog.name || '').trim();
			if (dialog.mode === 'rename') {
				if (name === '') {
					setRootDialog({ ...dialog, error: t('rootNeedName') });
					return;
				}
				setRootDialog({ ...dialog, busy: true, error: null });
				try {
					/* 改名 = 直接重命名磁盘目录(目录名就是画布名), 列表里的路径跟着换 */
					const result = await postRoot({ action: 'rename', path: dialog.path, name });
					const list = roots.map((item) => (item.path === dialog.path ? { ...item, path: result.root, name } : item));
					setRoots(list);
					saveRoots(list);
					/* 换路径了: 旧路径的视野记在库配置里, 顺手删掉那份 */
					saveLib({ zoom: { [dialog.path]: null } });
					if (rootPath === dialog.path) setRootPath(result.root);
					setRootDialog(null);
					loadRootStats(list);
					flash(t('rootRenamed'));
				} catch (error) {
					const code = (error && error.code) || '';
					const fallback = String((error && error.message) || error);
					setRootDialog({ ...dialog, busy: false, error: code === 'name-taken' ? t('rootNameTaken') : fallback });
				}
				return;
			}
			/* 有根目录时弹窗只填名字, 路径就是根目录 + 名字; 还没设根目录才需要路径 */
			const path = String(dialog.path || '').trim() || (name ? canvasParent() + '/' + name : '');
			if (path === '') {
				setRootDialog({ ...dialog, error: t('rootNeedPath') });
				return;
			}
			setRootDialog({ ...dialog, busy: true, error: null });
			try {
				/* 画布建在根目录里时, 模板写进那个库的 .templates, 画布自己不再存一份 */
				const library = readDefaultRoot();
				const payload = { path, name };
				if (underRoot(path, library)) payload.library = library;
				const result = await postRoot(payload);
				const created = { path: result.root, name: name || result.name || baseNameOf(result.root) };
				/* 在同一个路径重新建画布 ⇒ 解除墓碑 */
				unmarkRemoved(created.path);
				const list = roots.some((item) => item.path === created.path) ? roots : roots.concat([created]);
				setRoots(list);
				saveRoots(list);
				setRootDialog(null);
				loadRootStats(list);
				flash(t('rootCreated'));
			} catch (error) {
				const code = (error && error.code) || '';
				const fallback = String((error && error.message) || error);
				setRootDialog({ ...dialog, busy: false, error: code === 'name-taken' ? t('rootNameTaken') : fallback });
			}
		};

		/* ---- 根目录: 一个输入框 + 一个「选择…」按钮(弹宿主的原生目录选择窗体) ----
		 * 设成根目录之后, 画布列表 = 这个目录的直接子目录(见 client.js 那一层与 lib/routes.js 的 scanLibrary)。 */
		const openRootDir = () => {
			const current = readDefaultRoot() || '';
			setRootDirDialog({ path: current, busy: false, picking: false, error: null, scan: null, scanning: current !== '' });
		};

		/* 弹宿主的目录选择窗体(uiWorkspace.pickDirectory), 选中后把绝对路径填进输入框 */
		const chooseRootDir = async () => {
			const dialog = rootDirDialog;
			if (!dialog || dialog.busy || dialog.picking) return;
			if (typeof dirPicker.pick !== 'function') {
				setRootDirDialog({ ...dialog, error: t('libNoPicker') });
				return;
			}
			setRootDirDialog({ ...dialog, picking: true, error: null });
			try {
				const picked = await dirPicker.pick();
				setRootDirDialog((current) => {
					if (!current) return current;
					const path = String(picked || '').trim().replace(/\/+$/, '');
					return path === '' ? { ...current, picking: false, error: null } : { ...current, picking: false, error: null, path, scan: null, scanning: true };
				});
			} catch (error) {
				setRootDirDialog((current) =>
					current ? { ...current, picking: false, error: String((error && error.message) || error) } : current,
				);
			}
		};

		/* 输入框里的路径变了就顺手扫一眼(350ms 防抖): 按下「设为根目录」之前先让用户看到会收进来哪几张画布。
		 * 只读预览(uids:false = 不发号、不写号池); 扫不动就算了(交给提交那一步报错, 免得边打字边飘红)。 */
		const rootDirPath = rootDirDialog ? String(rootDirDialog.path || '') : '';
		const rootDirOpen = rootDirDialog !== null;
		useEffect(() => {
			if (!rootDirOpen) return undefined;
			const path = rootDirPath.trim().replace(/\/+$/, '') || '/';
			if (path.charAt(0) !== '/') return undefined;
			let alive = true;
			const timer = window.setTimeout(() => {
				fetchLibrary(path, { uids: false })
					.then((scan) => {
						if (!alive) return;
						setRootDirDialog((current) => (current && current.path === rootDirPath ? { ...current, scan, scanning: false } : current));
					})
					.catch(() => {
						if (!alive) return;
						setRootDirDialog((current) => (current && current.path === rootDirPath ? { ...current, scan: null, scanning: false } : current));
					});
			}, 350);
			return () => {
				alive = false;
				window.clearTimeout(timer);
			};
		}, [rootDirOpen, rootDirPath]);

		const runSetRoot = async () => {
			const dialog = rootDirDialog;
			if (!dialog || dialog.busy) return;
			const path = String(dialog.path || '').trim().replace(/\/+$/, '') || '/';
			if (path.charAt(0) !== '/') {
				setRootDirDialog({ ...dialog, error: t('libNeedAbs') });
				return;
			}
			setRootDirDialog({ ...dialog, busy: true, error: null });
			try {
				/* 提交前自己再确认一次: 「这个目录自己就是一张画布」的目录不能当根目录(它下面才是画布) */
				const probe = await fetchLibrary(path, { uids: false });
				if (probe && probe.isCanvas === true) {
					setRootDirDialog({ ...dialog, busy: false, scanning: false, scan: probe, error: t('rootDirSelf').split('{path}').join(probe.parent || parentOfPath(path)) });
					return;
				}
				const result = await postRoot({ path, action: 'import' });
				if (!result || result.ok === false) throw new Error((result && result.message) || 'import failed');
				if (result.canvas) {
					/* host 也认为这个目录自己就是画布(探针没问成时才会走到这儿) */
					setRootDirDialog({ ...dialog, busy: false, scanning: false, error: t('rootDirSelf').split('{path}').join(parentOfPath(path)) });
					return;
				}
				/* 设成根目录 = 用户明确要这个库 ⇒ 清掉这个根与它下面画布的墓碑, 列表就按这次扫盘的结果来 */
				unmarkRemoved(path);
				const list = [];
				for (const item of result.canvases || []) {
					const itemPath = item && typeof item.path === 'string' ? item.path : '';
					if (itemPath === '' || itemPath.charAt(0) !== '/') continue;
					if (!underRoot(itemPath, path)) continue;
					unmarkRemoved(itemPath);
					if (list.some((entry) => entry.path === itemPath)) continue;
					list.push({ path: itemPath, name: String(item.name || '').trim() || baseNameOf(itemPath) });
				}
				/* 这个目录从此就是这个库: 所有画布都在它下面, 新建的画布也建在它下面, 模板共用它的 .templates */
				writeDefaultRoot(path);
				saveRoots(list);
				setRoots(list.slice());
				loadRootStats(list);
				setLibRev((value) => value + 1); /* 换库了: 重新读一次这个库的 .config */
				setLibTick((value) => value + 1);
				setRootDirDialog(null);
				const name = baseNameOf(path) || path;
				flash(
					list.length > 0
						? t('rootDirSet').split('{name}').join(name).split('{n}').join(String(list.length))
						: t('rootDirSetNone').split('{name}').join(name),
				);
			} catch (error) {
				setRootDirDialog({ ...dialog, busy: false, scanning: false, error: String((error && error.message) || error) });
			}
		};

		const renderRootDirDialog = () => {
			const dialog = rootDirDialog;
			const current = readDefaultRoot();
			const scan = dialog.scan;
			const found = scan && Array.isArray(scan.canvases) ? scan.canvases : [];
			const dirs = scan && Array.isArray(scan.dirs) ? scan.dirs : [];
			const others = Math.max(0, dirs.length - found.length);
			const switching = !!current && current !== (String(dialog.path || '').trim().replace(/\/+$/, '') || '/');
			const rows = [];
			if (scan) {
				rows.push(
					h(
						'div',
						{ className: 'rk-settings-hint', key: 'scan' },
						found.length > 0
							? t('rootDirCount') + ' ' + found.length + ' ' + t('libUnit') + '：' + found.slice(0, 12).map((item) => item.name).join('、') + (found.length > 12 ? ' …' : '')
							: t('rootDirNone'),
					),
				);
				if (others > 0) rows.push(h('div', { className: 'rk-settings-hint', key: 'others' }, t('rootDirOther') + ' ' + others + ' ' + t('libUnit')));
				if (scan.truncated) rows.push(h('div', { className: 'rk-settings-hint', key: 'trunc' }, t('libTruncated')));
				if (scan.exists === false) rows.push(h('div', { className: 'rk-settings-hint', key: 'fresh' }, t('libExistsNo')));
			} else if (dialog.scanning) {
				rows.push(h('div', { className: 'rk-settings-hint', key: 'scan' }, t('libScanning')));
			}
			if (current) rows.push(h('div', { className: 'rk-settings-hint', key: 'current' }, t('rootDirCurrent') + '：' + current));
			if (switching) rows.push(h('div', { className: 'rk-settings-hint', key: 'switch' }, t('rootDirSwitching')));
			return h(
				'div',
				{ className: 'rk-modal', onClick: () => setRootDirDialog(null) },
				h(
					'div',
					{ className: 'rk-modal-card rk-settings', onClick: (event) => event.stopPropagation() },
					h('div', { className: 'rk-modal-title' }, '⌂ ' + t('rootDirTitle')),
					h('div', { className: 'rk-settings-label' }, t('rootDirLabel')),
					h(
						'div',
						{ className: 'rk-librow' },
						h('input', {
							className: 'rk-input',
							autoFocus: true,
							spellCheck: false,
							value: dialog.path,
							placeholder: '/绝对路径',
							onChange: (event) => {
								const value = event.target.value;
								setRootDirDialog((state) => (state ? { ...state, path: value, error: null, scan: null, scanning: true } : state));
							},
							onKeyDown: (event) => {
								if (event.key === 'Enter') {
									event.preventDefault();
									runSetRoot();
								}
								if (event.key === 'Escape') setRootDirDialog(null);
							},
						}),
						h(
							'button',
							{
								className: 'rk-btn rk-ghost',
								type: 'button',
								disabled: dialog.busy || dialog.picking || typeof dirPicker.pick !== 'function',
								title: typeof dirPicker.pick === 'function' ? '' : t('libNoPicker'),
								onClick: chooseRootDir,
							},
							dialog.picking ? t('libPicking') : t('libChoose'),
						),
					),
					h('div', { className: 'rk-settings-hint' }, t('rootDirPickHint')),
					h('div', { className: 'rk-settings-hint' }, t('rootDirHint')),
					...rows,
					dialog.error ? h('div', { className: 'rk-rootdialog-error' }, dialog.error) : null,
					h(
						'div',
						{ className: 'rk-row', style: { justifyContent: 'flex-end', marginTop: 12, gap: 8 } },
						h('button', { className: 'rk-btn rk-ghost', type: 'button', onClick: () => setRootDirDialog(null) }, t('cancel')),
						scan && scan.isCanvas === true && scan.parent
							? h(
									'button',
									{
										className: 'rk-btn rk-ghost',
										type: 'button',
										onClick: () => setRootDirDialog((state) => (state ? { ...state, path: scan.parent, error: null, scan: null, scanning: true } : state)),
									},
									t('rootDirUseParent'),
								)
							: null,
						h(
							'button',
							{ className: 'rk-btn rk-primary', type: 'button', disabled: dialog.busy, onClick: runSetRoot },
							dialog.busy ? t('saving') : t('rootDirSetGo'),
						),
					),
				),
			);
		};
		return {
			rootInfo, setRootInfo, rootDialog, setRootDialog, rootDirDialog, setRootDirDialog,
			enterRoot, leaveRoot, openNewRoot, openRenameRoot, canvasParent, probeRoot, forgetRoot,
			submitRootDialog, openRootDir, chooseRootDir, runSetRoot, renderRootDirDialog,
		};
	}

	return { useRoots };
}
