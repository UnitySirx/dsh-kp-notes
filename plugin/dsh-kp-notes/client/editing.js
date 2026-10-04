/*
 * dsh-kp-notes — 客户端的「打开 / 编辑 / 新建 / 删除」。
 *
 * 面板里所有会写盘的动作都在这儿: 小节与知识点的打开与编辑、新建小节 / 章节、章节改名、
 * 题目片段的新增与编辑、删除小节 / 章节 / 题目片段, 以及舞台与卡片上的右键菜单内容。
 *
 * 写盘一律走 postAction(宿主 routes.js 的 POST), 写完 flash 一句再 reload(true) 重新读目录;
 * 面包屑 / 错误提示用面板传进来的 pathLabel / pointError / questionError。
 * 依赖一律从外面传进来(deps 里是 React / api / 面板的成员), 模块之间不互相 import。
 */
export function createEditing({ React, api }) {
	const { useCallback } = React;
	const { fetchFile, fetchPoint, postAction } = api;

	function useEditing({
		t, flash, reload, pathLabel, pointError, questionError,
		openMenu, openNewRoot, fitView, openSection, mapReady, mind, level1,
		setRoute, setSaving, editor, setEditor,
		nameDialog, setNameDialog, pointDialog, setPointDialog, questionDialog, setQuestionDialog,
	}) {
		const openEditorForSection = useCallback(
			async (path) => {
				try {
					const file = await fetchFile(path);
					setEditor({ mode: 'edit', path, markdown: file.markdown, title: file.title });
				} catch (problem) {
					flash('读取失败：' + ((problem && problem.message) || problem));
				}
			},
			[flash],
		);

		/* 编辑某道题: 打开可视化表单(选择题 / 案例题), 需要时再跳到原始 markdown */
		const editQuestion = useCallback(
			(item, point) => {
				if (!item) return;
				const options = (item.options || []).map((option) => ({ text: option.text }));
				setQuestionDialog({
					mode: 'edit',
					pointPath: (point && point.path) || item.path || '',
					pointTitle: (point && point.title) || '',
					path: item.path || null,
					order: item.order || null,
					kind: options.length >= 2 ? 'choice' : 'case',
					stem: item.stem || '',
					options,
					answerKey: item.answerKey || '',
					answerText: item.answerText || '',
					explanation: item.explanation || '',
				});
			},
			[],
		);

		/* 编辑知识点: 先向宿主取这个知识点的准确标题/标签/正文, 再开弹窗 */
		const editPoint = useCallback(
			async (point) => {
				if (!point) return;
				const path = String(point.path || '').trim();
				if (path === '') {
					flash(t('loadFailed') + '：' + t('pointMissing'));
					return;
				}
				try {
					const data = await fetchPoint(path, point.title || '');
					setPointDialog({
						path: data.path || path,
						mode: data.mode || 'file',
						key: point.title || data.title || '',
						title: data.title || point.title || '',
						tags: (data.tags || []).join(', '),
						body: data.body || '',
					});
				} catch (problem) {
					flash(t('loadFailed') + '：' + pointError((problem && problem.message) || problem, t));
				}
			},
			[flash, t],
		);

		/* 弹窗 -> 宿主: savePoint 只换这一个知识点的标题/标签/正文 */
		const submitPoint = useCallback(
			async (form) => {
				try {
					const saved = await postAction({
						action: 'savePoint',
						path: form.path,
						key: form.key,
						title: form.title,
						body: form.body,
						tags: form.mode === 'file' ? form.tags : undefined,
					});
					flash(t('pointSaved') + ' · ' + pathLabel(saved.path));
					setPointDialog(null);
					await reload(true);
					return { ok: true, path: saved.path };
				} catch (problem) {
					return { error: pointError((problem && problem.message) || problem, t) };
				}
			},
			[flash, reload, t],
		);

		/* 逃生入口: 先存下弹窗里的改动, 再打开原始 markdown 抽屉, 不丢输入 */
		const rawPoint = useCallback(
			async (form) => {
				const target = (pointDialog && pointDialog.path) || form.path;
				const result = await submitPoint(form);
				if (result && result.error) return result;
				await openEditorForSection(target);
				return { ok: true };
			},
			[openEditorForSection, pointDialog, submitPoint],
		);

		const startNewSection = useCallback((dir) => setEditor({ mode: 'newSection', dir, title: '', markdown: '' }), []);
		/* 新建章节 = 只输入一个名称, 目录由宿主创建; 改名同理 */
		const startNewChapter = useCallback(() => setNameDialog({ mode: 'newChapter', dir: 'notes', value: '' }), []);
		const startRenameChapter = useCallback(
			(chapter) => setNameDialog({ mode: 'rename', dir: chapter.dir, value: chapter.name || chapter.title }),
			[],
		);

		const submitChapterName = useCallback(
			async (raw) => {
				const clean = String(raw || '').trim();
				if (clean === '') {
					flash('章节名不能为空');
					return;
				}
				const target = nameDialog;
				if (!target) return;
				try {
					if (target.mode === 'newChapter') {
						const created = await postAction({ action: 'newChapter', parent: target.dir, title: clean });
						flash('已新建章节 · ' + created.dir);
					} else {
						const renamed = await postAction({ action: 'renameChapter', dir: target.dir, title: clean });
						flash(
							renamed.unchanged
								? '章节名没有变化'
								: '已重命名 · ' + renamed.path + ((renamed.related || []).length > 0 ? '（题目目录同步改名）' : ''),
						);
					}
					setNameDialog(null);
					await reload(true);
				} catch (problem) {
					flash('操作失败：' + ((problem && problem.message) || problem));
				}
			},
			[flash, nameDialog, reload],
		);

		/* 在知识点下新增一道题: 打开可视化表单 */
		const addQuestion = useCallback((point) => {
			if (!point || !point.path) return;
			setQuestionDialog({
				mode: 'new',
				pointPath: point.path,
				pointTitle: point.title || '',
				path: null,
				order: null,
				kind: 'choice',
				stem: '',
				options: [],
				answerKey: 'A',
				answerText: '',
				explanation: '',
			});
		}, []);

		/* 表单 -> 宿主: saveQuestion 会重排整份文件的「## 题目 N」 */
		const submitQuestion = useCallback(
			async (fields, keepOpen) => {
				const target = questionDialog;
				if (!target) return { error: '' };
				try {
					const saved = await postAction({
						action: 'saveQuestion',
						path: target.path || target.pointPath,
						order: target.mode === 'edit' ? target.order : undefined,
						fields,
					});
					flash(
						(saved.created ? '已新建题目文件 · ' : '已保存题目 · ') +
							pathLabel(saved.path) +
							'（共 ' +
							saved.total +
							' 题）' +
							(keepOpen ? ' · ' + t('savedNext') : ''),
					);
					if (!keepOpen) setQuestionDialog(null);
					await reload(true);
					return { path: saved.path, ok: true };
				} catch (problem) {
					return { error: questionError((problem && problem.message) || problem, t) };
				}
			},
			[flash, questionDialog, reload, t],
		);

		/* 逃生入口: 直接编辑这道题所在的 markdown 文件(新题会先存一次再打开) */
		const rawQuestion = useCallback(
			async (fields) => {
				const target = questionDialog;
				if (!target) return {};
				if (target.mode === 'edit' && target.path) {
					setQuestionDialog(null);
					await openEditorForSection(target.path);
					return { ok: true };
				}
				const result = await submitQuestion(fields, false);
				if (result && result.error) return result;
				if (result && result.path) await openEditorForSection(result.path);
				return result || {};
			},
			[openEditorForSection, questionDialog, submitQuestion],
		);

		const flashError = useCallback(
			(problem) => flash('操作失败：' + ((problem && problem.message) || problem)),
			[flash],
		);

		/* 删除一个笔记文件(小节 / 知识点 / 题目 / 章节说明) */
		const removeEntry = useCallback(
			async (relPath) => {
				try {
					const removed = await postAction({ action: 'delete', path: relPath });
					const cascaded = (removed && removed.related) || [];
					flash(
						t('movedToBox') +
							(removed && removed.bucket ? removed.bucket + '/' : '') +
							' · ' +
							pathLabel(relPath) +
							(cascaded.length ? '（' + t('cascade') + ' ×' + cascaded.length + '）' : ''),
					);
					setEditor(null);
					setRoute((prev) => (prev.path === relPath ? { view: 'map' } : prev));
					await reload(true);
				} catch (problem) {
					flash('删除失败：' + ((problem && problem.message) || problem));
				}
			},
			[flash, reload, t],
		);

		/* 删除整章(目录及其下全部文件) */
		const removeChapter = useCallback(
			async (chapter) => {
				try {
					const removed = await postAction({ action: 'deleteDir', dir: chapter.dir });
					const cascaded = (removed && removed.related) || [];
					flash(
						t('movedToBox') +
							(removed && removed.bucket ? removed.bucket + '/' : '') +
							' · ' +
							chapter.rel +
							(cascaded.length ? '（' + t('cascade') + ' ×' + cascaded.length + '）' : ''),
					);
					setRoute({ view: 'map' });
					await reload(true);
				} catch (problem) {
					flash('删除失败：' + ((problem && problem.message) || problem));
				}
			},
			[flash, reload, t],
		);

		/* 从题目/知识点文件里删掉某一道题 */
		const removeQuestion = useCallback(
			async (item) => {
				try {
					const questionRemoved = await postAction({ action: 'deleteQuestion', path: item.path, order: item.order });
					flash(t('movedToBox') + (questionRemoved && questionRemoved.bucket ? questionRemoved.bucket + '/' : '') + ' · ' + (item.label || item.title));
					await reload(true);
				} catch (problem) {
					flash('删除失败：' + ((problem && problem.message) || problem));
				}
			},
			[flash, reload, t],
		);
		const startNewUnit = useCallback(
			(mode, chapter, section) =>
				setEditor({ mode, dir: (chapter && chapter.dir) || '', section: (section && section.order) || 1, title: '', markdown: '' }),
			[],
		);

		const submitEditor = useCallback(
			async ({ value, title }) => {
				if (!editor) return;
				const clean = String(title || '').trim();
				setSaving(true);
				try {
					if (editor.mode === 'edit') {
						await postAction({ action: 'save', path: editor.path, markdown: value });
						flash(t('saved') + ' · ' + pathLabel(editor.path));
						setEditor(null);
					} else if (clean === '') {
						flash('请先填写标题');
						setSaving(false);
						return;
					} else if (editor.mode === 'newSection') {
						const created = await postAction({ action: 'newSection', dir: editor.dir, title: clean });
						flash(t('saved') + ' · ' + created.path);
						setEditor(null);
					} else if (editor.mode === 'newPoint') {
						const created = await postAction({
							action: 'newPoint',
							dir: editor.dir,
							section: editor.section,
							title: clean,
						});
						flash(t('saved') + ' · ' + created.path);
						setEditor(null);
					}
					await reload(true);
				} catch (problem) {
					flash('保存失败：' + ((problem && problem.message) || problem));
				}
				setSaving(false);
			},
			[editor, flash, reload, t],
		);

		/* 右键菜单的条目: 空白 / 章节卡 / 小节行 三套 */
		const onBlankContextMenu = useCallback(
			(event) => {
				if (!mapReady) return;
				if (mind) {
					/* 导图是只读视图: 不给右键菜单(也不弹浏览器菜单) */
					event.preventDefault();
					return;
				}
				if (level1) {
					/* 一级画布: 右键只给「新建学习画布」 */
					event.preventDefault();
					openMenu(event, [{ id: 'newRoot', label: '＋ ' + t('rootNew'), run: () => openNewRoot() }]);
					return;
				}
				const target = event.target;
				if (target.closest && (target.closest('.rk-chapter') || target.closest('.rk-rootcard'))) return;
				if (target.closest && target.closest('.rk-btn, .rk-input, input, textarea')) return;
				event.preventDefault();
				openMenu(event, [
					{ id: 'newChapter', label: '＋ ' + t('newChapter'), run: () => startNewChapter() },
					{ id: 'refresh', label: t('refresh'), run: () => reload(true) },
					{ id: 'fit', label: t('fit'), run: () => fitView() },
				]);
			},
			[mapReady, openMenu, t, startNewChapter, reload, fitView],
		);
		const onCardContextMenu = useCallback(
			(event, chapter, section) => {
				if (!chapter) return;
				const target = event.target;
				if (target.closest && target.closest('.rk-btn, .rk-input, input, textarea')) return;
				event.preventDefault();
				event.stopPropagation();
				if (section) {
					openMenu(event, [
						{ id: 'openSection', label: t('openSection'), run: () => openSection(section.path) },
						{ id: 'editSection', label: t('editSection'), run: () => openEditorForSection(section.path) },
						{ sep: true },
						{
							id: 'delSection',
							label: t('delSection'),
							danger: true,
							confirm: t('delConfirm') + ' ' + section.title,
							run: () => removeEntry(section.path),
						},
					]);
					return;
				}
				const items = [{ id: 'newSection', label: '＋ ' + t('newSection'), run: () => startNewSection(chapter.dir) }];
				if (chapter.dir !== '') {
					items.push({ id: 'rename', label: t('rename'), run: () => startRenameChapter(chapter) });
					items.push({ sep: true });
					items.push({
						id: 'delChapter',
						label: t('delChapter'),
						danger: true,
						confirm: t('delConfirm') + ' ' + chapter.title,
						run: () => removeChapter(chapter),
					});
				}
				openMenu(event, items);
			},
			[openMenu, t, openSection, openEditorForSection, removeEntry, startNewSection, startRenameChapter, removeChapter],
		);
		return {
			openEditorForSection, editQuestion, editPoint, submitPoint, rawPoint,
			startNewSection, startNewChapter, startRenameChapter, submitChapterName,
			addQuestion, submitQuestion, rawQuestion, flashError,
			removeEntry, removeChapter, removeQuestion, startNewUnit, submitEditor,
			onBlankContextMenu, onCardContextMenu,
		};
	}

	return { useEditing };
}
