/* rk-study · host/git —— 面板里的「Git 提交」: 读工作区状态 / 暂存提交 / 推送
 *
 * 只做 add / commit / push 三件事, 永不 reset / checkout / add -f —— 用户工作区里的改动
 * 只有他自己在面板上点「提交」才会被暂存。
 *
 * 所有 git 调用都走 ctx.subprocess: 子进程环境由 DSH 的凭据擦洗(不再把整个宿主 process.env
 * 递给 git), 关掉交互式凭据提示, 并且用「调用方 signal + AbortSignal.timeout」自己拥有超时 ——
 * 请求断开时 push 也能被终止(旧版裸 execFile 的 timeout 是杀不掉的)。
 */
import { join } from 'node:path';

const GIT_TIMEOUT_MS = 30000;
const COMMIT_TIMEOUT_MS = 60000;
const PUSH_TIMEOUT_MS = 180000;
const PULL_TIMEOUT_MS = 180000;
const MAX_FILES = 400;
const STDOUT_MAX_BYTES = 4 * 1024 * 1024;
const STDERR_TAIL_BYTES = 16 * 1024;
/* 终止后留给 git 自己退出的宽限, 与 dsh-workspace-changes 的 GitRunner 保持一致 */
const TERMINATE_GRACE_MS = 2000;

/* 中文文件名默认会被 git 转义成 \346\226\207…(core.quotepath=true), 面板上没法看 */
const QUOTE_PATH = ['-c', 'core.quotepath=false'];
/* 子进程环境: 关掉一切交互式提示(凭据擦洗由 ctx.subprocess 自己做)。
 * GIT_ASKPASS 显式设为 undefined = 墓碑, 把宿主可能存在的值从子进程里摘掉。 */
const GIT_ENV = {
	GIT_TERMINAL_PROMPT: '0',
	GIT_OPTIONAL_LOCKS: '0',
	GIT_ASKPASS: undefined,
	LC_ALL: 'C',
};

/** 跑一次 git, 返回 { ok, stdout, stderr, message } —— 形状与旧版 execFile 包装一致, 调用方不用改。 */
async function run(ctx, root, args, timeout = GIT_TIMEOUT_MS, signal) {
	if (!ctx || !ctx.subprocess) {
		return { ok: false, stdout: '', stderr: '', message: 'subprocess service is unavailable' };
	}
	const deadline = AbortSignal.timeout(timeout);
	const abort = signal ? AbortSignal.any([signal, deadline]) : deadline;
	let handle;
	try {
		handle = ctx.subprocess.spawn({
			argv: ['git', ...QUOTE_PATH, '-C', root, ...args],
			cwd: root,
			stdio: {
				stdin: 'ignore',
				stdout: { maxBytes: STDOUT_MAX_BYTES },
				stderr: { maxBytes: STDERR_TAIL_BYTES },
			},
			graceMs: TERMINATE_GRACE_MS,
			signal: abort,
			env: GIT_ENV,
		});
	} catch (error) {
		return { ok: false, stdout: '', stderr: '', message: String((error && error.message) || error) };
	}
	let outcome;
	try {
		outcome = await handle.done;
	} catch (error) {
		return { ok: false, stdout: '', stderr: '', message: String((error && error.message) || error) };
	}
	const readOut = handle.collected.stdout?.readFrom(0);
	const readErr = handle.collected.stderr?.readFrom(0);
	const stdout = readOut ? readOut.text : '';
	const stderr = readErr ? readErr.text : '';
	if (deadline.aborted) {
		return { ok: false, stdout, stderr, message: `git ${args[0] ?? ''} 超时(${timeout}ms)` };
	}
	if (abort.aborted) return { ok: false, stdout, stderr, message: 'git 被取消' };
	const ok = outcome.exitCode === 0;
	return {
		ok,
		stdout,
		stderr,
		message: ok ? '' : (stderr.trim() || `git 退出码 ${outcome.exitCode === null ? `信号 ${outcome.signal ?? ''}` : outcome.exitCode}`),
	};
}

