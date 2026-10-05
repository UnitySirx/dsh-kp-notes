/* rk-study · client/media.js —— 图片素材(落盘 + 显示)
 *
 * 编辑器里插图**不写 Base64**: 字节交给 host 落到「所在小节」旁边的
 * media/<小节uid>.assestfiles/ 里(见 lib/routes.js 的 /rk-study/media 与 README「图片素材」),
 * 正文里只留一段相对路径(如 media/s0001.assestfiles/s0001-2.png), 所以笔记整体搬走、
 * 用别的编辑器打开都不丢图; 从正文里删掉图片也**不会**删盘上那份。
 *
 * 插入图片是**两步**的(跟 vendor 弹窗「先选文件 → 再点『插入图片』」对齐):
 *   1) 选文件时 upload() 只做一条**本地引用**(blob: 地址), 一个字节都不写盘 —— 选错重选、
 *      选好又关掉弹窗, 都不会在盘上留下没人引用的孤儿图;
 *   2) 点「插入图片」把图放进正文之后, onChange 里调 settleText() 才把字节交给 host 落盘,
 *      落完把正文里那段 blob 换成相对路径, 于是写盘时一定只剩相对路径。
 * 为什么不直接把本地文件的绝对路径(file:///Users/…)交给弹窗预览: 面板页是 http 的, 浏览器
 * 不让加载 file:// 子资源; 也不直接把 host 给的相对路径交出去 —— vendor 在插入前会拿这个返回
 * 值 new Image() 探一次能不能加载, 相对路径会被解析到站点根下 ⇒ 404 ⇒ 弹窗报「图片加载失败」,
 * 而那时候字节其实已经落盘了, 盘上就多一张没人引用的孤儿图。
 *
 * 本模块管五件事:
 *   1) upload(file, notePath)  → 「选文件」时给一条本地引用(blob:), 不落盘;
 *   2) settleText(text)        → 「插入图片」之后落盘, 返回能写进文件的文本(blob → 相对路径);
 *   3) mediaUrl(src)           → 那段相对路径换成能真的取到字节的地址;
 *   4) toMarkdownSrc(text)     → 反过来: 显示地址与已落盘的 blob 都换回相对路径, 写盘前收口;
 *   5) watchImages(rootEl)     → 盯住面板里的 <img>, 把相对 src 就地换成上面那个地址,
 *      卡片 / 导图 / 预览 / 编辑器共用这一层(只改 DOM, 不动 markdown)。
 *
 * 约定与 client/ 下其它模块一致: 依赖由入口 client.js 注入, 模块之间不互相 import。
 */

/* 带协议的 src(http: / data: / blob:) 与站内绝对路径、纯锚点都不动 */
const ABSOLUTE_RE = /^[a-z][a-z0-9+.-]*:/i;

/* 「插入图片」弹窗的体积上限, 交给 vendor 的 imageUpload.maxFileSize(不传它自己默认卡 5MB)。
 * host 那边 /rk-study/media 收 24MB 的 JSON body(见 lib/constants.js 的 MEDIA_MAX_BYTES),
 * 而 base64 会把文件撑大约 4/3 ⇒ 文件上限取 16MB, 留出安全余量。 */
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

/* 选图阶段我们给的是 blob: 本地引用(见 upload 的说明)。可是 vendor 在 image 节点上装了一道协议
 * 白名单: 只有 http:/https:/mailto:/tel:/data: 放行(内部 yH 把关), 名单外的协议一律换成空串 ⇒
 * 图片节点被 toMarkdown 静默跳过: 文档里看得见图、markdown 里一个字都没有、onChange 也就永不
 * 触发(落盘那步因此永远等不到)。vendor 允许调用方追加协议(useEditor 里 NH(ctx,
 * imageUpload?.allowedProtocols)), 所以把 blob: 补进去。 */
const ALLOWED_PROTOCOLS = ['blob:'];

/* toMarkdownSrc 用的地址形状: 我们自己拼的 <origin>/rk-study/media?…&path=…。
 * 只可能出现在「刚插图、还没写盘」的这段窗口里 —— 落盘文件名由 host 生成(<uid>-<n>.<ext>),
 * 不含空格等需要转义的字符, 所以 path 参数直接解出来就是 markdown 里原来那段。 */
