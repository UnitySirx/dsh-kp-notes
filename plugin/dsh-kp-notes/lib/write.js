/* rk-study · host/write —— 从 host.js 第 969-1025 行原样切出 */
import { MARKDOWN_RE } from './constants.js?v=63';
import { absPathOf, denyOutsideRoot, insideRoot, writePolicyOf } from './fsguard.js?v=63';
import { classifyFile, isQuestionStorePath, libraryDirOf, normalizeRelPath, parseFrontmatter } from './util.js?v=63';
import { adoptUid, dropUids, takeUid, uidsFor, uidFromText, withUidText } from './uid.js?v=63';

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
 * 小节/知识点的身份号写在文件 frontmatter 的 `uid:` 里（0 迁移：号跟着内容走，改标题、挪目录都不丢）。
 * 写盘前保证它有号：文本里没有就看盘上旧文件有没有（前端重建头部时会把它丢掉），
 * 再看扫描时是不是已经按路径在号池里登记过（老笔记不动文件也有号），都没有才发新号；
 * 号从号池搬进 frontmatter 之后，号池里按路径记的那条账就摘掉（号已经跟着内容走了）。
 * 任何一步失败都只是「这次没补号」，绝不挡住写盘本身。
 */
async function entityTextWithUid(ctx, config, relPath, abs, content) {
	const text = typeof content === 'string' ? content : String(content ?? '');
	try {
		const clean = normalizeRelPath(relPath);
		const parts = clean.split('/').filter(Boolean);
		/* 点开头的段（.templates / .config …）不是笔记实体 */
		if (parts.some((part) => part.startsWith('.'))) return { text, uid: '' };
		if (isQuestionStorePath(config, clean)) return { text, uid: '' };
		const base = parts[parts.length - 1] || '';
		const { front } = parseFrontmatter(text.split(/\r?\n/));
		const info = classifyFile(base, front);
		if (info.kind !== 'section' && info.kind !== 'point') return { text, uid: '' };
		const lib = (await libraryDirOf(ctx, config)) || config.root;
		const inText = uidFromText(text, info.kind);
		if (inText !== '') {
			await adoptUid(ctx, lib, info.kind, inText);
			return { text, uid: inText };
		}
		let fromDisk = '';
		try {
			fromDisk = uidFromText(await ctx.fs.readText(abs), info.kind);
		} catch (error) {
			fromDisk = '';
		}
		if (fromDisk !== '') {
			await adoptUid(ctx, lib, info.kind, fromDisk);
			return { text: withUidText(text, fromDisk), uid: fromDisk };
		}
		const pooled = (await uidsFor(ctx, lib, [abs]))[abs] || '';
		if (pooled !== '') {
			await dropUids(ctx, lib, [abs]);
			return { text: withUidText(text, pooled), uid: pooled };
		}
		const fresh = await takeUid(ctx, lib, info.kind);
		return { text: withUidText(text, fresh), uid: fresh };
	} catch (error) {
		return { text, uid: '' };
	}
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
	const { text: body, uid } = await entityTextWithUid(ctx, config, relPath, abs, content);
	await ctx.fs.writeText(target, body, undefined, undefined, writePolicyOf(config));
	return uid === '' ? { path: relPath, via: 'fs' } : { path: relPath, via: 'fs', uid };
}