/* 改动分组: 插件代码 / 笔记与题目 / 其它 */
function groupOf(path, config) {
	if (path === 'plugin/rk-study' || path.startsWith('plugin/rk-study/')) return 'plugin';
	const notePrefix = `${config.noteDir}/`;
	const questionPrefix = `${config.questionDir}/`;
	if (path.startsWith(notePrefix) || path.startsWith(questionPrefix)) return 'notes';
	/* 一级画布(学习库)上提交整个库时, 改动路径形如 <画布>/notes/… —— 这些也算笔记 */
	if (/(^|\/)(notes|questions)\//.test(path)) return 'notes';
	return 'other';
}

function line(result) {
	return [result.stdout, result.stderr]
		.map((text) => text.trim())
		.filter(Boolean)
		.join('\n');
}

/* scope='notes' 时只报 noteDir/questionDir 里的改动(面板只提交笔记内容) */
export async function gitStatus(ctx, config, options, signal) {
	const scope = options?.scope === 'notes' ? 'notes' : 'all';
	const root = config.root;
	const inside = await run(ctx, root, ['rev-parse', '--is-inside-work-tree']);
	if (!inside.ok || inside.stdout.trim() !== 'true') {
		return { ok: false, error: 'not-a-git-repo', message: line(inside) || '这个目录不是 git 仓库' };
	}
	const top = (await run(ctx, root, ['rev-parse', '--show-toplevel'])).stdout.trim() || root;
	const branch = (await run(ctx, root, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim() || '(未知)';
	const upstream = (await run(ctx, root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])).stdout.trim();
	const remote = (await run(ctx, root, ['remote', 'get-url', 'origin'])).stdout.trim();
	let ahead = 0;
	let behind = 0;
	if (upstream) {
		const counted = (await run(ctx, root, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`])).stdout.trim().split(/\s+/);
		ahead = Number(counted[0]) || 0;
		behind = Number(counted[1]) || 0;
	}
	const status = await run(ctx, root, ['status', '--porcelain=v1', '-uall'], COMMIT_TIMEOUT_MS, signal);
	if (!status.ok) return { ok: false, error: 'status-failed', message: line(status) };
	const all = [];
	for (const row of status.stdout.split('\n')) {
		if (row.length < 4) continue;
		const code = row.slice(0, 2);
		let path = row.slice(3);
		const arrow = path.indexOf(' -> ');
		if (arrow >= 0) path = path.slice(arrow + 4);
		if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
		all.push({ path, code, group: groupOf(path, config), tracked: code !== '??' });
	}
	const counts = { plugin: 0, notes: 0, other: 0, total: all.length };
	for (const file of all) counts[file.group] += 1;
	const scoped = scope === 'notes' ? all.filter((file) => file.group === 'notes') : all;
	const lastRaw = (await run(ctx, root, ['log', '-1', '--pretty=%h%x1f%s%x1f%cI'])).stdout.trim();
	const parts = lastRaw ? lastRaw.split('\x1f') : [];
	return {
		ok: true,
		root: top,
		branch,
		upstream,
		remote,
		ahead,
		behind,
		scope,
		scopeTotal: scoped.length,
		clean: scoped.length === 0,
		files: scoped.slice(0, MAX_FILES),
		truncated: scoped.length > MAX_FILES,
		counts,
		lastCommit: parts[0] ? { hash: parts[0], subject: parts[1] ?? '', date: parts[2] ?? '' } : null,
	};
}

/* 拉取时 git 拒绝的理由: 「工作区有改动, 会被合并覆盖」—— 这种等提交完(工作区干净了)再拉一次 */
const PULL_DIRTY_RE = /would be overwritten|Please commit your changes or stash|local changes/i;

/** 现在处于「合并到一半」的状态吗(.git/MERGE_HEAD 还在) */
async function mergeInProgress(ctx, root) {
	const head = await run(ctx, root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
	return head.ok === true && head.stdout.trim() !== '';
}

/** 还没解决的冲突文件(工作区里带着 <<<<<<< 标记的那些) */
async function unmergedPaths(ctx, root) {
	const result = await run(ctx, root, ['diff', '--name-only', '--diff-filter=U']);
	return result.stdout.split('\n').map((row) => row.trim()).filter(Boolean);
}

/** 拉取远程并合并到本地: `git pull --no-rebase --no-edit`(绝不做 rebase, 不改写本地历史)。
 *  冲突时**保留**合并状态(冲突标记就摆在笔记里), 让用户在编辑器里解决后重新提交。 */
export async function gitPull(ctx, config, options, signal) {
	const root = config.root;
	const action = 'pull';
	const upstream = (await run(ctx, root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])).stdout.trim();
	if (!upstream) return { action, ok: false, skipped: true, error: 'no-upstream', message: '这个分支没有配置远程(upstream), 没法拉取', output: '' };
	if (await mergeInProgress(ctx, root)) {
		const conflicts = await unmergedPaths(ctx, root);
		return { action, ok: false, skipped: false, error: 'pull-conflict', conflicts, message: `上一次合并还没结束, 还有 ${conflicts.length} 个冲突文件要解决: ${conflicts.join(', ')}`, output: '' };
	}
	const before = (await run(ctx, root, ['rev-parse', 'HEAD'])).stdout.trim();
	const pulled = await run(ctx, root, ['pull', '--no-rebase', '--no-edit'], PULL_TIMEOUT_MS, signal);
	const output = line(pulled);
	if (!pulled.ok) {
		if (await mergeInProgress(ctx, root)) {
			const conflicts = await unmergedPaths(ctx, root);
			return { action, ok: false, skipped: false, error: 'pull-conflict', conflicts, message: `远程和本地都改了这几个文件, 要先解决冲突: ${conflicts.join(', ') || '(见下面的 git 输出)'}`, output };
		}
		return { action, ok: false, skipped: false, error: 'pull-failed', message: output || pulled.message || 'git pull 失败', output };
	}
	const after = (await run(ctx, root, ['rev-parse', 'HEAD'])).stdout.trim();
	return { action, ok: true, skipped: false, upToDate: before !== '' && before === after, message: output, output };
}

export async function gitPush(ctx, config, options, signal) {
	const dryRun = options?.dryRun === true;
	const args = dryRun ? ['push', '--dry-run'] : ['push'];
	const pushed = await run(ctx, config.root, args, PUSH_TIMEOUT_MS, signal);
	const output = line(pushed);
	if (!pushed.ok) return { ok: false, skipped: false, dryRun, message: output || pushed.message || 'git push 失败', output };
	return { ok: true, skipped: false, dryRun, message: output, output };
}

function scopePaths(scope, config) {
	if (scope === 'plugin') return ['plugin/rk-study'];
	if (scope === 'notes') return [config.noteDir, config.questionDir];
	return [];
}

export async function gitCommit(ctx, config, options, signal) {
	const message = String(options?.message ?? '').trim();
	if (message === '') return { ok: false, error: 'empty-message', message: '提交信息不能为空' };
	const scope = ['plugin', 'notes'].includes(options?.scope) ? options.scope : 'all';
	const paths = scopePaths(scope, config);
	/* 冲突还没解决时绝不替用户提交: 冲突标记不能变成笔记正文 */
	const unmerged = await unmergedPaths(ctx, config.root);
	if (unmerged.length > 0) {
		return { ok: false, error: 'unmerged', conflicts: unmerged, message: `还有 ${unmerged.length} 个文件处于冲突状态, 先解决冲突再提交: ${unmerged.join(', ')}` };
	}
	/* 用户要求: 默认「先拉取合并, 再提交」—— 免得提交完推送被拒。
	 * 工作区有改动、拉取被 git 拒绝时, 记下来等这次提交完成(工作区干净了)再补拉一次;
	 * 网络类失败不重试, 免得白等两次超时。 */
	const first = await gitPull(ctx, config, {}, signal);
	const pullInfo = {
		ok: first.ok === true,
		upToDate: first.upToDate === true,
		skipped: first.skipped === true,
		error: first.ok ? undefined : first.error,
		conflicts: first.conflicts ?? [],
		message: first.message ?? '',
	};
	if (!first.ok && first.error === 'pull-conflict') {
		return { ok: false, error: 'pull-conflict', conflicts: pullInfo.conflicts, message: pullInfo.message, output: first.output, pull: pullInfo };
	}
	const pullAfter = !first.ok && !first.skipped && PULL_DIRTY_RE.test(String(first.message ?? '')) === true;
	/* 提交完再补一次拉取(工作区已经干净, 这时能合进来); 返回 false = 冲突/失败, 不要再推送 */
	const mergeAfter = async () => {
		if (!pullAfter) return true;
		const second = await gitPull(ctx, config, {}, signal);
		pullInfo.ok = second.ok === true;
		pullInfo.upToDate = second.upToDate === true;
		pullInfo.pulledAfter = second.ok === true && second.upToDate !== true;
		pullInfo.error = second.ok ? undefined : second.error;
		pullInfo.conflicts = second.conflicts ?? [];
		pullInfo.message = second.message ?? '';
		return second.ok === true;
	};
	const added = await run(ctx, config.root, paths.length > 0 ? ['add', '-A', '--', ...paths] : ['add', '-A'], COMMIT_TIMEOUT_MS, signal);
	if (!added.ok) return { ok: false, error: 'add-failed', message: line(added) || added.message };
	const stagedRaw = await run(ctx, config.root, ['diff', '--cached', '--name-only', '--no-renames']);
	const staged = stagedRaw.stdout.split('\n').map((row) => row.trim()).filter(Boolean);
	if (staged.length === 0) {
		if (options?.push === true) {
			if (!(await mergeAfter())) {
				return { ok: false, error: pullInfo.error, committed: 0, pushed: false, conflicts: pullInfo.conflicts, message: pullInfo.message, pull: pullInfo };
			}
			const pushed = await gitPush(ctx, config, options, signal);
			return {
				ok: pushed.ok,
				committed: 0,
				pushed: pushed.ok,
				error: pushed.ok ? undefined : 'push-failed',
				message: pushed.ok ? '没有新的改动, 已把本地提交推送上去' : pushed.message,
				output: pushed.output,
				pull: pullInfo,
			};
		}
		return { ok: false, error: 'nothing-to-commit', message: '没有需要提交的改动', scope, pull: pullInfo };
	}
	const committed = await run(ctx, config.root, ['commit', '-m', message], COMMIT_TIMEOUT_MS, signal);
	if (!committed.ok) {
		return { ok: false, error: 'commit-failed', message: line(committed) || committed.message, staged: staged.length, scope, pull: pullInfo };
	}
	const hash = (await run(ctx, config.root, ['rev-parse', '--short', 'HEAD'])).stdout.trim();
	const subject = (await run(ctx, config.root, ['log', '-1', '--pretty=%s'])).stdout.trim();
	if (!(await mergeAfter())) {
		return {
			ok: false,
			error: pullInfo.error,
			committed: staged.length,
			staged,
			scope,
			hash,
			subject,
			pushed: false,
			conflicts: pullInfo.conflicts,
			message: pullInfo.message,
			output: committed.stdout.trim(),
			pull: pullInfo,
		};
	}
	let pushed = { ok: true, skipped: true, output: '' };
	if (options?.push === true) pushed = await gitPush(ctx, config, options, signal);
	return {
		ok: pushed.ok,
		committed: staged.length,
		staged,
		scope,
		hash,
		subject,
		pushed: !pushed.skipped && pushed.ok,
		error: pushed.ok ? undefined : 'push-failed',
		message: pushed.ok ? undefined : pushed.message,
		output: [committed.stdout.trim(), pushed.output].filter(Boolean).join('\n'),
		pull: pullInfo,
	};
}

/* ------------------------------------------------------------------ AI 生成提交信息
 *
 * 用宿主自己的模型服务(ctx.llm, @deepseek-ai/dsh-llm)读一遍改动清单, 给出几条候选
 * commit message。不引入任何 npm 依赖: 直接累加 stream 的 text-delta, 自己 AbortSignal.timeout。
 */

const AI_TIMEOUT_MS = 60000;
const AI_MAX_FILES = 10;
const AI_MAX_TOKENS = 400;
const AI_CANDIDATES = 3;

const AI_SYSTEM = [
	'你是 git 提交信息助手。根据给定的改动清单, 写出简洁的中文 commit message。',
	'要求:',
	'1. 每行一条候选, 一次给 3 条; 不要编号、不要引号、不要代码块、不要任何解释;',
	'2. 每条不超过 60 个字符, 用「类型: 说明」的格式, 类型取 docs / feat / fix / chore;',
	'3. 说明里点出这一节 / 这个知识点的名字或主题, 别写「更新文件」这类空话。',
].join('\n');

/* git 的状态码 → 人话(给模型看, 也让提示更准确) */
function stateLabel(code) {
	const pair = String(code ?? '').padEnd(2, ' ');
	if (pair === '??') return '新增';
	if (/U/.test(pair) || pair === 'AA' || pair === 'DD') return '冲突';
	if (/D/.test(pair)) return '删除';
	if (/R/.test(pair)) return '重命名';
	if (/A/.test(pair)) return '新增';
	return '修改';
}

/* 只抓「能说明这是什么」的行: frontmatter 的 title/tags + 各级标题 + 少量正文 */
function excerpt(text) {
	const heads = [];
	const metas = [];
	const body = [];
	for (const raw of String(text ?? '').split('\n')) {
		const trimmed = raw.trim();
		if (trimmed === '') continue;
		if (/^#{1,6}\s/.test(trimmed)) {
			if (heads.length < 12) heads.push(trimmed);
			continue;
		}
		if (/^(title|tags|type|order|chapter|point)\s*:/i.test(trimmed)) {
			if (metas.length < 6) metas.push(trimmed);
			continue;
		}
		if (body.length < 6) body.push(trimmed);
	}
	return [...metas, ...heads, body.join(' ').slice(0, 240)].filter(Boolean).join('\n').slice(0, 900);
}

/* 候选路由: 显式指定 > 配置里钉的 > 按注册顺序把所有 provider(各取第一个模型)都排上。
 * 有的 route 没有凭据会立刻失败, 所以实际调用要能顺着往下试。 */
const AI_MAX_ROUTES = 4;

async function resolveRoutes(llm, config, override) {
	const pinnedProvider = String((override && override.provider) || config.gitProvider || '').trim();
	const pinnedModel = String((override && override.model) || config.gitModel || '').trim();
	if (pinnedProvider !== '' && pinnedModel !== '') return [{ provider: pinnedProvider, model: pinnedModel }];
	let providers = [];
	try {
		providers = llm.listProviders() ?? [];
	} catch {
		providers = [];
	}
	if (pinnedProvider !== '') providers = providers.filter((item) => item && item.id === pinnedProvider);
	const routes = [];
	for (const provider of providers) {
		let models = [];
		try {
			models = (await llm.listModels(provider.id)) ?? [];
		} catch {
			models = [];
		}
		for (const model of models) {
			if (pinnedModel !== '' && model.id !== pinnedModel) continue;
			routes.push({ provider: provider.id, model: model.id });
			break; /* 每个 provider 只试它的第一个模型(或配置指定的那个) */
		}
		if (routes.length >= AI_MAX_ROUTES) break;
	}
	return routes;
}

function parseCandidates(raw) {
	const seen = new Set();
	const out = [];
	for (const row of String(raw ?? '').split('\n')) {
		let text = row.trim();
		if (text === '') continue;
		text = text
			.replace(/^[-*•]\s*/, '')
			.replace(/^\d+[.、)]\s*/, '')
			.replace(/^["'`「『]+/, '')
			.replace(/["'`」』]+$/, '')
			.trim();
		if (text.length < 4) continue;
		if (/^(commit message|提交信息|候选|here|sure|当然|以下是)/i.test(text)) continue;
		if (text.length > 120) text = text.slice(0, 120);
		const key = text.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(text);
		if (out.length >= AI_CANDIDATES) break;
	}
	return out;
}

/* 提示词: 仓库说明 + 最近几条 commit message 的风格 + 每个改动文件的路径/状态/摘录 */
async function buildPrompt(ctx, status, config) {
	const rows = [];
	/* git 仓库根可能比学习画布宽: 只读仓根之内的文件, 且必须经 ctx.fs 复核包含关系 ——
	 * 不然 `git status` 里冒出一条越级路径就能把仓库外的文件读出来喂给模型 */
	const gitRoot = await ctx.fs.resolve(status.root);
	for (const file of status.files.slice(0, AI_MAX_FILES)) {
		let detail = '';
		if (!/D/.test(file.code) && status.root) {
			try {
				const target = await ctx.fs.resolve(join(status.root, file.path));
				if (ctx.fs.contains(gitRoot, target)) {
					const info = await ctx.fs.stat(target);
					if (info && info.type === 'file') detail = excerpt(await ctx.fs.readText(target));
				}
			} catch {
				detail = '';
			}
		}
		rows.push('- ' + file.path + '（' + stateLabel(file.code) + ' ' + file.code.trim() + '）' + (detail === '' ? '' : '\n' + detail));
	}
	if (status.files.length > AI_MAX_FILES) rows.push('- …另有 ' + (status.files.length - AI_MAX_FILES) + ' 个文件');
	const style = (await run(ctx, config.root, ['log', '-8', '--pretty=%s'])).stdout
		.split('\n')
		.map((row) => row.trim())
		.filter(Boolean);
	const parts = ['仓库: 学习笔记仓库 rk-study —— 笔记在 ' + config.noteDir + '/, 题目在 ' + config.questionDir + '/。'];
	if (style.length > 0) parts.push('最近的 commit message 风格参考:\n' + style.map((row) => '- ' + row).join('\n'));
	parts.push('本次要提交的改动(' + status.files.length + ' 个文件):\n' + rows.join('\n'));
	parts.push('请给出 ' + AI_CANDIDATES + ' 条候选 commit message, 每行一条。');
	return parts.join('\n\n');
}

/* cordis 只允许直接读 inject 里声明过的服务 —— 没声明就写 ctx.llm 的话, 那句读取自己就会抛
 * `cannot get property "llm" without inject`(整条请求 500, 面板上就是「AI 生成失败」)。
 * llm 故意不进 inject: 没配模型的 profile 也该能正常打开笔记面板。所以这里走「不需要 inject」的读法,
 * 按可靠性依次尝试 ctx.get(name)(cordis 从 reflect 混入到 ctx 上的方法) 与 ctx.reflect.get(name, false)
 * (非严格读法, 不挑 service 所属 fiber 的状态)。拿不到就返回 null, 上游照旧回 llm-unavailable。 */
function serviceOf(ctx, name) {
	if (!ctx) return null;
	try {
		const direct = ctx[name];
		if (direct) return direct;
	} catch {
		/* 没在 inject 里声明过: 落到下面两条不需要 inject 的读法 */
	}
	try {
		if (typeof ctx.get === 'function') {
			const found = ctx.get(name);
			if (found) return found;
		}
	} catch {
		/* ignore */
	}
	try {
		if (ctx.reflect && typeof ctx.reflect.get === 'function') return ctx.reflect.get(name, false) || null;
	} catch {
		/* ignore */
	}
	return null;
}

async function streamCandidates(ctx, route, prompt) {
	const text = [];
	const seen = [];
	let failure = null;
	try {
		const llm = serviceOf(ctx, 'llm');
		if (!llm) return { ok: false, error: 'llm-unavailable', message: '当前环境没有模型服务' };
		const stream = llm.stream({
			provider: route.provider,
			model: route.model,
			system: AI_SYSTEM,
			messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
			temperature: 0.3,
			maxTokens: AI_MAX_TOKENS,
			signal: AbortSignal.timeout(AI_TIMEOUT_MS),
		});
		for await (const chunk of stream) {
			if (!chunk) continue;
			if (seen.length < 8) seen.push(String(JSON.stringify(chunk)).slice(0, 300));
			if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind !== 'stop' && chunk.reason.kind !== 'tool-calls' && chunk.reason.kind !== 'max-tokens') failure = chunk.reason;
			if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text.push(chunk.text);
		}
	} catch (error) {
		return { ok: false, error: 'llm-failed', message: String((error && error.message) || error) };
	}
	const raw = text.join('');
	const candidates = parseCandidates(raw);
	if (candidates.length === 0) {
		if (failure) {
			const detail = (failure.failure && (failure.failure.message || failure.failure.code)) || failure.kind;
			return { ok: false, error: 'llm-failed', message: String(detail), failure, seen };
		}
		return { ok: false, error: 'llm-empty', message: '模型没有给出可用的提交信息', raw: raw.slice(0, 300), seen };
	}
	return { ok: true, candidates, seen };
}

export async function gitMessage(ctx, config, options, signal) {
	const scope = options?.scope === 'notes' ? 'notes' : 'all';
	const status = await gitStatus(ctx, config, { scope }, signal);
	if (status.ok !== true) return status;
	if (status.files.length === 0) return { ok: false, error: 'nothing-to-commit', message: '没有需要提交的改动' };
	const llm = serviceOf(ctx, 'llm');
	if (!llm) return { ok: false, error: 'llm-unavailable', message: '当前环境没有模型服务' };
	const routes = await resolveRoutes(llm, config, options);
	if (routes.length === 0) return { ok: false, error: 'llm-model-unavailable', message: '没找到可用的模型: 可以在插件配置里指定 gitProvider / gitModel' };
	const prompt = await buildPrompt(ctx, status, config);
	const tried = [];
	let last = null;
	for (const route of routes) {
		const out = await streamCandidates(ctx, route, prompt);
		const label = route.provider + '/' + route.model;
		if (out.ok) return { ok: true, candidates: out.candidates, provider: route.provider, model: route.model, files: status.files.length, tried };
		tried.push(label + ': ' + String(out.message || out.error));
		last = Object.assign({}, out, { provider: route.provider, model: route.model });
		if (out.error === 'llm-empty') break; /* 模型答了但没可用内容, 换 route 也一样 */
	}
	return Object.assign({}, last, { tried });
}

/* 面板/排障用: 当前环境有哪些 provider / model 可选 */
export async function gitModels(ctx) {
	const llm = serviceOf(ctx, 'llm');
	if (!llm) return { ok: false, error: 'llm-unavailable', message: '当前环境没有模型服务' };
	const providers = [];
	for (const provider of llm.listProviders() ?? []) {
		let models = [];
		try {
			models = (await llm.listModels(provider.id)) ?? [];
		} catch {
			models = [];
		}
		providers.push({ id: provider.id, name: provider.name, models: models.map((model) => ({ id: model.id, name: model.name })) });
	}
	return { ok: true, providers };
}
