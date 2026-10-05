/* rk-study · client/media.js —— 图片素材(落盘 + 显示)
 *
 * 编辑器里插图**不写 Base64**: 字节交给 host 落到「所在小节」旁边的
 * <小节uid>.assestfiles/ 里(见 lib/routes.js 的 /rk-study/media 与 README「图片素材」),
 * 正文里只留一段相对路径(如 s0001.assestfiles/s0001-2.png), 所以笔记整体搬走、
 * 用别的编辑器打开都不丢图; 从正文里删掉图片也**不会**删盘上那份。
 *
 * 本模块管三件事:
 *   1) upload(file, notePath)  → File 读成 base64 交给 host, 返回写进 markdown 的相对路径(失败回 '');
 *   2) mediaUrl(src)           → 那段相对路径换成能真的取到字节的地址;
 *   3) watchImages(rootEl)     → 盯住面板里的 <img>, 把相对 src 就地换成上面那个地址,
 *      卡片 / 导图 / 预览 / 编辑器共用这一层(只改 DOM, 不动 markdown)。
 *
 * 约定与 client/ 下其它模块一致: 依赖由入口 client.js 注入, 模块之间不互相 import。
 */

/* 带协议的 src(http: / data: / blob:) 与站内绝对路径、纯锚点都不动 */
const ABSOLUTE_RE = /^[a-z][a-z0-9+.-]*:/i;

export function createMedia({ api }) {
	const mediaUrl = (api && api.mediaUrl) || (() => '');
	const uploadMedia = api && api.uploadMedia;

	function isRelativeSrc(src) {
		const text = String(src === undefined || src === null ? '' : src).trim();
		if (text === '') return false;
		if (text.charAt(0) === '#' || text.charAt(0) === '/' || text.charAt(0) === '?') return false;
		return !ABSOLUTE_RE.test(text);
	}

	function readBase64(file) {
		return new Promise((resolve, reject) => {
			if (typeof FileReader !== 'function') {
				reject(new Error('no-filereader'));
				return;
			}
			const reader = new FileReader();
			reader.onload = () => {
				const text = String(reader.result || '');
				const cut = text.indexOf(',');
				resolve(cut < 0 ? '' : text.slice(cut + 1));
			};
			reader.onerror = () => reject(reader.error || new Error('image-read-failed'));
			reader.readAsDataURL(file);
		});
	}

	/* File → host 落盘 → 返回 markdown 里要写的那段相对路径(失败回 '', 由编辑器显示插入失败) */
	async function upload(file, notePath) {
		if (!file || !uploadMedia || !notePath) return '';
		try {
			const data = await readBase64(file);
			if (data === '') return '';
			const result = await uploadMedia({
				path: notePath,
				name: file.name || 'image.png',
				type: file.type || '',
				data,
			});
			return result && typeof result.src === 'string' ? result.src : '';
		} catch (error) {
			return '';
		}
	}

	/* 只换 <img> 的显示地址: markdown 里那份相对路径原样不动 */
	function resolveOne(el) {
		if (!el || el.tagName !== 'IMG') return;
		const raw = el.getAttribute('src') || '';
		if (!isRelativeSrc(raw)) return;
		el.setAttribute('src', mediaUrl(raw));
	}

	function scan(node) {
		if (!node || node.nodeType !== 1) return;
		resolveOne(node);
		if (!node.querySelectorAll) return;
		const list = node.querySelectorAll('img[src]');
		for (let index = 0; index < list.length; index += 1) resolveOne(list[index]);
	}

	/* 返回解除函数; 没 dom 支撑(测试桩)时是空函数 */
	function watchImages(rootEl) {
		if (!rootEl) return () => {};
		scan(rootEl);
		if (typeof MutationObserver !== 'function') return () => {};
		const observer = new MutationObserver((records) => {
			for (const record of records) {
				if (record.type === 'attributes') {
					resolveOne(record.target);
					continue;
				}
				const added = record.addedNodes || [];
				for (let index = 0; index < added.length; index += 1) scan(added[index]);
			}
		});
		observer.observe(rootEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
		return () => observer.disconnect();
	}

	return { isRelativeSrc, upload, mediaUrl, resolveOne, scan, watchImages };
}
