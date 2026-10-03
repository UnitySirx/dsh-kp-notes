/* rk-study · host/fsguard —— 所有落盘/删盘操作共用的两道守卫
 *
 * 1) 目标必须在这次请求的 root 之内 —— 用 ctx.fs 的规范化目标(realpath 后的身份)判包含,
 *    所以 root 里指向外面的符号链接也逃不出去, 不再只靠字符串前缀。
 * 2) 写盘带上沙箱策略。这里沿用插件自己的 root 作为 workspaceRoot:
 *    「多学习画布」本来就是插件的设计(用户可以在任意目录建画布, 见 README), 策略只能如实
 *    描述这次写的真正边界, 否则 ctx.fs 的沙箱后端会把用户自己的画布判成越界。
 *
 * 明确说明可信边界(这是一个取舍, 不是遗漏):
 *   - 沙箱策略里的 workspaceRoot 由插件自己填, 所以它拦住的是「root 之内的路径穿越」,
 *     拦不住「换一个 ?root= 参数把 root 本身指到别处」。这是多画布能力的前提。
 *   - 因此 caller 侧真正决定 root 可信度的是 lib/util.js 的 validateRoot: 只接受绝对路径、
 *     长度有限、不含 NUL/CR/LF、不含 `..` 段。这个校验挡的是畸形路径, 不是恶意 root。
 *   - 残余风险: 任何能在 DSH 页面里发 HTTP 请求的人, 都能借 ?root= 让插件在**该用户可写的
 *     任意目录**里建/改/删文件(插件进程的权限范围)。CSP / 来源校验不在本插件手里;
 *     若以后要收紧, 正确做法是维护一份「合法 root 白名单」(baseConfig.root + 已授权的画布),
 *     而不是继续加字符串前缀判断。
 */
import { normalizeRelPath } from './util.js?v=44';

/** 把 root 与 root 内的相对路径拼成绝对路径(相对路径已归一化, 不含 .. ) */
export function absPathOf(config, relPath) {
	const clean = normalizeRelPath(relPath);
	if (clean === '') return null;
	const root = String(config.root ?? '').replace(/\/+$/, '');
	if (root === '') return null;
	if (clean.split('/').includes('..')) return null;
	return `${root}/${clean}`;
}

/** 这次请求的 root 规范化成 ctx.fs 目标; 解析不了返回 null(调用方按「路径不允许」处理) */
export async function rootTargetOf(ctx, config, signal) {
	try {
		return await ctx.fs.resolve(config.root, signal ? { signal } : undefined);
	} catch {
		return null;
	}
}

/** 绝对路径 → ctx.fs 目标; 解析不了返回 null */
export async function resolveTarget(ctx, abs, signal) {
	try {
		return await ctx.fs.resolve(abs, signal ? { signal } : undefined);
	} catch {
		return null;
	}
}

/**
 * 绝对路径是否在这次请求的 root 之内(规范化后判包含)。
 * @returns {Promise<boolean>}
 */
export async function insideRoot(ctx, config, abs, signal) {
	const rootTarget = await rootTargetOf(ctx, config, signal);
	if (!rootTarget) return false;
	const target = await resolveTarget(ctx, abs, signal);
	if (!target) return false;
	return ctx.fs.contains(rootTarget, target);
}

/** 写盘用的沙箱策略: workspaceRoot 就是这次请求的 root(见文件头说明) */
export function writePolicyOf(config) {
	return { mode: 'workspace-write', workspaceRoot: String(config.root ?? '') };
}

/** 越界统一抛这个错, 调用方把它当参数错误回报即可 */
export function denyOutsideRoot(relPath) {
	return new Error(`invalid path: ${relPath}`);
}
