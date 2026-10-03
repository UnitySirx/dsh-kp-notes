/* rk-study · client/css.js —— 样式
 *
 * 由入口 client.js 用原生 import() 加载的 ES 模块(loader 的 chunk 协议只认插件根目录的
 * client.<名>.js, 装不下子目录)。依赖由入口注入, 本文件不碰 window.__ModuleLoader__。
 */
export function createCss(deps) {
	/* ===================== Material Design 配色（可切换皮肤） =====================
	 * 每套皮肤 = Material 500 主色 + Material 300 亮色, 深底色/文字按主色的色相算出来,
	 * 这样每套皮肤的层次与对比度保持一致, 只有"色"不同 —— 方便直接对比。
	 * tech 是原来的黑蓝科技主题, 就是 .rk-root 里的那套, 不额外生成。 */
	const SKINS = [
		{ id: 'tech', name: 'skinTech', hex: '#3fb6ff' },
		{ id: 'blue', name: 'skinBlue', hex: '#2196F3', light: '#64B5F6' },
		{ id: 'cyan', name: 'skinCyan', hex: '#00BCD4', light: '#4DD0E1' },
		{ id: 'teal', name: 'skinTeal', hex: '#009688', light: '#4DB6AC' },
		{ id: 'green', name: 'skinGreen', hex: '#4CAF50', light: '#81C784' },
		{ id: 'lime', name: 'skinLime', hex: '#CDDC39', light: '#DCE775' },
		{ id: 'amber', name: 'skinAmber', hex: '#FFC107', light: '#FFD54F' },
		{ id: 'orange', name: 'skinOrange', hex: '#FF9800', light: '#FFB74D' },
		{ id: 'deepOrange', name: 'skinDeepOrange', hex: '#FF5722', light: '#FF8A65' },
		{ id: 'red', name: 'skinRed', hex: '#F44336', light: '#E57373' },
		{ id: 'pink', name: 'skinPink', hex: '#E91E63', light: '#F06292' },
		{ id: 'purple', name: 'skinPurple', hex: '#9C27B0', light: '#BA68C8' },
		{ id: 'deepPurple', name: 'skinDeepPurple', hex: '#673AB7', light: '#9575CD' },
		{ id: 'indigo', name: 'skinIndigo', hex: '#3F51B5', light: '#7986CB' },
		{ id: 'blueGrey', name: 'skinBlueGrey', hex: '#607D8B', light: '#90A4AE' },
	];

	function rgbTriple(hex) {
		const n = parseInt(String(hex).replace('#', ''), 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',');
	}
	function hueOf(hex) {
		const n = parseInt(String(hex).replace('#', ''), 16);
		const r = ((n >> 16) & 255) / 255;
		const g = ((n >> 8) & 255) / 255;
		const b = (n & 255) / 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const d = max - min;
		if (d === 0) return 210;
		let h;
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		return Math.round((h * 60 + 360) % 360);
	}
	/* 只生成非默认皮肤: 同一套变量名, 值按各自主色算 */
	const SKIN_CSS = SKINS.filter((skin) => skin.id !== 'tech')
		.map((skin) => {
			const h = hueOf(skin.hex);
			const dark = (l) => `hsl(${h} 40% ${l}%)`;
			return [
				`.rk-root.rk-skin-${skin.id} {`,
				`  --rk-a1:${rgbTriple(skin.light)}; --rk-a2:${rgbTriple(skin.hex)}; --rk-a3:${rgbTriple(skin.light)};`,
				`  --rk-accent:${skin.hex}; --rk-accent-2:${skin.light}; --rk-violet:hsl(${h} 74% 68%);`,
				`  --rk-t2:${skin.light}; --rk-t3:hsl(${(h + 62) % 360} 92% 68%); --rk-t4:hsl(${(h + 128) % 360} 90% 70%); --rk-t5:hsl(${(h + 200) % 360} 92% 72%); --rk-t6:hsl(${(h + 268) % 360} 88% 70%);`,
				`  --rk-bg-0:${dark(3.4)}; --rk-bg-1:${dark(6)}; --rk-bg-2:${dark(9.4)}; --rk-bg-3:${dark(14)};`,
				`  --rk-line-1:rgba(${rgbTriple(skin.hex)},.14); --rk-line-2:rgba(${rgbTriple(skin.hex)},.26); --rk-line-3:rgba(${rgbTriple(skin.hex)},.46);`,
				`  --rk-text:hsl(${h} 26% 96%); --rk-text-2:hsl(${h} 16% 71%);`,
				`  --rk-panel:linear-gradient(180deg, ${dark(7)}, ${dark(4)});`,
				`  --rk-glow:0 0 0 1px rgba(${rgbTriple(skin.hex)},.2), 0 16px 36px rgba(1,6,16,.62);`,
				'}',
			].join('\n');
		})
		.join('\n');

	const CSS = `
.rk-root { display:flex; flex-direction:column; height:100%; min-height:0; position:relative; container-type:inline-size; container-name:rk; color:var(--rk-text); background:var(--rk-bg-0); }
.rk-head { display:flex; align-items:center; gap:12px; padding:12px 18px; border-bottom:1px solid var(--rk-line-1); background:var(--rk-bg-1); flex:0 0 auto; }
.rk-badge { display:inline-flex; align-items:center; gap:6px; padding:4px 9px; border-radius:6px; border:1px solid var(--rk-line-2); background:var(--rk-bg-2); font-size:11px; letter-spacing:.04em; color:var(--rk-text-2); }
.rk-dot { width:7px; height:7px; border-radius:50%; background:var(--rk-accent); box-shadow:0 0 8px var(--rk-accent); }
.rk-headText { display:flex; flex-direction:column; gap:2px; flex:1 1 auto; min-width:0; }
.rk-h1 { font-size:15px; font-weight:600; letter-spacing:.02em; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rk-h2 { font-size:11px; color:var(--rk-text-2); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rk-stats { display:flex; align-items:center; gap:6px; margin-left:auto; flex-wrap:wrap; justify-content:flex-end; }
.rk-stat { display:inline-flex; align-items:baseline; gap:4px; padding:3px 8px; border-radius:6px; background:var(--rk-bg-2); border:1px solid var(--rk-line-1); font-size:11px; color:var(--rk-text-2); }
.rk-stat b { font-size:12px; color:var(--rk-accent); font-weight:600; }
.rk-btn { display:inline-flex; align-items:center; gap:6px; padding:5px 11px; border-radius:7px; border:1px solid var(--rk-line-2); background:var(--rk-bg-2); color:var(--rk-text); font-size:12px; cursor:pointer; transition:border-color .15s,color .15s,background .15s; }
.rk-btn:hover { border-color:var(--rk-accent); color:var(--rk-accent); }
.rk-btn.rk-primary { border-color:var(--rk-accent); color:var(--rk-accent); }
.rk-btn[disabled] { opacity:.5; cursor:default; }
.rk-btn.rk-ghost { border-color:transparent; background:transparent; }
.rk-btn.rk-danger { border-color:var(--rk-line-3, var(--rk-line-2)); color:var(--rk-danger, #e5484d); }
.rk-btn.rk-danger:hover { border-color:var(--rk-danger, #e5484d); color:var(--rk-danger, #e5484d); }
.rk-del { display:inline-flex; align-items:center; gap:4px; margin-left:4px; position:relative; }
.rk-del .rk-btn { padding:3px 8px; font-size:11px; }
/* 二次确认飘在按钮上方(绝对定位, 不占布局) —— 按钮不会因为多出「确认删除？」而换行/位移,
   同一个位置再点一次仍然是「删除」, 不会误触「取消」 */
.rk-del-pop { position:absolute; top:50%; right:0; transform:translateY(-50%); z-index:9; display:flex; align-items:center; gap:8px; padding:5px 8px; border-radius:10px; background:#0b1528; border:1px solid var(--rk-line-3); box-shadow:0 14px 34px rgba(1,6,16,.66); white-space:nowrap; }
.rk-del-pop .rk-sec-sub { font-size:11px; }
.rk-toolbar { display:flex; align-items:center; gap:10px; padding:9px 18px; border-bottom:1px solid var(--rk-line-1); flex:0 0 auto; flex-wrap:wrap; }
.rk-input { flex:1 1 240px; min-width:160px; padding:6px 10px; border-radius:7px; border:1px solid var(--rk-line-2); background:var(--rk-bg-1); color:var(--rk-text); font-size:12px; outline:none; }
.rk-input:focus { border-color:var(--rk-accent); }
.rk-seg { display:inline-flex; border:1px solid var(--rk-line-2); border-radius:7px; overflow:hidden; }
.rk-seg button { padding:5px 11px; border:0; background:var(--rk-bg-1); color:var(--rk-text-2); font-size:12px; cursor:pointer; }
.rk-seg button + button { border-left:1px solid var(--rk-line-1); }
.rk-seg button.rk-on { background:var(--rk-bg-2); color:var(--rk-accent); }
.rk-crumbs { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--rk-text-2); }
.rk-crumbs b { color:var(--rk-text); font-weight:600; }
.rk-stage { flex:1 1 auto; min-height:0; overflow:auto; position:relative; z-index:0; padding:20px 22px 60px; background-color:var(--rk-bg-0); background-image:linear-gradient(rgba(var(--rk-a3),.06) 1px, transparent 1px), linear-gradient(90deg, rgba(var(--rk-a3),.06) 1px, transparent 1px); background-size:26px 26px; }
.rk-plane { position:absolute; left:0; top:0; transform-origin:0 0; }
/* 画布/导图整体是缩放过的(transform: scale), 让浏览器按几何精度排版与栅格化:
   optimizeLegibility 会把字形度量四舍五入到整数, 缩放后反而更容易发虚 */
.rk-plane { text-rendering:geometricPrecision; }
.rk-stage.rk-canvas { overflow:hidden; padding:0; cursor:grab; touch-action:none; }
.rk-stage.rk-canvas.rk-panning { cursor:grabbing; }
.rk-stage.rk-canvas.rk-interacting { user-select:none; }
.rk-plain { position:absolute; inset:0; overflow:auto; padding:22px 24px 60px; }
.rk-chapter { position:absolute; border:1px solid var(--rk-line-2); border-radius:14px; background:var(--rk-bg-1); overflow:hidden; display:flex; flex-direction:column; box-shadow:0 10px 26px rgba(0,0,0,.18); }
.rk-chapter::before { content:''; position:absolute; inset:0 0 auto 0; height:2px; background:linear-gradient(90deg, var(--rk-accent), transparent 72%); opacity:.75; }
.rk-chapter-head { display:flex; align-items:flex-start; gap:10px; padding:13px 14px 10px; }
.rk-chapter-no { flex:0 0 auto; width:30px; height:30px; border-radius:8px; border:1px solid var(--rk-line-2); display:flex; align-items:center; justify-content:center; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; color:var(--rk-accent); background:var(--rk-bg-2); }
.rk-chapter-title { font-size:14px; font-weight:600; line-height:1.35; }
.rk-chapter-path { font-size:10.5px; color:var(--rk-text-2); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; margin-top:3px; word-break:break-all; }
.rk-chapter-meta { display:flex; gap:10px; padding:0 14px 10px; font-size:11px; color:var(--rk-text-2); flex-wrap:wrap; align-items:center; }
.rk-chapter-meta span b { color:var(--rk-text); font-weight:600; }
.rk-sections { display:flex; flex-direction:column; border-top:1px solid var(--rk-line-1); }
.rk-sec { display:flex; align-items:center; gap:10px; padding:9px 14px; border:0; border-bottom:1px solid var(--rk-line-1); background:transparent; color:inherit; text-align:left; cursor:pointer; width:100%; box-sizing:border-box; padding-right:0; font:inherit; }
.rk-sec:last-child { border-bottom:0; }
.rk-sec-idx { flex:0 0 auto; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px; color:var(--rk-text-2); width:22px; }
.rk-sec-main { min-width:0; flex:1 1 auto; display:flex; flex-direction:column; }
.rk-sec-title { font-size:12.5px; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.rk-sec-sub { font-size:10.5px; color:var(--rk-text-2); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.rk-chip { display:inline-flex; align-items:center; padding:1px 6px; border-radius:5px; border:1px solid var(--rk-line-1); background:var(--rk-bg-2); font-size:10px; color:var(--rk-text-2); white-space:nowrap; }
.rk-chip.rk-q { border-color:var(--rk-warn); color:var(--rk-warn); }
.rk-chip.rk-brand { border-color:var(--rk-accent); color:var(--rk-accent); }
/* 一级画布: 每个学习画布(笔记根目录)一张卡片 */
/* 导入目录: 一个输入框 + 一个「选择…」按钮 */
.rk-librow { display:flex; align-items:center; gap:8px; }
.rk-librow .rk-input { flex:1 1 auto; min-width:0; }
.rk-librow .rk-btn { flex:0 0 auto; }

.rk-settings { width:min(560px, 92%); }
.rk-settings-label { margin:10px 0 6px; font-size:12.4px; font-weight:600; color:var(--rk-text); }
.rk-settings-hint { margin:8px 0 0; font-size:11.6px; line-height:1.65; color:var(--rk-text-2); }
.rk-settings-rows { margin:12px 0 0; border:1px solid var(--rk-line-2); border-radius:10px; overflow:hidden; }
.rk-settings-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:7px 10px; font-size:11.8px; }
.rk-settings-row + .rk-settings-row { border-top:1px solid var(--rk-line-2); }
.rk-settings-row span { flex:0 0 auto; color:var(--rk-text-2); }
.rk-settings-row b { min-width:0; font-weight:600; color:var(--rk-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rk-rootcard { position:absolute; border:1px solid var(--rk-line-2); border-radius:14px; background:var(--rk-bg-1); overflow:hidden; display:flex; flex-direction:column; box-shadow:0 10px 26px rgba(0,0,0,.18); cursor:pointer; user-select:none; -webkit-user-select:none; pointer-events:none; }
.rk-rootcard::before { content:''; position:absolute; inset:0 0 auto 0; height:2px; background:linear-gradient(90deg, var(--rk-accent), transparent 72%); opacity:.75; }
.rk-rootcard:hover { border-color:var(--rk-accent); }
.rk-rootcard-head { display:flex; align-items:center; gap:9px; padding:13px 14px 8px; }
.rk-rootcard-icon { font-size:15px; }
.rk-rootcard-name { font-size:14.5px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rk-rootcard-path { padding:0 14px; font-size:10.5px; color:var(--rk-text-2); font-family:var(--rk-mono); word-break:break-all; }
.rk-rootcard-stats { display:flex; flex-wrap:wrap; gap:6px 14px; padding:10px 14px 0; font-size:11px; color:var(--rk-text-2); }
.rk-rootcard-stat b { color:var(--rk-text); font-weight:600; margin-right:3px; }
.rk-rootcard-foot { margin-top:auto; display:flex; align-items:center; gap:8px; padding:10px 14px; border-top:1px solid var(--rk-line-1); }
.rk-rootcard-enter { flex:1 1 auto; font-size:11.5px; color:var(--rk-accent); }
/* 画布卡片整体「穿透」：卡片空白处按住拖动 = 直接拖动画布(指针事件落到 stage 上)，只有真正要执行事件的部件才接收事件 */
.rk-rootcard-new { pointer-events:auto; }
.rk-rootcard button, .rk-rootcard .rk-rootcard-enter { pointer-events:auto; }
.rk-rootcard-new { align-items:center; justify-content:center; gap:6px; border-style:dashed; background:transparent; }
.rk-rootcard-new::before { display:none; }
.rk-rootcard-new:hover { background:rgba(var(--rk-a2),.05); }
.rk-rootcard-plus { font-size:22px; color:var(--rk-accent); }
.rk-rootcard-newlabel { font-size:13.5px; font-weight:600; }
.rk-rootcard-hint { padding:0 22px; text-align:center; font-size:11px; color:var(--rk-text-2); line-height:1.6; }
.rk-rootdialog-row { display:flex; align-items:center; gap:10px; margin-top:10px; }
.rk-rootdialog-label { flex:0 0 62px; font-size:12px; color:var(--rk-text-2); }
.rk-rootdialog-row .rk-input { flex:1 1 auto; }
.rk-rootdialog-hint { margin-top:8px; font-size:11px; color:var(--rk-text-2); line-height:1.6; }
.rk-rootdialog-error { margin-top:8px; font-size:11.5px; color:#ff8095; }
.rk-toolbar-hint { flex:1 1 160px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11.5px; color:var(--rk-text-2); }

.rk-cardwall { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(320px, 100%),1fr)); gap:14px; }
.rk-point { display:flex; flex-direction:column; border:1px solid var(--rk-line-2); border-radius:13px; background:var(--rk-bg-1); overflow:hidden; cursor:pointer; transition:border-color .15s, transform .15s, box-shadow .15s; }
.rk-point:hover { border-color:var(--rk-accent); transform:translateY(-1px); box-shadow:0 12px 24px rgba(0,0,0,.22); }
.rk-point-head { display:flex; align-items:flex-start; gap:9px; padding:12px 13px 8px; }
.rk-point-no { flex:0 0 auto; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px; color:var(--rk-accent); padding-top:2px; }
.rk-point-title { font-size:13.5px; font-weight:600; line-height:1.4; }
.rk-point-body { padding:0 13px 10px; font-size:12px; color:var(--rk-text-2); line-height:1.6; max-height:96px; overflow:hidden; }
.rk-point-foot { display:flex; align-items:center; gap:6px; padding:8px 13px; border-top:1px solid var(--rk-line-1); flex-wrap:wrap; }
.rk-doc { max-width:920px; }
.rk-panel { border:1px solid var(--rk-line-2); border-radius:13px; background:var(--rk-bg-1); padding:14px 16px; margin-bottom:14px; }
.rk-panel-title { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--rk-text-2); letter-spacing:.05em; margin-bottom:10px; flex-wrap:wrap; }
.rk-panel-title b { color:var(--rk-text); font-size:13px; letter-spacing:0; }
.rk-subpoint { --rk-tone:var(--rk-accent); margin-top:10px; padding:10px 12px; border-left:2px solid var(--rk-tone); border-radius:0 9px 9px 0; background:rgba(var(--rk-a2),.05); }
.rk-subpoint.rk-lv2 { --rk-tone:var(--rk-t2); border-left-width:3px; }
.rk-subpoint.rk-lv3 { --rk-tone:var(--rk-t3); }
.rk-subpoint.rk-lv4 { --rk-tone:var(--rk-t4); }
.rk-subpoint.rk-lv5 { --rk-tone:var(--rk-t5); }
.rk-subpoint.rk-lv6 { --rk-tone:var(--rk-t6); }
.rk-subpoint + .rk-subpoint { margin-top:8px; }
.rk-subpoint-head { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
.rk-subpoint-head b { color:var(--rk-tone); font-size:13px; letter-spacing:0; }
.rk-subpoint-no { min-width:20px; justify-content:center; font-family:var(--rk-mono); color:var(--rk-tone); border-color:rgba(var(--rk-a2),.35); }
/* 小知识点标题同样分级(2..6): 级数越浅越大越亮, 左侧色条也跟着变 */
.rk-subpoint-head b.rk-subpoint-lv2 { font-size:16px; font-weight:800; }
.rk-subpoint-head b.rk-subpoint-lv3 { font-size:14.8px; font-weight:700; }
.rk-subpoint-head b.rk-subpoint-lv4 { font-size:13.4px; }
.rk-subpoint-head b.rk-subpoint-lv5 { font-size:12.8px; }
.rk-subpoint-head b.rk-subpoint-lv6 { font-size:12.3px; letter-spacing:.04em; }
.rk-md-h { margin:14px 0 8px; line-height:1.45; }
/* 标题分级: 六级各占一档大小 + 一档颜色(越浅越醒目), 正文里一眼能看出层级 */
.rk-md-h1 { margin:18px 0 10px; font-size:20px; font-weight:800; letter-spacing:.2px; }
.rk-md-h2 { margin:16px 0 8px; padding-left:9px; border-left:3px solid currentColor; font-size:17px; font-weight:700; color:var(--rk-t2); }
.rk-md-h3 { margin:14px 0 7px; padding-left:8px; border-left:2px solid currentColor; font-size:15px; font-weight:700; color:var(--rk-t3); }
.rk-md-h4 { margin:12px 0 6px; font-size:13.6px; font-weight:600; color:var(--rk-t4); }
.rk-md-h5 { margin:12px 0 6px; font-size:12.8px; font-weight:600; letter-spacing:.04em; color:var(--rk-t5); }
.rk-md-h6 { margin:10px 0 5px; font-size:12px; font-weight:600; letter-spacing:.08em; color:var(--rk-t6); }
.rk-md-p { margin:8px 0; line-height:1.75; font-size:12.5px; }
.rk-md-list { margin:8px 0; padding-left:18px; font-size:12.5px; line-height:1.75; }
.rk-md-list li { margin:3px 0; }
.rk-md-quote { margin:10px 0; padding:8px 12px; border-left:2px solid var(--rk-accent); background:var(--rk-bg-2); border-radius:0 8px 8px 0; font-size:12.5px; line-height:1.7; color:var(--rk-text-2); }
.rk-md-pre { margin:10px 0; padding:10px 12px; border-radius:9px; border:1px solid var(--rk-line-1); background:var(--rk-bg-2); overflow:auto; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11.5px; line-height:1.6; }
.rk-md-tablewrap { margin:10px 0; overflow:auto; border:1px solid var(--rk-line-1); border-radius:9px; }
.rk-md-table { border-collapse:collapse; width:100%; font-size:12px; }
.rk-md-table th, .rk-md-table td { padding:7px 10px; border-bottom:1px solid var(--rk-line-1); text-align:left; }
.rk-md-table th { background:var(--rk-bg-2); color:var(--rk-text-2); font-weight:600; white-space:nowrap; }
.rk-md-table tr:last-child td { border-bottom:0; }
.rk-md-hr { margin:14px 0; border:0; border-top:1px solid var(--rk-line-1); }
.rk-code-inline { padding:1px 5px; border-radius:5px; background:var(--rk-bg-2); border:1px solid var(--rk-line-1); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11.5px; }
.rk-example { margin:14px 0; border:1px solid var(--rk-line-2); border-left:2px solid var(--rk-accent); border-radius:0 12px 12px 0; background:var(--rk-bg-2); padding:12px 14px; }
.rk-example-title { display:flex; align-items:center; gap:8px; font-size:12.5px; font-weight:600; margin-bottom:8px; flex-wrap:wrap; }
.rk-options { display:flex; flex-direction:column; gap:5px; margin:8px 0; }
.rk-option { display:flex; gap:8px; font-size:12.5px; line-height:1.6; }
.rk-option b { flex:0 0 auto; width:18px; height:18px; border-radius:5px; border:1px solid var(--rk-line-2); display:flex; align-items:center; justify-content:center; font-size:10.5px; color:var(--rk-text-2); }
.rk-answer { margin-top:10px; border:1px dashed var(--rk-warn); border-radius:10px; overflow:hidden; }
.rk-answer-bar { display:flex; align-items:center; gap:8px; width:100%; padding:8px 11px; border:0; background:transparent; color:var(--rk-warn); font-size:12px; cursor:pointer; text-align:left; font:inherit; }
.rk-answer-bar:hover { background:var(--rk-bg-1); }
.rk-answer-body { padding:2px 12px 10px; border-top:1px dashed var(--rk-line-2); }
.rk-detail { position:relative; flex:0 0 auto; width:min(52%, 760px); min-width:340px; display:flex; flex-direction:column; min-height:0; border-left:1px solid var(--rk-line-2); background:var(--rk-bg-1); box-shadow:-18px 0 40px rgba(0,0,0,.3); animation:rk-slide .18s ease-out; }
.rk-detail-bar { flex:0 0 auto; display:flex; align-items:center; gap:8px; padding:7px 10px; border-bottom:1px solid var(--rk-line-1); background:linear-gradient(180deg, rgba(8,16,32,.72), rgba(4,10,22,.42)); }
.rk-detail-name { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:var(--rk-mono); font-size:11.5px; color:#7f9ec2; }
.rk-detail-body { flex:1 1 auto; min-height:0; overflow:auto; padding:14px 16px 48px; }
@keyframes rk-slide { from { transform:translateX(12px); opacity:.35; } to { transform:none; opacity:1; } }
.rk-drawer { position:absolute; inset:0 0 0 auto; width:min(620px, 92%); display:flex; flex-direction:column; border-left:1px solid var(--rk-line-2); background:var(--rk-bg-1); box-shadow:-18px 0 40px rgba(0,0,0,.3); z-index:5; }
.rk-drawer-head { display:flex; align-items:center; gap:10px; padding:12px 14px; border-bottom:1px solid var(--rk-line-1); flex-wrap:wrap; }
.rk-drawer-body { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; padding:12px 14px; gap:10px; }
.rk-field { display:flex; flex-direction:column; gap:5px; }
.rk-field label { font-size:11px; color:var(--rk-text-2); }
.rk-field .rk-input { flex:0 0 auto; width:100%; box-sizing:border-box; height:34px; }
.rk-textarea { flex:1 1 auto; min-height:220px; resize:none; padding:11px 12px; border-radius:9px; border:1px solid var(--rk-line-2); background:var(--rk-bg-0); color:var(--rk-text); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; line-height:1.65; outline:none; tab-size:2; }
.rk-textarea:focus { border-color:var(--rk-accent); }
/* zt-react-milkdown 编辑器(编辑抽屉里的所见即所得视图) —— 编辑器样式来自
 * vendor/zt-milkdown/zt-milkdown.css, 那份 css 全限定在 .zt-md-editor 命名空间里; 这里只给个能撑满抽屉的壳 */
.rk-mdedit { flex:1 1 auto; min-height:220px; min-width:0; overflow:auto; padding:2px 4px; border:1px solid var(--rk-line-2); border-radius:9px; background:var(--rk-bg-0); }
.rk-mdedit > * { min-width:0; }
.rk-mdedit .zt-md-editor { background:transparent; }

/* 富文本里的标题按层级上色: 和「配色」里的 --rk-t2..t6 同一套色, 与预览 / 思维导图保持一致。
   （h1 不用 .rk-md-h1 那套渐变文字: color:transparent 会让光标看不见。） */
.rk-mdedit .zt-md-editor h1 { color:#eef7ff; }
.rk-mdedit .zt-md-editor h2 { color:var(--rk-t2); border-left:3px solid currentColor; padding-left:9px; }
.rk-mdedit .zt-md-editor h3 { color:var(--rk-t3); border-left:2px solid currentColor; padding-left:8px; }
.rk-mdedit .zt-md-editor h4 { color:var(--rk-t4); }
.rk-mdedit .zt-md-editor h5 { color:var(--rk-t5); }
.rk-mdedit .zt-md-editor h6 { color:var(--rk-t6); }

/* 弹窗(题干 / 答案 / 解析 / 正文)里的富文本字段: 包自己的 min-height 是 160px, 对这几个小字段太高, 收一点 */
.rk-mdfield { min-height:0; }
.rk-mdfield .zt-md-editor { min-height:110px !important; max-height:300px; overflow:auto; font-size:13px; }
.rk-field.rk-grow .rk-mdfield { flex:1 1 auto; }
.rk-field.rk-grow .rk-mdfield .zt-md-editor { max-height:none; }
.rk-mdfield.rk-md-wait { min-height:110px; }
.rk-md-wait { display:flex; align-items:center; justify-content:center; color:var(--rk-text-2); font-size:12px; }
.rk-drawer-body.rk-split > .rk-mdedit { flex:1 1 0; }
.rk-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.rk-drawer-foot { display:flex; align-items:center; gap:8px; padding:11px 14px; border-top:1px solid var(--rk-line-1); }
.rk-toast { position:absolute; left:50%; bottom:22px; transform:translateX(-50%); padding:8px 14px; border-radius:9px; border:1px solid var(--rk-accent); background:var(--rk-bg-2); color:var(--rk-text); font-size:12px; z-index:9; box-shadow:0 8px 24px rgba(0,0,0,.3); }
.rk-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding:56px 20px; text-align:center; color:var(--rk-text-2); font-size:12.5px; }
.rk-err { border-color:var(--rk-danger); color:var(--rk-danger); }
.rk-score { font-size:11px; color:var(--rk-text-2); }

/* ===================== 黑蓝科技主题 (rk-study skin) ===================== */
.rk-root {
  --rk-bg-0:#03070f; --rk-bg-1:#060d1c; --rk-bg-2:#0a1426; --rk-bg-3:#0f1e38;
  --rk-line-1:rgba(var(--rk-a2),.14); --rk-line-2:rgba(var(--rk-a2),.26); --rk-line-3:rgba(var(--rk-a2),.46);
  --rk-accent:#3fb6ff; --rk-accent-2:#22e0ff; --rk-violet:#7c6cff;
  /* 标题分级色: 2 青 → 3 紫 → 4 粉 → 5 琥珀 → 6 绿(其他皮肤由主色色相旋转算出来) */
  --rk-t2:#22e0ff; --rk-t3:#a162f9; --rk-t4:#f76eb0; --rk-t5:#f9d476; --rk-t6:#83f66f;
  /* 皮肤只换这三个色相三元组 + 底色, 下面所有 rgba(...) 都走它们, 换配色不用改规则 */
  --rk-a1:34,224,255; --rk-a2:63,182,255; --rk-a3:120,150,255;
  --rk-text:#e8f2ff; --rk-text-2:#93a9c9; --rk-warn:#ffc247; --rk-danger:#ff6b81;
  --rk-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --rk-panel:linear-gradient(180deg, rgba(11,21,40,.9), rgba(5,11,24,.94));
  --rk-glow:0 0 0 1px rgba(var(--rk-a2),.2), 0 16px 36px rgba(1,6,16,.62);
  background:var(--rk-bg-0); color:var(--rk-text);
  font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
}
.rk-root ::selection { background:rgba(var(--rk-a1),.3); color:#f2fcff; }
.rk-root *:focus-visible { outline:1px solid var(--rk-accent-2); outline-offset:1px; }

@keyframes rk-pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:.5; transform:scale(.8); } }
@keyframes rk-rise { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
@keyframes rk-sheen { 0% { background-position:-140% 0; } 100% { background-position:240% 0; } }

/* 顶部信息条: 发光分隔线 + 渐变标题 */
.rk-head { position:relative; background:linear-gradient(180deg, rgba(10,20,38,.95), rgba(5,12,26,.8)); border-bottom:1px solid var(--rk-line-2); box-shadow:0 10px 30px rgba(1,6,16,.5); }
.rk-head::after { content:''; position:absolute; left:0; right:0; bottom:-1px; height:1px; background:linear-gradient(90deg, transparent, rgba(var(--rk-a1),.65) 16%, rgba(var(--rk-a3),.35) 58%, transparent); }
.rk-h1 { font-size:15.5px; letter-spacing:.05em; background:linear-gradient(92deg, #f2fbff, #86d9ff 42%, #b0a6ff); -webkit-background-clip:text; background-clip:text; color:transparent; }
.rk-h2 { font-family:var(--rk-mono); color:#6f88ad; }
.rk-dot { background:var(--rk-accent-2); box-shadow:0 0 10px var(--rk-accent-2), 0 0 24px rgba(var(--rk-a1),.55); animation:rk-pulse 2.6s ease-in-out infinite; }
.rk-badge { font-family:var(--rk-mono); background:rgba(10,22,42,.85); border:1px solid var(--rk-line-2); color:#a8c4e4; }
.rk-stat { background:rgba(8,18,36,.85); border:1px solid var(--rk-line-1); font-size:11.5px; }
.rk-stat b { font-family:var(--rk-mono); font-size:13.5px; color:var(--rk-accent-2); text-shadow:0 0 14px rgba(var(--rk-a1),.5); }

/* 按钮: 玻璃底 + 悬停霓虹 */
.rk-btn { background:linear-gradient(180deg, rgba(13,26,48,.92), rgba(6,13,28,.94)); border:1px solid var(--rk-line-2); color:#d7e8ff;
  transition:border-color .16s, color .16s, box-shadow .2s, transform .12s, background .2s; }
.rk-btn:hover { border-color:var(--rk-accent); color:#eafaff; box-shadow:inset 0 0 0 1px rgba(var(--rk-a2),.35); }
.rk-btn:active { transform:translateY(1px); }
.rk-btn.rk-primary { background:linear-gradient(135deg, rgba(var(--rk-a1),.26), rgba(var(--rk-a3),.28)); border-color:var(--rk-line-3); color:#f4fdff; box-shadow:0 0 18px rgba(var(--rk-a1),.2); }
.rk-btn.rk-primary:hover { box-shadow:inset 0 0 0 1px rgba(var(--rk-a1),.5); }
.rk-btn.rk-ghost { background:transparent; border-color:rgba(var(--rk-a2),.16); }
.rk-btn.rk-ghost:hover { background:rgba(var(--rk-a2),.09); }
.rk-btn.rk-danger { color:var(--rk-danger); border-color:rgba(255,107,129,.32); background:linear-gradient(180deg, rgba(48,14,24,.7), rgba(20,6,12,.8)); }
.rk-btn.rk-danger:hover { border-color:var(--rk-danger); color:#ffd6dd; box-shadow:inset 0 0 0 1px rgba(255,107,129,.35); }

/* 工具条与画布 */
.rk-toolbar { background:linear-gradient(180deg, rgba(8,16,32,.7), rgba(4,10,22,.4)); border-bottom:1px solid var(--rk-line-1); }
.rk-input { background:rgba(4,10,22,.92); border:1px solid var(--rk-line-2); color:var(--rk-text); }
.rk-input::placeholder { color:#5d7a9e; }
.rk-input:focus { border-color:var(--rk-accent-2); box-shadow:0 0 0 1px rgba(var(--rk-a1),.28), 0 0 22px rgba(var(--rk-a1),.18); }
.rk-stage { background-color:var(--rk-bg-0);
  background-image:
    radial-gradient(1100px 620px at 8% -12%, rgba(var(--rk-a1),.11), transparent 62%),
    radial-gradient(900px 560px at 102% -6%, rgba(var(--rk-a3),.12), transparent 58%),
    radial-gradient(700px 420px at 60% 108%, rgba(var(--rk-a2),.07), transparent 60%),
    linear-gradient(rgba(var(--rk-a2),.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--rk-a2),.055) 1px, transparent 1px);
  background-size:auto, auto, auto, 28px 28px, 28px 28px;
  box-shadow:inset 0 0 140px rgba(1,6,16,.85);
}
.rk-stage.rk-interacting .rk-plane { will-change:transform; }
/* hover 高亮画在「画布之外」的屏幕空间里: 不重绘卡片本体 → 不会触发合成层提升 → 不闪
   (画布用 transform:scale 缩放, 单独成层的内容会被重新采样, 所以卡片本体一律不做 hover 重绘) */
.rk-hover-ring { position:absolute; left:0; top:0; box-sizing:border-box; pointer-events:none; opacity:0; z-index:1; border-radius:14px; border:1px solid rgba(var(--rk-a2),.62); box-shadow:0 0 0 1px rgba(var(--rk-a1),.2), 0 0 30px rgba(var(--rk-a1),.2), inset 0 0 30px rgba(var(--rk-a1),.05); }
.rk-hover-ring.rk-on { opacity:1; }
.rk-hover-ring.rk-card { background:linear-gradient(180deg, rgba(var(--rk-a1),.07), rgba(var(--rk-a1),0) 46%); }
.rk-menu { position:absolute; left:0; top:0; z-index:8; min-width:196px; padding:5px; border-radius:11px; border:1px solid var(--rk-line-3); background:linear-gradient(180deg, rgba(12,22,42,.985), rgba(5,11,24,.99)); box-shadow:0 18px 44px rgba(1,6,16,.72), 0 0 0 1px rgba(var(--rk-a1),.06), inset 0 1px 0 rgba(120,190,255,.08); font-size:12.5px; color:var(--rk-text); user-select:none; }
.rk-menu-item { display:flex; align-items:center; gap:8px; height:30px; padding:0 10px; border-radius:7px; cursor:pointer; white-space:nowrap; }
.rk-menu-item:hover { background:linear-gradient(90deg, rgba(var(--rk-a2),.2), rgba(var(--rk-a2),.02) 78%); color:#fff; }
.rk-menu-item.rk-danger { color:var(--rk-danger); }
.rk-menu-item.rk-danger:hover { background:linear-gradient(90deg, rgba(255,107,129,.2), rgba(255,107,129,.02) 78%); color:#ffd7dd; }
.rk-menu-sep { height:1px; margin:5px 7px; background:var(--rk-line-1); }
.rk-menu-confirm { padding:7px 10px 6px; color:var(--rk-warn); line-height:1.5; }
.rk-menu-row { display:flex; gap:6px; padding:0 6px 4px; }
.rk-menu-row .rk-btn { flex:1 1 auto; justify-content:center; }
.rk-hover-ring.rk-sec { border-radius:9px; border-color:rgba(var(--rk-a2),.4); border-left:2px solid var(--rk-accent-2); background:linear-gradient(90deg, rgba(var(--rk-a2),.19), rgba(var(--rk-a2),.015) 72%); }
.rk-hover-ring.rk-mm { border-radius:9px; border-color:rgba(var(--rk-a2),.5); background:linear-gradient(90deg, rgba(var(--rk-a2),.13), rgba(var(--rk-a2),.01) 78%); }

/* ===================== 思维导图模式(左 → 右) ===================== */
.rk-modes { display:inline-flex; align-items:center; gap:2px; flex:0 0 auto; padding:2px; border:1px solid var(--rk-line-2); border-radius:9px; background:var(--rk-bg-2); }
.rk-mode { height:26px; padding:0 10px; border:0; border-radius:7px; background:transparent; color:var(--rk-text-2); font-size:12px; cursor:pointer; }
.rk-mode:hover { color:var(--rk-text); }
.rk-mode.is-on { background:linear-gradient(180deg, rgba(var(--rk-a1),.24), rgba(var(--rk-a1),.06)); color:var(--rk-text); box-shadow:inset 0 0 0 1px var(--rk-line-3); }
.rk-mm { position:relative; user-select:none; -webkit-user-select:none; }
.rk-mm-links { position:absolute; left:0; top:0; overflow:visible; pointer-events:none; }
.rk-mm-link { fill:none; stroke-width:1.6; opacity:.44; }
.rk-mm-lk-t0 { stroke:var(--rk-accent); }
.rk-mm-lk-t1 { stroke:var(--rk-t2); }
.rk-mm-lk-t2 { stroke:var(--rk-t3); }
.rk-mm-lk-t3 { stroke:var(--rk-t4); }
.rk-mm-lk-t4 { stroke:var(--rk-t5); }
.rk-mm-node { position:absolute; display:flex; align-items:center; gap:6px; box-sizing:border-box; padding:0 9px; border-radius:9px; border:1px solid var(--rk-line-2); background:linear-gradient(180deg, var(--rk-bg-2), var(--rk-bg-1)); cursor:grab; overflow:hidden; }
.rk-stage.rk-canvas.rk-panning .rk-mm-node { cursor:grabbing; }
.rk-mm-text { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--rk-text); }
.rk-mm-fold { flex:0 0 auto; width:15px; height:15px; padding:0; line-height:13px; text-align:center; border-radius:50%; border:1px solid var(--rk-line-2); background:var(--rk-bg-3); color:var(--rk-text-2); font-size:11px; cursor:pointer; }
.rk-mm-fold:hover { color:var(--rk-accent-2); border-color:var(--rk-accent); }
.rk-mm-root { border-color:var(--rk-line-3); box-shadow:0 0 26px rgba(var(--rk-a1),.16); }
.rk-mm-root .rk-mm-text { font-weight:800; letter-spacing:.06em; color:var(--rk-accent-2); }
.rk-mm-t0 { border-left:3px solid var(--rk-accent); }
.rk-mm-t1 { border-left:3px solid var(--rk-t2); }
.rk-mm-t1 .rk-mm-text { font-size:13.5px; font-weight:700; }
.rk-mm-t2 { border-left:3px solid var(--rk-t3); }
.rk-mm-t2 .rk-mm-text { font-size:12.5px; font-weight:600; }
.rk-mm-t3 { border-left:2px solid var(--rk-t4); }
.rk-mm-t3 .rk-mm-text { font-size:12px; }
/* 第 5 层: 知识点的「内容」子节点(默认收起), 里面渲染整篇 markdown */
.rk-mm-t4 { border-left:2px solid var(--rk-t5); }
/* 知识点节点: 节点里渲染这个知识点的整篇 markdown(标题 / 列表 / 代码块 / 公式 / 表格 / 流程图) */
.rk-mm-node.rk-mm-rich { flex-wrap:wrap; align-content:flex-start; padding:8px 10px; gap:6px; overflow:visible; }
.rk-mm-node.rk-mm-rich .rk-mm-text { flex:1 1 auto; }
.rk-mm-body { flex:1 0 100%; min-width:0; color:var(--rk-text-2); font-weight:500; }
/* 导图正文会被缩到 9px 上下, 中文用 Regular 笔画太细显糊 ⇒ 正文/引用/表格用 Medium;
   代码块与行内代码保持等宽常规字重(合成加粗反而更糊) */
.rk-mm-body pre, .rk-mm-body pre *, .rk-mm-body code { font-weight:400; }
.rk-mm-body > :first-child { margin-top:0; }
.rk-mm-body > :last-child { margin-bottom:0; }
.rk-mm-body .rk-md-h1 { margin:9px 0 5px; font-size:15px; }
.rk-mm-body .rk-md-h2 { margin:9px 0 5px; padding-left:7px; border-left-width:2px; font-size:14px; }
.rk-mm-body .rk-md-h3 { margin:8px 0 4px; padding-left:6px; border-left-width:2px; font-size:13px; }
.rk-mm-body .rk-md-h4 { margin:7px 0 4px; font-size:12.4px; }
.rk-mm-body .rk-md-h5, .rk-mm-body .rk-md-h6 { margin:6px 0 3px; font-size:11.8px; }
.rk-mm-body .rk-md-p, .rk-mm-body .rk-md-list { margin:6px 0; font-size:11.8px; line-height:1.65; }
.rk-mm-body .rk-md-list { padding-left:16px; }
.rk-mm-body .rk-md-quote { margin:7px 0; padding:6px 9px; font-size:11.6px; line-height:1.6; }
.rk-mm-body .rk-md-pre { margin:7px 0; padding:7px 9px; font-size:10.5px; line-height:1.5; }
.rk-mm-body .rk-md-tablewrap { margin:7px 0; }
.rk-mm-body .rk-md-table { font-size:11px; }
.rk-mm-body .rk-md-table th, .rk-mm-body .rk-md-table td { padding:5px 7px; }
.rk-mm-body .rk-md-diagram { margin:7px 0; }
.rk-mm-body .rk-md-hr { margin:9px 0; }
.rk-mm-body .rk-subpoint { margin-top:7px; padding:7px 9px; border-radius:0 8px 8px 0; }
.rk-mm-body .rk-subpoint + .rk-subpoint { margin-top:6px; }
.rk-mm-body .rk-subpoint-head { margin-bottom:4px; gap:6px; }
.rk-mm-body .rk-subpoint-no { min-width:17px; }

/* 章节卡 */
.rk-chapter { background:var(--rk-panel); border:1px solid var(--rk-line-2); box-shadow:var(--rk-glow); cursor:default; animation:rk-rise .28s ease; }
/* 画布内的元素一律不做 transition: 只要某个属性在过渡/动画中, 浏览器就会把它单独提升成合成层、
   按 1× 栅格化, 再被画布的 scale 拉伸 —— 于是鼠标划过卡片时内容会「一下清晰一下模糊」地闪。
   关掉画布内部所有 transition, hover 只做一次性重绘, 栅格比例保持恒定。 */
.rk-plane, .rk-plane * { transition:none !important; }
.rk-chapter::before { height:2px; opacity:1; background:linear-gradient(90deg, var(--rk-accent-2), var(--rk-accent) 34%, rgba(var(--rk-a3),.5) 62%, transparent 88%); box-shadow:0 0 16px rgba(var(--rk-a1),.5); }
.rk-chapter-no { font-family:var(--rk-mono); color:#d8f6ff; border:1px solid var(--rk-line-3); background:linear-gradient(135deg, rgba(var(--rk-a1),.2), rgba(var(--rk-a3),.22)); box-shadow:0 0 16px rgba(var(--rk-a1),.22), inset 0 0 12px rgba(var(--rk-a1),.12); }
.rk-chapter-title { font-size:14.5px; }
.rk-chapter-path { font-family:var(--rk-mono); color:#6c85a8; }
.rk-chapter-meta span b { font-family:var(--rk-mono); color:var(--rk-accent-2); }

/* 小节行 */
.rk-sec { position:relative; }
/* —— 逐项配色（顶栏「配色」里的「卡片各用一色」）：每张章节卡 / 小节行 / 知识点卡带自己的强调色，
   颜色只写在这一个元素上的 --rk-a1/a2/a3 与 --rk-accent/--rk-accent-2 里, 不影响别的元素 —— */
.rk-chapter.rk-tinted { border-color:rgba(var(--rk-a2),.3); }
.rk-chapter.rk-tinted .rk-chapter-no { color:#eaf8ff; }
.rk-sec.rk-tinted::after { opacity:.85; width:3px; box-shadow:none; }
.rk-sec.rk-tinted .rk-sec-idx { color:var(--rk-accent-2); }
.rk-point.rk-tinted { position:relative; border-color:rgba(var(--rk-a2),.26); }
.rk-point.rk-tinted::before { content:''; position:absolute; inset:0 0 auto 0; height:2px; background:linear-gradient(90deg, var(--rk-accent-2), rgba(var(--rk-a2),.3) 56%, transparent 88%); box-shadow:0 0 14px rgba(var(--rk-a1),.35); }
.rk-point.rk-tinted .rk-point-no { color:var(--rk-accent-2); }
/* 小节行不做 hover 变色: 画布内任何「大面积重绘」都会被浏览器当成需要单独成层, 成层后的内容会被画布的 scale 重新采样 → 鼠标划过会闪 */
.rk-sec::after { content:''; position:absolute; left:0; top:0; bottom:0; width:2px; background:var(--rk-accent-2); box-shadow:0 0 12px var(--rk-accent-2); opacity:0; }
.rk-sec-idx { font-family:var(--rk-mono); color:#5f7a9e; }
.rk-sec-title { font-size:13px; }
.rk-chip { font-family:var(--rk-mono); background:rgba(9,18,36,.9); border:1px solid var(--rk-line-1); color:#9db6d6; }
.rk-chip.rk-q { border-color:rgba(255,194,71,.45); color:var(--rk-warn); background:rgba(48,36,8,.5); }
.rk-chip.rk-brand { border-color:var(--rk-line-3); color:var(--rk-accent-2); background:rgba(9,32,52,.7); box-shadow:0 0 14px rgba(var(--rk-a1),.16); }

/* 知识点卡片墙 */
.rk-cardwall { grid-template-columns:repeat(auto-fill,minmax(min(340px, 100%),1fr)); gap:16px; }
.rk-point { background:var(--rk-panel); border:1px solid var(--rk-line-2); box-shadow:var(--rk-glow); animation:rk-rise .3s ease; transition:border-color .18s, transform .18s, box-shadow .22s; }
.rk-point:hover { border-color:var(--rk-line-3); transform:translateY(-2px); box-shadow:0 0 0 1px rgba(var(--rk-a2),.22), 0 22px 44px rgba(1,6,16,.64), 0 0 40px rgba(var(--rk-a1),.1); }
.rk-point-no { font-family:var(--rk-mono); color:var(--rk-accent-2); text-shadow:0 0 12px rgba(var(--rk-a1),.4); }
.rk-point-title { font-size:14px; }
.rk-point-body { color:#a9c1de; font-size:12.5px; line-height:1.7; }
.rk-point-foot { background:linear-gradient(180deg, rgba(6,14,28,.4), rgba(4,10,20,.7)); }

/* 面板 / 知识点详情 */
.rk-panel { position:relative; background:var(--rk-panel); border:1px solid var(--rk-line-2); box-shadow:var(--rk-glow); }
.rk-panel::before { content:''; position:absolute; inset:0 0 auto 0; height:1px; background:linear-gradient(90deg, rgba(var(--rk-a1),.6), rgba(var(--rk-a3),.3) 50%, transparent 85%); }
.rk-panel-title { font-family:var(--rk-mono); letter-spacing:.06em; color:#8fb0d6; }
.rk-panel-title b { font-family:system-ui,-apple-system,sans-serif; font-size:13.5px; color:#eaf5ff; letter-spacing:0; }

/* markdown 阅读排版 */
.rk-doc { max-width:980px; }
.rk-md-p, .rk-md-list { font-size:12.8px; line-height:1.82; color:#dcebff; }
.rk-md-h1 { background:linear-gradient(92deg,#f4fbff,#9fdcff); -webkit-background-clip:text; background-clip:text; color:transparent; }
.rk-md-h2 { text-shadow:0 0 16px rgba(var(--rk-a1),.28); }
.rk-md-h3 { text-shadow:0 0 14px rgba(var(--rk-a3),.22); }
.rk-md-quote { border-left:2px solid var(--rk-accent-2); background:linear-gradient(90deg, rgba(var(--rk-a1),.1), rgba(var(--rk-a1),.012)); color:#c8ddf8; }
.rk-md-pre { background:#03080f; border:1px solid var(--rk-line-2); color:#b6e6ff; box-shadow:inset 0 0 34px rgba(var(--rk-a1),.06); }
.rk-math-inline { font-size:1.02em; }
.rk-math-block { margin:10px 0; padding:10px 12px; border-radius:9px; border:1px solid var(--rk-line-1); background:var(--rk-bg-2); overflow:auto hidden; text-align:center; }
.rk-math-block .katex-display { margin:0; }
.rk-math-raw { opacity:.8; }
.rk-mermaid { position:relative; margin:10px 0; padding:10px 12px; border-radius:9px; border:1px solid var(--rk-line-1); background:var(--rk-bg-2); overflow-x:auto; }
.rk-mermaid-svg svg { display:block; max-width:100%; height:auto; margin:0 auto; }
.rk-mermaid-note { padding:2px 0; font-size:11px; color:var(--rk-text-2); text-align:center; }
.rk-mermaid-fail { border-color:rgba(255,107,129,.42); }
.rk-md-diagram { margin:10px 0; }
.rk-code-inline { background:rgba(var(--rk-a1),.1); border:1px solid rgba(var(--rk-a1),.24); color:#a6e8ff; }
.rk-md-tablewrap { border:1px solid var(--rk-line-2); box-shadow:0 12px 28px rgba(1,6,16,.45); }
.rk-md-table th { background:linear-gradient(180deg, rgba(var(--rk-a1),.16), rgba(var(--rk-a1),.05)); color:#e4f6ff; font-weight:600; }
.rk-md-table td { color:#d9e8ff; }
.rk-md-table tr:nth-child(even) td { background:rgba(var(--rk-a2),.04); }
.rk-md-table tr:hover td { background:rgba(var(--rk-a2),.1); }
.rk-md-hr { border-top:1px solid var(--rk-line-2); }

/* 题目卡 */
.rk-example { position:relative; background:var(--rk-panel); border:1px solid var(--rk-line-2); border-left:2px solid var(--rk-accent); box-shadow:0 14px 30px rgba(1,6,16,.5); animation:rk-rise .26s ease; transition:border-color .18s, box-shadow .2s; }
.rk-example:hover { border-color:var(--rk-line-3); box-shadow:0 0 0 1px rgba(var(--rk-a2),.18), 0 18px 38px rgba(1,6,16,.56); }
.rk-example-title { font-size:13px; }
.rk-option { font-size:12.8px; }
.rk-option b { font-family:var(--rk-mono); color:var(--rk-accent-2); background:rgba(var(--rk-a1),.08); border:1px solid var(--rk-line-2); transition:border-color .15s, box-shadow .18s; }
.rk-option:hover b { border-color:var(--rk-accent-2); box-shadow:0 0 12px rgba(var(--rk-a1),.32); }

/* 答案遮挡 */
.rk-answer { border:1px dashed rgba(255,194,71,.5); background:linear-gradient(180deg, rgba(255,194,71,.06), rgba(255,194,71,.012)); transition:border-color .2s, background .2s; }
.rk-answer-bar { color:var(--rk-warn); font-size:12.5px; letter-spacing:.02em; }
.rk-answer-bar:hover { background:rgba(255,194,71,.11); }
.rk-answer-body { border-top:1px dashed rgba(255,194,71,.28); }
.rk-answer.rk-open { border-color:rgba(var(--rk-a1),.55); background:linear-gradient(180deg, rgba(var(--rk-a1),.08), rgba(var(--rk-a1),.015)); }
.rk-answer.rk-open .rk-answer-bar { color:var(--rk-accent-2); }
.rk-answer.rk-open .rk-answer-bar:hover { background:rgba(var(--rk-a1),.12); }
.rk-answer.rk-open .rk-answer-body { border-top-color:rgba(var(--rk-a1),.26); }
.rk-score { font-family:var(--rk-mono); color:#7d94b6; }

/* 编辑抽屉 */
.rk-detail { background:linear-gradient(180deg, rgba(7,14,29,.985), rgba(4,9,20,.99)); }
.rk-detail-bar { border-bottom:1px solid var(--rk-line-2); }
.rk-drawer { background:linear-gradient(180deg, rgba(7,14,29,.985), rgba(4,9,20,.99)); border-left:1px solid var(--rk-line-3); box-shadow:-24px 0 60px rgba(0,2,8,.75), -1px 0 0 rgba(var(--rk-a1),.25); }
.rk-drawer-head { background:linear-gradient(180deg, rgba(12,24,44,.9), rgba(6,13,28,.6)); border-bottom:1px solid var(--rk-line-2); }
.rk-drawer-foot { background:rgba(4,9,20,.75); border-top:1px solid var(--rk-line-2); }
.rk-textarea { background:#03080f; border:1px solid var(--rk-line-2); color:#d9ecff; caret-color:var(--rk-accent-2); line-height:1.7; }
.rk-textarea:focus { border-color:var(--rk-accent-2); box-shadow:0 0 0 1px rgba(var(--rk-a1),.25), 0 0 26px rgba(var(--rk-a1),.12); }
.rk-drawer.rk-wide { width:min(1120px, 94%); }
.rk-drawer-body.rk-split { flex-direction:row; align-items:stretch; gap:12px; }
.rk-drawer-body.rk-split > .rk-textarea { flex:1 1 0; min-width:0; }
.rk-drawer-body.rk-split > .rk-edit-col { flex:1 1 0; min-width:0; overflow:hidden; }
.rk-drawer-body.rk-split > .rk-edit-col > .rk-textarea { flex:1 1 0; min-width:0; min-height:120px; }
.rk-drawer-body.rk-split > .rk-edit-col > .rk-md-tools { flex:0 0 auto; }
.rk-preview { flex:1 1 0; min-width:0; display:flex; flex-direction:column; border:1px solid var(--rk-line-2); border-radius:9px; background:#03080f; overflow:hidden; }
.rk-preview-inline { flex:0 0 auto; margin-top:8px; max-height:300px; }
.rk-preview-inline .rk-preview-body { max-height:262px; }
.rk-preview-head { display:flex; align-items:center; gap:8px; padding:6px 10px; border-bottom:1px solid var(--rk-line-1); background:linear-gradient(180deg, rgba(12,24,44,.72), rgba(6,13,28,.2)); font-size:11px; color:var(--rk-text-2); }
.rk-preview-body { flex:1 1 auto; min-height:0; overflow:auto; padding:10px 12px; }
.rk-preview-empty { font-size:12px; color:var(--rk-text-2); }
.rk-field label { font-family:var(--rk-mono); color:#8fa8c9; }

/* 提示 / 空态 */
.rk-toast { background:linear-gradient(135deg, rgba(11,30,52,.96), rgba(8,18,38,.96)); border:1px solid var(--rk-line-3); color:#e9f7ff; box-shadow:0 0 0 1px rgba(var(--rk-a1),.25), 0 14px 40px rgba(1,6,16,.7), 0 0 34px rgba(var(--rk-a1),.16); }
.rk-empty { color:#8fa8c9; }
.rk-modal { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(2,6,14,.62); backdrop-filter:blur(3px); z-index:8; }
.rk-modal-card { width:min(430px, 92%); padding:16px 18px; border-radius:14px; border:1px solid var(--rk-line-2); background:var(--rk-panel); box-shadow:0 24px 60px rgba(0,2,8,.7), 0 0 40px rgba(var(--rk-a1),.08); }
.rk-modal-title { display:flex; align-items:center; gap:8px; margin-bottom:12px; font-size:13px; font-weight:600; color:var(--rk-text); font-family:var(--rk-mono); letter-spacing:.02em; }
.rk-modal-title::before { content:''; width:6px; height:6px; border-radius:50%; background:var(--rk-accent-2); box-shadow:0 0 8px var(--rk-accent-2); }
.rk-modal-card.rk-pcard, .rk-modal-card.rk-qcard { width:min(1180px, 95%); height:min(840px, 86vh, 92%); max-height:92%; overflow:hidden; display:flex; flex-direction:column; gap:10px; }
/* 弹窗里的左右分栏: 左边写 markdown / 表单, 右边实时渲染 */
.rk-edit-split { flex:1 1 auto; min-height:0; display:flex; flex-direction:row; align-items:stretch; gap:12px; }
.rk-edit-col { flex:1 1 0; min-width:0; display:flex; flex-direction:column; gap:8px; overflow:auto; padding-right:2px; }
.rk-edit-col > .rk-field { flex:0 0 auto; }
.rk-edit-col > .rk-field.rk-grow { flex:1 1 auto; min-height:0; }
.rk-edit-col > .rk-field.rk-grow .rk-textarea { flex:1 1 auto; min-height:150px; }
.rk-edit-split > .rk-preview { flex:1 1 0; min-width:0; }
.rk-qfrom { font-size:11px; color:var(--rk-text-2); font-family:var(--rk-mono); }
.rk-seg { display:flex; gap:6px; }
.rk-seg-item { padding:5px 13px; border-radius:8px; border:1px solid var(--rk-line-2); background:rgba(8,17,33,.7); color:var(--rk-text-2); font:inherit; font-size:12px; cursor:pointer; }
.rk-seg-item.rk-on { border-color:var(--rk-line-3); color:var(--rk-text); background:linear-gradient(180deg, rgba(var(--rk-a1),.16), rgba(var(--rk-a1),.03)); box-shadow:0 0 0 1px rgba(var(--rk-a1),.18); }
.rk-qopt { display:flex; align-items:center; gap:8px; }
.rk-qopt input[type=radio] { flex:0 0 auto; width:15px; height:15px; accent-color:var(--rk-accent-2); cursor:pointer; }
.rk-qopt-key { flex:0 0 auto; width:16px; text-align:center; font-family:var(--rk-mono); font-size:12px; color:var(--rk-accent-2); }
.rk-qopt .rk-input { flex:1 1 auto; min-width:0; height:32px; }
.rk-qopt .rk-btn { flex:0 0 auto; padding:4px 8px; font-size:11px; }
.rk-qhint { font-size:11px; color:var(--rk-text-2); }
.rk-qerr { padding:7px 10px; border-radius:8px; border:1px solid rgba(255,107,129,.45); background:rgba(255,107,129,.08); color:var(--rk-danger); font-size:12px; }
.rk-qfoot { display:flex; align-items:center; gap:8px; margin-top:2px; }
.rk-qfoot .rk-spacer { flex:1 1 auto; }
.rk-empty::before { content:''; width:54px; height:54px; border-radius:14px; border:1px solid var(--rk-line-2); background:radial-gradient(circle at 50% 50%, rgba(var(--rk-a1),.16), transparent 70%); box-shadow:0 0 26px rgba(var(--rk-a1),.16) inset; }
.rk-err { border-color:rgba(255,107,129,.5); color:var(--rk-danger); }

/* HUD 角标 + 顶部流光 */
.rk-chapter::after, .rk-point::after, .rk-example::after, .rk-panel::after {
  content:''; position:absolute; right:7px; bottom:7px; width:13px; height:13px;
  border-right:1px solid rgba(var(--rk-a1),.45); border-bottom:1px solid rgba(var(--rk-a1),.45);
  border-radius:0 0 7px 0; pointer-events:none; opacity:.75;
}
.rk-head::after { background-size:220% 100%; animation:rk-sheen 6.5s linear infinite; }
.rk-stat b { transition:text-shadow .2s; }
.rk-stat:hover b { text-shadow:0 0 18px rgba(var(--rk-a1),.85); }
/* 滚动条 */
.rk-stage::-webkit-scrollbar, .rk-detail-body::-webkit-scrollbar, .rk-drawer-body::-webkit-scrollbar, .rk-textarea::-webkit-scrollbar,
.rk-md-tablewrap::-webkit-scrollbar, .rk-md-pre::-webkit-scrollbar { width:10px; height:10px; }
.rk-stage::-webkit-scrollbar-track, .rk-detail-body::-webkit-scrollbar-track, .rk-drawer-body::-webkit-scrollbar-track, .rk-textarea::-webkit-scrollbar-track,
.rk-md-tablewrap::-webkit-scrollbar-track, .rk-md-pre::-webkit-scrollbar-track { background:rgba(4,10,20,.6); }
.rk-stage::-webkit-scrollbar-thumb, .rk-detail-body::-webkit-scrollbar-thumb, .rk-drawer-body::-webkit-scrollbar-thumb, .rk-textarea::-webkit-scrollbar-thumb,
.rk-md-tablewrap::-webkit-scrollbar-thumb, .rk-md-pre::-webkit-scrollbar-thumb { background:linear-gradient(180deg, rgba(var(--rk-a2),.42), rgba(var(--rk-a1),.22)); border-radius:8px; border:2px solid transparent; background-clip:padding-box; }
.rk-stage::-webkit-scrollbar-thumb:hover, .rk-detail-body::-webkit-scrollbar-thumb:hover, .rk-drawer-body::-webkit-scrollbar-thumb:hover, .rk-textarea::-webkit-scrollbar-thumb:hover { background:rgba(var(--rk-a2),.6); background-clip:padding-box; }

/* Git 提交弹窗 */
.rk-gcard { width:min(880px,94%); height:auto; max-height:88vh; }
.rk-git { display:flex; flex-direction:column; gap:12px; padding:14px 16px 2px; min-height:0; }
.rk-git-meta { display:flex; flex-wrap:wrap; gap:6px 16px; font-size:12px; color:var(--rk-text-2); align-items:baseline; }
.rk-git-meta b { color:var(--rk-text); font-weight:600; }
.rk-git-meta .rk-mono { font-family:var(--rk-mono); font-size:11.5px; color:var(--rk-text-2); }
.rk-git-sub { font-size:11.5px; color:var(--rk-text-2); }
.rk-git-files { border:1px solid var(--rk-line-1); border-radius:10px; background:rgba(3,8,16,.55); max-height:30vh; overflow:auto; }
.rk-git-group { position:sticky; top:0; display:flex; gap:8px; align-items:center; padding:6px 12px; background:linear-gradient(180deg, rgba(10,20,38,.98), rgba(6,13,28,.94)); border-bottom:1px solid var(--rk-line-1); font-size:11.5px; letter-spacing:.04em; color:var(--rk-text-2); }
.rk-git-group b { color:var(--rk-accent-2); font-family:var(--rk-mono); }
.rk-git-file { display:flex; gap:10px; align-items:baseline; padding:4px 12px; font-family:var(--rk-mono); font-size:11.5px; border-bottom:1px solid rgba(var(--rk-a2),.06); }
.rk-git-file:last-child { border-bottom:none; }
.rk-git-code { flex:0 0 42px; text-align:center; font-weight:700; color:var(--rk-text-2); }
.rk-git-code.is-mod { color:var(--rk-warn); }
.rk-git-code.is-new { color:var(--rk-accent-2); }
.rk-git-code.is-del { color:var(--rk-danger); }
.rk-git-path { min-width:0; word-break:break-all; color:var(--rk-text); }
.rk-git-empty { padding:16px 12px; text-align:center; color:var(--rk-text-2); font-size:12.5px; }
.rk-git-row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.rk-git-label { flex:0 0 auto; font-size:11.5px; letter-spacing:.04em; color:var(--rk-text-2); }
.rk-git-chip { display:inline-flex; align-items:center; gap:6px; padding:5px 12px; border-radius:999px; border:1px solid var(--rk-line-2); background:rgba(9,18,34,.7); color:var(--rk-text-2); font-size:12px; cursor:pointer; }
.rk-git-chip:hover:not(:disabled) { border-color:var(--rk-line-3); color:var(--rk-text); }
.rk-git-chip.is-on { border-color:rgba(var(--rk-a1),.6); background:linear-gradient(180deg, rgba(var(--rk-a2),.22), rgba(var(--rk-a1),.08)); color:#fff; box-shadow:0 0 14px rgba(var(--rk-a1),.18); }
.rk-git-chip b { font-family:var(--rk-mono); color:var(--rk-accent-2); }
.rk-git-chip:disabled { opacity:.45; cursor:default; }
.rk-git-msg { min-height:74px; resize:vertical; font-family:var(--rk-mono); font-size:12.5px; line-height:1.7; }
.rk-git-result { border-radius:9px; padding:9px 12px; font-size:12.5px; border:1px solid var(--rk-line-1); background:rgba(6,14,28,.7); color:var(--rk-text-2); }
.rk-git-result.is-ok { border-color:rgba(var(--rk-a1),.42); color:var(--rk-text); }
.rk-git-result.is-bad { border-color:rgba(255,107,129,.45); color:#ffd7de; }
.rk-git-out { margin-top:7px; max-height:118px; overflow:auto; font-family:var(--rk-mono); font-size:11px; white-space:pre-wrap; color:var(--rk-text-2); }
.rk-git-hint { font-size:11.5px; color:var(--rk-text-2); }
.rk-git-scope { display:flex; gap:8px; align-items:baseline; flex-wrap:wrap; font-size:12px; color:var(--rk-text); }
.rk-git-ai { margin-left:auto; font-size:11.5px; padding:3px 10px; }
.rk-git-cands { display:flex; flex-direction:column; gap:4px; margin-top:2px; }
.rk-git-cand { text-align:left; padding:6px 9px; border-radius:7px; border:1px solid var(--rk-line-1); background:rgba(var(--rk-a2),.05); color:var(--rk-text); font-size:12px; font-family:var(--rk-mono); cursor:pointer; }
.rk-git-cand:hover { border-color:var(--rk-line-3); background:rgba(var(--rk-a2),.13); }
.rk-git-cand.is-on { border-color:rgba(var(--rk-a1),.6); background:linear-gradient(180deg, rgba(var(--rk-a2),.2), rgba(var(--rk-a1),.07)); color:#fff; }

/* markdown 输入助手: 编辑器/弹窗里那一排小按钮 + 模板下拉 */
.rk-md-tools { display:flex; align-items:center; gap:4px; flex-wrap:wrap; margin:2px 0 5px; }
/* ===================== 全屏专注: 藏掉宿主的左右侧栏, 画布占满整个窗口 =====================
 * 宿主的壳是 CSS-module 网格(侧栏 | 中列 | 右栏), 类名尾部固定(sidebarCol / centerCol / …) ⇒
 * 用 [class*=] 抗哈希变化; 网格列由宿主的 React 内联样式决定 ⇒ 只能 !important 压过去。
 * 侧栏一旦 display:none 就不参与网格自动排布, 中列会掉进第一条 0 宽的轨道 ⇒ 必须显式指定列。 */
html.rk-focus [class*="sidebarCol"],
html.rk-focus [class*="rightbarCol"] { display:none !important; }
html.rk-focus [data-rk-focus] { grid-template-columns:0px 1fr 0px !important; }
html.rk-focus [data-rk-focus] > [class*="centerCol"] { grid-column:2 / 3 !important; border-left:none !important; }
html.rk-focus [data-rk-focus] [class*="handle"] { display:none !important; }
.rk-md-btn { min-width:26px; height:24px; padding:0 7px; border-radius:6px; border:1px solid var(--rk-line-1); background:rgba(var(--rk-a2),.05); color:var(--rk-text); font-size:12px; line-height:1; cursor:pointer; }
.rk-md-btn:hover { border-color:var(--rk-line-3); background:rgba(var(--rk-a2),.14); color:#fff; }
.rk-md-btn.is-on { border-color:rgba(var(--rk-a1),.6); background:linear-gradient(180deg, rgba(var(--rk-a2),.22), rgba(var(--rk-a1),.08)); color:#fff; }
.rk-md-sep { width:1px; height:16px; margin:0 3px; background:var(--rk-line-2); }
.rk-md-wrap { position:relative; display:inline-flex; }
.rk-md-dropzone { display:inline-flex; align-items:center; gap:4px; }
.rk-md-more { min-width:auto; }
.rk-md-menu { position:absolute; top:28px; left:0; z-index:6; width:252px; max-height:340px; overflow:auto; padding:6px; border-radius:10px; border:1px solid var(--rk-line-3); background:linear-gradient(180deg, rgba(12,22,42,.99), rgba(5,11,24,.99)); box-shadow:0 18px 44px rgba(1,6,16,.7); }
.rk-md-group { margin-bottom:6px; }
.rk-md-group-name { padding:4px 6px 3px; font-size:11px; color:var(--rk-accent-2); letter-spacing:.02em; }
.rk-md-item { display:block; width:100%; text-align:left; padding:5px 8px; margin:1px 0; border-radius:6px; border:1px solid transparent; background:transparent; color:var(--rk-text); font-size:12.5px; cursor:pointer; }
.rk-md-item:hover { border-color:var(--rk-line-2); background:rgba(var(--rk-a2),.12); color:#fff; }
.rk-md-empty { padding:8px; font-size:11.5px; color:var(--rk-text-2); }
.rk-md-foot { display:flex; gap:6px; flex-wrap:wrap; margin-top:5px; padding-top:6px; border-top:1px solid var(--rk-line-1); }
.rk-md-foot-btn { padding:3px 8px; border-radius:6px; border:1px solid var(--rk-line-1); background:transparent; color:var(--rk-text-2); font-size:11.5px; cursor:pointer; }
.rk-md-foot-btn:hover { border-color:var(--rk-line-3); color:#fff; }

/* ===================== 配色选择器 ===================== */
.rk-skin-wrap { position:relative; display:inline-flex; }
.rk-swatch-dot { width:11px; height:11px; border-radius:3px; border:1px solid rgba(255,255,255,.35); }
.rk-skin-pop { position:absolute; right:0; top:32px; z-index:9; width:238px; padding:9px; border-radius:10px; border:1px solid var(--rk-line-3); background:linear-gradient(180deg, rgba(12,22,42,.99), rgba(5,11,24,.99)); box-shadow:0 18px 44px rgba(1,6,16,.7); }
.rk-skin-row { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:9px; padding-top:8px; border-top:1px solid var(--rk-line-1); font-size:11px; color:var(--rk-text-2); }
.rk-skin-row .rk-btn { padding:3px 9px; font-size:11px; }
.rk-skin-title { font-size:11px; color:var(--rk-text-2); margin-bottom:7px; }
.rk-skin-grid { display:grid; grid-template-columns:repeat(6,1fr); gap:6px; }
.rk-swatch { width:100%; aspect-ratio:1 / 1; padding:0; border-radius:6px; border:1px solid rgba(255,255,255,.2); cursor:pointer; transition:transform .12s, box-shadow .12s; }
.rk-swatch:hover { transform:scale(1.1); }
.rk-swatch.is-on { box-shadow:0 0 0 2px var(--rk-text), 0 0 10px rgba(255,255,255,.32); }
/* ---- 自适应: 按插件容器宽度分级收拢(宿主侧栏占位时窗口可能很窄) ---- */
@container rk (max-width: 1180px) {
	.rk-head { padding:10px 14px; gap:10px; }
	.rk-toolbar { padding:8px 14px; gap:8px; }
	.rk-stage { padding:16px 16px 48px; }
	.rk-stat { padding:2px 7px; font-size:10.5px; }
	/* 百分比按钮只是「显示当前值」, 窄了先让位给搜索框和缩放 */
	.rk-ztag { display:none; }
}
@container rk (max-width: 1000px) {
	.rk-badge { display:none; }
	.rk-toolbar-hint { display:none; }
	.rk-head .rk-stat:nth-child(n+4) { display:none; }
	/* 右栏改成整块盖住画布, 不再把画布挤成一条 */
	.rk-detail { position:absolute; inset:0; z-index:6; width:auto; min-width:0; }
}
@container rk (max-width: 860px) {
	.rk-head { padding:9px 12px; gap:8px; flex-wrap:wrap; }
	.rk-head .rk-stat { display:none; }
	.rk-toolbar { padding:7px 12px; }
	.rk-btn { padding:5px 9px; }
	.rk-modal-card { width:96%; padding:14px 15px; }
	.rk-modal-card.rk-pcard, .rk-modal-card.rk-qcard { width:100%; height:100%; max-height:100%; border-radius:0; }
	.rk-drawer, .rk-drawer.rk-wide { width:100%; }
	.rk-drawer-body.rk-split { flex-direction:column; }
	.rk-drawer-body.rk-split > .rk-edit-col > .rk-textarea { min-height:150px; }
	.rk-zoomctl { display:none; }
}
@container rk (max-width: 700px) {
	.rk-h1 { font-size:14px; }
	.rk-stage { padding:12px 12px 40px; }
}
${SKIN_CSS}
`;

		return { CSS, SKINS };
}
