/*
 * dsh-kp-notes — 客户端的学习画布目录管理。
 *
 * 面板顶上那一层(「我的学习画布」)要做的事都在这儿:
 *   1. 新建 / 改名 / 移出列表: 目录名就是画布名, 改名就是重命名磁盘目录, 移出列表是把目录搬进
 *      同层的 .remove/ 并记一条墓碑(内容原样留着, 想恢复手工搬回来或者用工具条的回收站);
 *   2. 扫盘核对: 磁盘上已经不在的画布从列表里拿掉(probeRoot 问 host 的 ?path= 浏览接口 exists);
 *   3. 导入学习库: 一个输入框 + 一个「选择…」按钮(走宿主 uiWorkspace.pickDirectory),
 *      导入后新建的画布默认建在它下面, 模板共用它的 .templates。
 *
 * 依赖一律从外面传进来(deps 里是 React / api / 面板和 store 的成员), 模块之间不互相 import。
 */
export function createRoots({ React, api }) {
	const { useState, createElement: h } = React;
	const {
		readDefaultRoot, writeDefaultRoot, readRoots, fetchLibrary, postRoot, baseNameOf,
	} = api;

	function useRoots({ t, storeBag, setRootPath, rootPath, dirPicker }) {
		const {
			roots, setRoots, saveRoots, loadRootStats, markRemoved, unmarkRemoved, saveLib, flash, setLibRev,
		} = storeBag;
		const [rootInfo, setRootInfo] = useState(null);
		const [rootDialog, setRootDialog] = useState(null);
		const [libraryDialog, setLibraryDialog] = useState(null);
		const enterRoot = (entry) => setRootPath(entry.path);
		const leaveRoot = () => setRootPath(null);
		const openNewRoot = () => setRootDialog({ mode: 'new', name: '', path: '', busy: false, error: null });
		const openRenameRoot = (entry) => setRootDialog({ mode: 'rename', name: entry.name, path: entry.path, busy: false, error: null });
		/* 新学习画布的默认落点: 导入学习库时记下的那个目录(新画布都建在它下面); 没导入过就用 host 建议的父目录 */
		const canvasParent = () => readDefaultRoot() || (rootInfo && rootInfo.suggestParent) || '/';

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
			const path = String(dialog.path || '').trim() || (name ? canvasParent() + '/' + name : '');
			if (path === '') {
				setRootDialog({ ...dialog, error: t('rootNeedPath') });
				return;
			}
			setRootDialog({ ...dialog, busy: true, error: null });
			try {
				/* 画布建在学习库里时, 模板写进那个库的 .templates, 画布自己不再存一份 */
				const library = readDefaultRoot();
				const payload = { path, name };
				if (library && (path === library || path.indexOf(library + '/') === 0)) payload.library = library;
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

		/* ---- 导入目录: 一个输入框 + 一个「选择…」按钮(弹宿主的原生目录选择窗体) ---- */
		const openImportLib = () => {
			setLibraryDialog({ path: readDefaultRoot() || '', busy: false, picking: false, error: null });
		};

		/* 弹宿主的目录选择窗体(uiWorkspace.pickDirectory), 选中后把绝对路径填进输入框 */
		const chooseLibraryDir = async () => {
			const dialog = libraryDialog;
			if (!dialog || dialog.busy || dialog.picking) return;
			if (typeof dirPicker.pick !== 'function') {
				setLibraryDialog({ ...dialog, error: t('libNoPicker') });
				return;
			}
			setLibraryDialog({ ...dialog, picking: true, error: null });
			try {
				const picked = await dirPicker.pick();
				setLibraryDialog((current) => {
					if (!current) return current;
					const path = String(picked || '').trim().replace(/\/+$/, '');
					return { ...current, picking: false, error: null, path: path === '' ? current.path : path };
				});
			} catch (error) {
				setLibraryDialog((current) =>
					current ? { ...current, picking: false, error: String((error && error.message) || error) } : current,
				);
			}
		};

		const runImportLib = async () => {
			const dialog = libraryDialog;
			if (!dialog || dialog.busy) return;
			const path = String(dialog.path || '').trim().replace(/\/+$/, '') || '/';
			if (path.charAt(0) !== '/') {
				setLibraryDialog({ ...dialog, error: t('libNeedAbs') });
				return;
			}
			setLibraryDialog({ ...dialog, busy: true, error: null });
			try {
				const result = await postRoot({ path, action: 'import' });
				if (!result || result.ok === false) throw new Error((result && result.message) || 'import failed');
				/* 导入 = 用户明确要这个库 ⇒ 清掉这些画布的墓碑, 再和这次扫盘的结果合并 */
				unmarkRemoved(path);
				const list = readRoots().slice();
				let added = 0;
				for (const item of result.canvases || []) {
					if (!item || typeof item.path !== 'string' || item.path.charAt(0) !== '/') continue;
					unmarkRemoved(item.path);
					if (list.some((entry) => entry.path === item.path)) continue;
					list.push({ path: item.path, name: String(item.name || '').trim() || baseNameOf(item.path) });
					added += 1;
				}
				saveRoots(list);
				setRoots(list.slice());
				loadRootStats(list);
				setLibraryDialog(null);
				/* 这个目录本身就是一张画布 ⇒ 只登记进列表, 不写盘、也不拿它当库(host 那半边判断的) */
				if (result.canvas) {
					flash(t('libImportedCanvas').split('{n}').join(baseNameOf(path) || path));
					return;
				}
				/* 导入的这个目录从此就是这个库: 以后新建的画布默认建在它下面, 模板也共用它的 .templates */
				writeDefaultRoot(path);
				setLibRev((value) => value + 1); /* 换库了: 重新读一次这个库的 .config */
				flash(added > 0 ? t('libImported').split('{n}').join(String(added)) : t('libImportedNone'));
			} catch (error) {
				setLibraryDialog({ ...dialog, busy: false, error: String((error && error.message) || error) });
			}
		};

		const renderLibraryDialog = () => {
			return h(
				'div',
				{ className: 'rk-modal', onClick: () => setLibraryDialog(null) },
				h(
					'div',
					{ className: 'rk-modal-card rk-settings', onClick: (event) => event.stopPropagation() },
					h('div', { className: 'rk-modal-title' }, '⇪ ' + t('libTitle')),
					h('div', { className: 'rk-settings-label' }, t('libLabel')),
					h(
						'div',
						{ className: 'rk-librow' },
						h('input', {
							className: 'rk-input',
							autoFocus: true,
							spellCheck: false,
							value: libraryDialog.path,
							placeholder: '/绝对路径',
							onChange: (event) => {
								const value = event.target.value;
								setLibraryDialog((dialog) => (dialog ? { ...dialog, path: value, error: null } : dialog));
							},
							onKeyDown: (event) => {
								if (event.key === 'Enter') {
									event.preventDefault();
									runImportLib();
								}
								if (event.key === 'Escape') setLibraryDialog(null);
							},
						}),
						h(
							'button',
							{
								className: 'rk-btn rk-ghost',
								type: 'button',
								disabled: libraryDialog.busy || libraryDialog.picking || typeof dirPicker.pick !== 'function',
								title: typeof dirPicker.pick === 'function' ? '' : t('libNoPicker'),
								onClick: chooseLibraryDir,
							},
							libraryDialog.picking ? t('libPicking') : t('libChoose'),
						),
					),
					h('div', { className: 'rk-settings-hint' }, t('libPickHint')),
					h('div', { className: 'rk-settings-hint' }, t('libHint')),
					libraryDialog.error ? h('div', { className: 'rk-rootdialog-error' }, libraryDialog.error) : null,
					h(
						'div',
						{ className: 'rk-row', style: { justifyContent: 'flex-end', marginTop: 12, gap: 8 } },
						h('button', { className: 'rk-btn rk-ghost', type: 'button', onClick: () => setLibraryDialog(null) }, t('cancel')),
						h(
							'button',
							{ className: 'rk-btn rk-primary', type: 'button', disabled: libraryDialog.busy, onClick: runImportLib },
							libraryDialog.busy ? t('saving') : t('libImportGo'),
						),
					),
				),
			);
		};
		return {
			rootInfo, setRootInfo, rootDialog, setRootDialog, libraryDialog, setLibraryDialog,
			enterRoot, leaveRoot, openNewRoot, openRenameRoot, canvasParent, probeRoot, forgetRoot,
			submitRootDialog, openImportLib, chooseLibraryDir, runImportLib, renderLibraryDialog,
		};
	}

	return { useRoots };
}
