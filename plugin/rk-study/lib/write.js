/* rk-study · host/write —— 从 host.js 第 969-1025 行原样切出 */
import { MARKDOWN_RE } from './constants.js?v=42';
import { absPathOf, denyOutsideRoot, insideRoot, writePolicyOf } from './fsguard.js?v=42';
import { normalizeRelPath } from './util.js?v=42';

/* ----------------------------------------------------------------- write */

/** 笔记文件相对路径守卫: 必须位于 root 内、是 markdown、且不含 `..`。只做字符串判定, 落盘时再查真实包含。 */
export function safePath(ctx, config, relPath) {
	const clean = normalizeRelPath(relPath);
	if (clean === '' || clean.split('/').includes('..') || !MARKDOWN_RE.test(clean)) return null;
	return absPathOf(config, clean);
}

export function readBody(req, limit) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > limit) {
				const error = new Error('request body too large');
				error.code = 'RK_BODY_TOO_LARGE';
				reject(error);
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => {
			try {
				const text = Buffer.concat(chunks).toString('utf8');
				resolve(text === '' ? {} : JSON.parse(text));
			} catch (error) {
				reject(error);
			}
		});
		req.on('error', reject);
	});
}

/**
 * 写入一个 markdown 文件。落盘前用 ctx.fs 的规范化目标复核「确实在 root 之内」
 * (符号链接指向外面也挡得住), 然后交给 ctx.fs.writeText —— 它自己会建父目录, 也会走沙箱策略。
 * @returns {Promise<{path: string, via: 'fs'}>}
 */
export async function writeMarkdown(ctx, config, relPath, content) {
	const abs = safePath(ctx, config, relPath);
	if (!abs) throw new Error(`invalid path: ${relPath}`);
	if (!(await insideRoot(ctx, config, abs))) throw denyOutsideRoot(relPath);
	const target = await ctx.fs.resolve(abs);
	await ctx.fs.writeText(target, content, undefined, undefined, writePolicyOf(config));
	return { path: relPath, via: 'fs' };
}