const MEDIA_URL_RE = /(?:[a-z][a-z\d+.-]*:\/\/[^\s)"'<>]*)?\/rk-study\/media\?[^\s)"'<>]*/gi;

/* 「选文件」阶段那条本地引用(blob:…)的形状 —— 只活在页内, 绝不会允许写进文件 */
const BLOB_URL_RE = /blob:[^\s)"'<>]+/g;

/* 显示地址 → 写进 markdown 的相对路径。地址里没有 path(或解不出来)就原样留着, 免得把用户
 * 手写的 <img> 改坏。 */
function urlToRelative(text) {
	const source = String(text === undefined || text === null ? '' : text);
	if (source.indexOf('/rk-study/media?') < 0) return source;
	return source.replace(MEDIA_URL_RE, (hit) => {
		const mark = hit.indexOf('?');
		if (mark < 0) return hit;
		let path = '';
		try {
			path = new URLSearchParams(hit.slice(mark + 1)).get('path') || '';
		} catch (error) {
			path = '';
		}
		return path === '' ? hit : path;
	});
}

export function createMedia({ api }) {
	const mediaUrl = (api && api.mediaUrl) || (() => '');
	const uploadMedia = api && api.uploadMedia;
	/* 选好了、还没落盘的图: blob 地址 → { file, notePath } */
	const pending = new Map();
	/* 已经落盘的图: blob 地址 → 正文里的相对路径(host 回的那段), 收口时换回去 */
	const landed = new Map();
	/* 正在跑的落盘作业: 写盘前 await flush() 等它们, 免得 blob 被写进文件 */
	const jobs = new Set();

	/* 收口: 显示地址 → 相对路径(纯函数那段), 再把已经落盘的 blob 也换成相对路径。
	 * strict(写盘时用): 没落盘成功的 blob **整段去掉** —— blob 地址写进文件就永远打不开了,
	 * 宁可当这张图没插; 平时(编辑中, 不上 strict)原样留着, 免得图还没落完就从正文里消失。 */
	function toMarkdownSrc(text, strict) {
		const source = urlToRelative(text);
		if (source.indexOf('blob:') < 0) return source;
		return source
			.replace(/!\[([^\]]*)\]\(\s*(blob:[^\s)]*)\s*\)/g, (hit, alt, url) => {
				const rel = landed.get(url);
				if (rel) return '![' + alt + '](' + rel + ')';
				return strict ? '' : hit;
			})
			.replace(BLOB_URL_RE, (hit) => landed.get(hit) || (strict ? '' : hit));
	}

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

	/* 「选文件」阶段: 只给一条**本地引用**(blob: 地址), 一个字节都不写盘。
	 * 返回它而不是 host 的相对路径, 是因为 vendor 插入前会拿这个返回值 new Image() 探一次
	 * 能不能加载(相对路径在站点根下取不到 ⇒ 404 ⇒ 弹窗报「图片加载失败」、插入按钮变灰),
	 * 而 blob 地址既能让弹窗预览显示, 又不需要提前落盘(选错重选/选完就关都不留孤儿图)。
	 * 落盘见 settleText(); 失败回 ''(由弹窗显示插入失败)。 */
	function upload(file, notePath) {
		if (!file || !uploadMedia || !notePath) return '';
		if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return '';
		try {
			const blob = URL.createObjectURL(file);
			pending.set(blob, { file: file, notePath: notePath });
			return blob;
		} catch (error) {
			return '';
		}
	}

	/* 单个 blob 引用 → host 落盘; 失败就留在 pending 里(收口会把它去掉, 编辑中的预览仍能看)。 */
	async function settleOne(url) {
		if (landed.has(url)) return;
		const item = pending.get(url);
		if (!item || !uploadMedia) return;
		try {
			const data = await readBase64(item.file);
			if (data === '') return;
			const result = await uploadMedia({
				path: item.notePath,
				name: item.file.name || 'image.png',
				type: item.file.type || '',
				data,
			});
			if (!result || typeof result.src !== 'string' || result.src === '') return;
			landed.set(url, result.src);
		} catch (error) {
			/* 落盘失败: 不写进文件, 也不抛给调用方(插图本身已经完成了) */
		} finally {
			pending.delete(url);
		}
	}

	/* 「插入图片」之后(图片已经进了正文, 正文里那个 src 正是 blob:)才真正落盘:
	 * 把 text 里所有还挂着的 blob 引用交给 host, 回一段**能写进文件**的文本(blob → 相对路径)。
	 * 同一个 blob 只传一次; 没有 blob 时是同步的快路径。 */
	function settleText(text) {
		const source = String(text === undefined || text === null ? '' : text);
		if (source.indexOf('blob:') < 0) return Promise.resolve(source);
		const urls = [];
		const hits = source.match(BLOB_URL_RE) || [];
		for (let index = 0; index < hits.length; index += 1) if (!urls.includes(hits[index])) urls.push(hits[index]);
		if (urls.length === 0) return Promise.resolve(source);
		const job = Promise.all(urls.map((url) => settleOne(url))).then(() => toMarkdownSrc(source));
		jobs.add(job);
		const drop = () => jobs.delete(job);
		job.then(drop, drop);
		return job;
	}

	/* 写盘前等所有落盘作业跑完(编辑器/弹窗保存时用), 免得把 blob 写进文件 */
	function flush() {
		return Promise.all(Array.from(jobs));
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

	return {
		isRelativeSrc,
		upload,
		settleText,
		flush,
		mediaUrl,
		toMarkdownSrc,
		maxFileSize: MAX_UPLOAD_BYTES,
		allowedProtocols: ALLOWED_PROTOCOLS,
		resolveOne,
		scan,
		watchImages,
	};
}
