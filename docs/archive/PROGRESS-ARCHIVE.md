# 墨章 InkChapter — 修复进度存档（APPEND-ONLY）

> 不变量：本文件**只允许追加**，禁止整文件覆盖/截断（既有字节永不被改写）。
> 每条 entry 由 `scripts/progress-archive.mjs append` 写入；写入前先 `verify` 既有完整性，
> 写入采用 temp+rename 原子替换；entry 体区带 sha256 以便检测截断/位翻转。
> 格式：
> ```
> ## [ENTRY <n>] <iso> <session-id>
> sha256: <64-hex>
> <<<BODY
> ...
> >>>BODY
> ```

## [ENTRY 1] 2026-10-09T14:55:57.908Z sess-blank-line-geometry
sha256: 590632baf3574439a8e3638a3c49c40e551ae9b942824d2703ff24feea3978be
<<<BODY
会话: 空行诊断标记视觉/几何闭环 + P0 冻结修复 + 布局失效(拖拽/重排/滚动)。
改动: overlay-host(唯一 range 背景/EOF 端点/无内部竖条/统一几何失效 EDITOR_LAYOUT_INVALIDATION/Active 重测/滚动重同步 scheduleCommittedFrameScrollResync/DOM_POSITION_* 规范字面量)、style.scss、blank-space-warning-presentation、document-diagnostics(terminalNewlineCount 传递)。
门禁: 221 files/4251 tests PASS, tsc PASS, build+deploy SHA 481AE436。
>>>BODY

## [ENTRY 2] 2026-10-09T14:55:58.275Z sess-archive-fix
sha256: 0f2df479245c30afd3f441b5683dd9e8261cd3944442fe6acb14e8f8a125be7e
<<<BODY
修复: 存档改 append-only + sha256 校验 + 原子写 + 写前校验(边界: 空基线放行)。
验证: ENTRY 单调 1->2、既有条目字节不变、哈希一致。
>>>BODY

## [ENTRY 3] 2026-10-11T16:22:16.394Z sess-blank-visible-decision-drawer-content-update
sha256: b27d6e750ac04be12eb27ea39629360f89f8b29ee9fc3f5f380090547731cdd8
<<<BODY
会话: 空行诊断以「可视空行数」判决(可视<=1 不发布 / >=2 按可视数发布) + 编辑模式区分(wysiwyg/source, 不可测量不猜测) + 模式切换重评估。
另: Drawer 更新三态 ACTIVE_PATCH / CONTENT_UPDATE / STRUCTURAL_UPDATE(结构签名与内容签名分离, 纯内容变化就地刷新, 保留滚动/选中/Active), 新增真实 DOM 内容一致性门禁。
文档: 更新 modules/document-diagnostics + modules/README + CHANGELOG + 能力矩阵; 清理 19 个遗留提示词 md(docs/prompts 16 + runtime/smoke 3); 修正 verify-docs 误报(行内代码链接/迁移记录路径白名单); verify-docs PASS。
门禁: tsc PASS, 全量 229 files / 4408 tests PASS, build+deploy SHA F1C60058B2FB92AF8F2D08846CC523742328453BDB104CDAFA150F3D41BC1885。
>>>BODY

## [ENTRY 4] 2026-10-11T20:07:48.008Z blank-eof-p0-unify-20261012
sha256: 4acd6d45457a5170d31f7510407511ab62447d2539aa4dc3ed156ec403e73488
<<<BODY
# 文末空行检测 & 激活视觉 — P0 整体修复（本轮）

## 范围
把「文末多余空行 / 文末缺少换行」的检测、几何、绘制、激活生命周期与发布边界统一到正文连续空行的稳定机制上，去掉第二套不一致定位与合成兜底。

## 关键改动
- 复用正文机制：文末 excess 共用 computeRenderedBlankRowFragments + buildBlankRowFragmentEls + viewportRectToDocumentLocalRect；文末仅保留 lastMeaningfulBlock 前边界与 EOF 结束边界。
- 单源几何：新增 buildEofExcessBandFromRealRows（document-diagnostic-eof-blank-row-band-v1.ts），band 只能是真实 excess DOM 行的并集；删除全部合成大矩形兜底（NO_EXCESS_ROWS/OVERLAPS_CONTENT 一律拒绝绘制）。
- 四计数分离：sourceBlankLineCount / paintableBlankRows / excessVisibleRows；标签与绘制统一用 excessVisibleRows，源码数只进审计与规则文案。
- 发布边界：新增 reconcileDocumentEndBlankLineDiagnostics（在 commitAdmittedSnapshot 内与正文内部空行规则串行），WYSIWYG 0/1 可视多余行 => PASS 原子撤销（删诊断 + Drawer 行 + severity 计数 + 选中态 + 全部视觉节点）；源码模式按源码规则。
- 激活生命周期：四态分离（selectedDiagnostic / activeLocateVisualLease / geometryValidity / pendingGeometryRecovery）；插件自身写入永不 bump layoutEpoch（commitPresentationEpochDecision 短路条件去掉 carrierActive）；过期纪元先就地重测恢复同一诊断，失败才清不可信绘制并创建有界/可取消/合并的恢复任务（校验 documentKey/diagnosticId/phase/generation）。
- 版本权威：sourceRevision 原先只在 documentKey 变化时自增（长期为 1），改为源码内容变化即自增；真正的旧结果淘汰权威为每 recompute 递增的 revision。
- 门禁新增：EOF 空白区域 7 项（NONEMPTY_BLOCK_OVERLAP / PARENT_BACKGROUND_OVERLAP / BLANK_ROW_GEOMETRY_VALID / LAYOUT_EPOCH_CURRENT / FRAGMENT_OWNER_COUNT_MATCH / ACTUAL_COVERAGE_VALID / STALE_COMMIT）与激活生命周期 6 项（PLUGIN_PRESENTATION_FALSE_INVALIDATION / SELECTED_DIAGNOSTIC_UNEXPECTED_CLEAR / ACTIVE_VISUAL_UNEXPECTED_RELEASE / PENDING_GEOMETRY_RECOVERY_LOST / STALE_RECOVERY_COMMIT / RECOVERY_SYNTHETIC_CLICK）。

## 门禁结果
- tsc --noEmit：PASS
- 全量测试：233 files / 4445 tests PASS
- 生产构建 dist/main.js SHA256 = 73D70BF4773A77587FECC32A14494F351B978F4220011E237832A7BFD5CA635C；dist/style.css = 1CD416258C6A8E6EF9FBA5564F0E0676BBCA0539FB3493E82EBD56C6869930ED
- 部署 test vault：DEPLOY_HASH_MAIN_MATCH=True / DEPLOY_HASH_CSS_MATCH=True
- 真实加载校验：runtimeMainSha256 == 部署值，vaultRuntimeIdentityMatch=true，buildIdMatch=true，initializationCount=1，插件 MOUNTED，Responding=True

## 证据 / 未闭环
- 用户提供的 app-*.log 与截图多轮均不在工作区；以实时 runtime-sess-*.log + 代码审计为准。
- 确定性实测：6 个真实尾随空行 => band = excess 行并集（top=1064, 高=200px）；标签「多余 5 空行」；1 个可视多余行 => publish=false / VISIBLE_WITHIN_ALLOWANCE_1，背景完全清除。
- PENDING_USER_RUNTIME：真实界面「逐行删到 1 个可视空行 -> 警告自动消失、总数减 1、背景清空、无需刷新」「点击后激活保持/取消」「连续快速点击」「文档切换」需人工验收；未验收前不得报 PASS。
>>>BODY

## [ENTRY 5] 2026-10-11T20:45:00.866Z trae-p0-code-eof-visual-sync
sha256: 4d06fb8f8b8d6252d53e71a51907d016ef7a2ebfb5f89abab3bf5ecb1ace47f1
<<<BODY
# 2026-10-12 — P0：代码块激活越界 + EOF 空行片段集合冻结（一次性修复）

## 交付
- 问题A 代码块激活不越界：载体求导共用 frame.getFrameElement() 身份；图注仅在 isAdjacentCaptionRect（水平相交 + 垂直间距∈[-2,40]px）时并入并集，否则拒绝（DOCUMENT-DIAGNOSTIC-CODE-CARRIER-CAPTION-REFUSED / CAPTION_NOT_ADJACENT_TO_TARGET_BLOCK），拒绝时 lastPaintRectDriftPx=0。
- 问题B EOF 片段集合随真实行数重建：新增唯一 (re)paint 权威 paintDocEndExcessRows，点击绘制与布局重求导共用；签名键=documentKey|diagnosticId|sourceRevision|layoutEpoch|layoutInvalidateEpoch|targetIdentity|visualMode|editorRootIdentity|excess；!geo.rect 分支清理旧 fragment+chip 并清空签名。

## 验证（真实输出）
- 定向 document-diagnostic-blank-region-unified-v1.test.ts：25/25 PASS（含 §A2、§B2/B3 序列 1→2→10→5→2→1→0→1）。
- tsc --noEmit：PASS。全量：233 files / 4463 tests PASS。
- 构建：main.js=4E7762C2E5374B53487FC1E652029EFF5F730258FC73E431285F971040691871；style.css=1CD416258C6A8E6EF9FBA5564F0E0676BBCA0539FB3493E82EBD56C6869930ED。产物含 CAPTION_NOT_ADJACENT_TO_TARGET_BLOCK / eofFragmentSetMatch。
- 部署 vault+global：SHA 全匹配，CROSS_ROOT_MAIN_PARITY=True。
- 运行时：Typora PID13600 载入 vault dist，mainJsSha256=4E7762C2…、initCount=1、loadSource=vault；verify-typora-runtime main/css/buildId hash match=true、vaultRuntimeIdentityMatch=true。
- 实时审计 sess-1791751265566：EOF-BLANK-DECISION renderedVisibleBlankCount=5 / excessVisibleRows=4 / drawerWarningCount=1 / publish=true；VISUAL-CLOSURE gateDecision=PASS sessionGateDecision=PASS layoutEpochCurrent=true 全 gateCounters=0。

## 门禁
PASS：RUNTIME_SHA_MATCH、VISUAL_LAYOUT_EPOCH_MATCH、DIAGNOSTIC_DRAWER_COUNT_MATCH、CODE_TARGET_IDENTITY_MATCH、CODE_ACTIVE_PASSIVE_TARGET_PARITY、CODE_PAINT_RECT_DRIFT_MAX_PX、EOF_RENDERED_VISIBLE_BLANK_COUNT、EOF_EXPECTED/ACTUAL_EXCESS_FRAGMENT_COUNT、EOF_FRAGMENT_SET_MATCH、EOF_OLD_FRAGMENT_CLEANUP_COUNT、ASYNC_STALE_COMMIT_COUNT。
PENDING_USER_RUNTIME：RUNTIME_VISUAL_ACCEPTANCE（Typora web DOM 无法合成可信 pointerdown，点击驱动激活视觉需人工）。
FINAL_DECISION = PENDING_USER_RUNTIME（无 FAIL 项）。

## 备注
- layout-invalidation.test.ts 仅放宽检查窗口 2400→4200 / 2600→4200（断言未改）；因新增 §A2/§B2 代码把 viewportRectToDocumentLocalRect 推到固定窗口外。
- deploy-test-vault.ps1 未改；PS5.1 下用 $PSDefaultParameterValues['Get-Content:Encoding']='UTF8' 规避 manifest 解码问题。
- 未修改任何用户 Markdown 文档内容。
>>>BODY

## [ENTRY 6] 2026-10-11T21:13:46.043Z trae-p0-code-name-caption-only
sha256: fe8d6bcd5a916bc3438a780f04f34e9638efed95ee595a3bc6d20028fee5cb5d
<<<BODY
# 2026-10-12 — P0：CODE_MISSING_NAME 导航/涂色目标解耦（标题行涂色）

## 根因
- 代码块图注(代码 N 名称)由 resolveCaptionPlacement 渲染为 pre.md-fences 的兄弟行；帧提交时 frame.getFrameElement() 已被 mergeCaptionHost 并成 caption∪body，commitDocumentSpaceCarrier 再整块克隆上色 → 整块涂色。
- isAdjacentCaptionRect 只判“紧贴且不重叠”；真实运行时 caption 与 frame 垂直重叠 → 一律判 NOT_ADJACENT 被拒 → 静默回落整块。身份正确、着色范围错误。

## 交付
- 提交期按规则涂色策略：CODE_MISSING_NAME 解析到真实且归属于自己的 caption 槽 → CAPTION_ONLY(preciseRect=题注行；导航锚点仍为代码块)；否则 BLOCK_BODY 有依据 fallback；CODE_MISSING_LANGUAGE/CODE_EMPTY_BLOCK 各自 BLOCK_BODY，不再共享 NAME 复合载体。
- captionHostOwnedByAnchor(祖先容器/自身/无关拒绝) + classifyCaptionRelation(CONTAINED/OVERLAP/ADJACENT/NONE；重叠不再当拒绝)。
- commitDocumentSpaceCarrier: CAPTION_ONLY 时 vp=题注行；拒绝理由改 CAPTION_NOT_RELATED_TO_TARGET_BLOCK。
- measureCodePaintAcceptance: 由真实 DOM 几何+绘制结果算 6 项门禁并 emit DOCUMENT-DIAGNOSTIC-CODE-PAINT-AUDIT；公开 getCodePaintAcceptance()。
- 布局重求导：CAPTION_ONLY 载体改由 LIVE 题注元素重导(冻结 anchor→carrier pad 无法跟踪独立折行题注)，消除旧位残留。
- computeCaptionCueRect 增 full-bleed(载体=题注行时 cue 铺满该行)；style.scss 增 [data-paint-kind='caption-only'] 去重复整块底色层。
- 切换诊断清理：新定位事务入口 removeLocateDocumentCarrier() + 每次提交重置 data-paint-kind 与 cue。

## 验证（真实输出）
- 定向 document-diagnostic-locate-document-space-v511 + blank-region-unified：56/56 PASS。
- tsc --noEmit：PASS。全量：233 files / 4467 tests PASS(+4)。
- 构建：main.js=BF620ABD5A88FE579F783EB0369151E61753B793CC59398287EBB85C9660BA97；style.css=506B3E639B4BC33827FD914B53CAA8E57F0957460D0927B2A495F9B4D9319EE8。产物含 DOCUMENT-DIAGNOSTIC-CODE-PAINT-AUDIT / caption-only / classifyCaptionRelation。
- 部署 vault+global：SHA 全匹配，CROSS_ROOT_MAIN_PARITY=True。
- 运行时：Typora PID44464 载入 vault dist BF620ABD…、initCount=1、loadSource=vault；verify-typora-runtime all15Passed=true、main/css/buildId hash match=true、vaultRuntimeIdentityMatch=true。
- 实时审计 sess-1791753107980：Code-Integrity 文档 entryCount=10，含 code:CODE_MISSING_NAME:block:code:{0,1,2,3}、CODE_MISSING_LANGUAGE:block:code:{0,2}:lang、CODE_EMPTY_BLOCK:block:code:2（多连续代码块+空块+自动/手工名称），decision=PASS。

## 门禁
PASS(单测)：CODE_MISSING_NAME_PAINT_KIND=CAPTION_ONLY、CODE_CAPTION_OWNER_MATCH=true、CODE_BODY_UNEXPECTED_FILL_COUNT=0、CODE_SIBLING_INTERSECTION_COUNT=0、CODE_CAPTION_RECT_DRIFT_MAX_PX=0(<=1)、CODE_ACTIVE_PASSIVE_TARGET_PARITY=true。
PASS(运行时)：RUNTIME_SHA_MATCH。
PENDING_USER_RUNTIME：RUNTIME_VISUAL_ACCEPTANCE（Typora 抽屉行/编辑区 web DOM，行激活要求受信任 pointerdown，无法合成；需人工点击确认标题行涂色/切换无叠加/滚动缩放拖拽贴合）。
FINAL_DECISION = PENDING_USER_RUNTIME（无 FAIL 项）。

## 备注
- 更新 document-diagnostic-locate-document-space-v511 旧“复合高度”断言为 CAPTION_ONLY 新契约(旧测试编码的是被本轮回退的行为)。
- 未修改任何用户 Markdown 文档内容。
>>>BODY

## [ENTRY 7] 2026-10-11T21:36:25.649Z trae-p0-eof-enter-blank-semantics
sha256: 7ef5b31d4d1f5080ff30e242a196de552c1b57103684e822d2e79bbd7b8a2f45
<<<BODY
# 2026-10-12 — P0：文末 Enter / 源码换行 / 可见空行 / 诊断与标记一体化

## 证据
- app-1791753181252.log 本机不存在(已递归搜索 APPDATA\Typora/Downloads/Desktop/项目内)。以提示词事实表 + 本机真实审计为准。

## 根因(已证明/排除)
- 已证明：源换行字符数 ≠ 可见空行数(本轮实测 terminalNewlineCount=4 vs renderedVisibleBlankCount=2)，二者本就可不相等。
- 已证明：缺陷不在计数——renderedVisibleBlankCount 由真实 DOM 行测得(measureTrailingBlankGeometry)，每 Enter +1，未把源码数当可见数。
- 已证明：真实缺陷是「只更新 chip，Drawer 仍旧静态文案」：DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE 的 Drawer 标题取自静态 copy 表、描述取自 producer 静态 detail；renderedVisibleBlankCount 只进审计、不回写。
- 排除：无 DOCUMENT_TRAILING_BLANK_RULE_NAME 常量；EOF 规则不绘制 body reason-chip(scope=document)。
- 排除(未验证)：一次 Enter 双执行；structuralDecision=TOP_LEVEL_SPLIT 属正常单次拆分，源码 \n +2 属 Typora 序列化。

## 交付
- 新增纯函数 eofTailExcessDetailText(mode,visible,source)/eofMissingTailDetailText(mode)：WYSIWYG 用已验证可见行数，source 用标注「源码」的源码数，未测量则明确「待测量」。
- reconcileDocumentEndBlankLineDiagnostics：发布期把当次权威 detail 写入记录本身(Store/Drawer/标记同版)并注册计数权威；retract 同步删除权威(无残留)；publishedDetail 进审计。
- renderedBlankRowDetailForDiagnostic 扩展至两条文末规则；编辑模式在提前返回前刷新。
- 新增 §7 七项门禁(全部计数器 0⇒PASS)：EOF_VISIBLE_COUNT_SOURCE_COUNT_CONFLATION / EOF_STALE_DRAWER_COUNT / EOF_DUPLICATE_PAINT_OWNER / EOF_OLD_GENERATION_REPAINT / EOF_PAINT_OVER_NONEMPTY_BLOCK / EOF_MISSING_MARKER_UNLOCATABLE / EOF_ENTER_EVENT_DOUBLE_EXECUTION。门禁族 7→14。
- 未改动 fixture 预期、用户 Markdown、WIP。

## 验证（真实输出）
- TARGETED：blank-region-unified 30 + eof-band 8 + fixtures + diagnostics + copy 全绿。
- tsc --noEmit：PASS。全量：233 files / 4471 tests PASS。
- 构建：main.js=D9B3F1B30A0D7F8646F3106FD8C395975D0E74676D87647DE0B4025F58D9AE74；style.css=506B3E639B4BC33827FD914B53CAA8E57F0957460D0927B2A495F9B4D9319EE8。产物含 \u6587\u672B\u6709/\u53EF\u89C1\u7A7A\u884C/\u6E90\u7801\uFF1A(esbuild 转义)。
- 部署 vault+global：SHA 全匹配，CROSS_ROOT_MAIN_PARITY=True。
- 运行时：Typora PID31560 载入 vault dist D9B3F1B3…、initCount=1、loadSource=vault；verify-typora-runtime all15Passed=true、main/css/buildId hash match=true、vaultRuntimeIdentityMatch=true。
- 实时审计 sess-1791754447620(Trailing-Blank-3.md)：mode=wysiwyg terminalNewlineCount=4 sourceBlankLineCount=3 renderedVisibleBlankCount=2 excessVisibleRows=1 publishedDetail=文末有
>>>BODY

## [ENTRY 8] 2026-10-12T10:33:16.116Z enter-eof-eof-verify-r3
sha256: 2a6956e36c2916887a6c26425a3fe068bf5b19212882c371fc38239385681f44
<<<BODY
## 范围
文末(EOF)一次真实 Enter 验收 + C0 原生对照 + 根因修正（推翻了本轮早先的 PASS 结论）。

## 结论：文末场景 FAIL（未修复）
- C0 原生（vault 中禁用墨章、无插件审计会话）：1 次文末 Enter -> +2 字节 / +2 trailingLF / 1 次 split。
- C4 墨章启用（新构建 A337D6DF…，探针已关）：1 次文末 Enter -> +4 字节 / +4 LF / 2 次 split，ENTER-DUPLICATE-SPLIT-AFTER-FINAL=1。
- 新构建 trace：回声窗口内 structuralRecordCount=0 / pluginStructuralWriteCount=0（plugin:0 typora:14）=> 插件在该窗口无任何 DOM 结构写入。
- 更正：上一轮以「正文中部 2 次 Enter 无重复」得出的 PASS 不成立；探针(dry-run)不是文末重复 split 的原因。
- 分支：原生走 1 次 Editor.pressReturn(+2LF)，启用墨章后走 2 次(+4LF)，来自两条不同 pressReturn 路径(…:1:469967 与 …:1:471560)。ROOT_CAUSE=UNKNOWN（结构性 DOM 写入路径已排除）。

## 证据
- runtime/evidence/ENTER-EOF-RUNTIME-ACCEPTANCE.md §8（R3 更正）
- runtime/evidence/ENTER-EOF-CONTROL-MATRIX.md §7（C0/C4 决定性对照）
- runtime/evidence/ENTER-EOF-ROOT-CAUSE.md §8、ENTER-EOF-FIX-REPORT.md 顶部更正
- test/vault/.typora/inkchapter-enter-echo-trace.json、audit/runtime-sess-1791800854509.log

## 代码与运行时
- 保留改动：探针生产硬关闭(blankRowAcceptanceDryRunEnabled=false) + Enter 回声窗口写入保持门（纵深防御，不改计数/视觉）；不修复文末缺陷。
- 构建/部署/实际加载 SHA 三者一致 = A337D6DF91E7B4171A9C214FF109DD8A5EA6E5F98140310F7579DDD529A549FF（loadSource=vault）；全局生产插件未覆盖（仍 DE62CB1A…）。
- 静态门：tsc exit 0；全量 235 files / 4479 tests PASS；build exit 0。

## 环境还原
- 目标文档已还原为用户 WIP：test/vault/Document-Diagnostics-Code-Integrity-Test.md = 1084B / F6D1861F…；备份 _backup-…md(1062B/B0CBB62F…)、_backup2-…md(1084B)、_backup-vault-plugins.json 保留。
- test/vault/.typora/plugins.json 已恢复 ranzhi.inkchapter=true。

## NEXT（待插桩）
对 heading-numbering-service.ts 绑定在 editor root 的 keydown 监听(onEnterCommand)做有界插桩，确认它是否使 Typora 的 pressReturn 序列执行两次（stopPropagation/同步重排/二次派发），据此定点修复；禁止改计数/延迟/掩盖。
>>>BODY

## [ENTRY 9] 2026-10-12T11:49:31.501Z sess-p0-caret-eof-full-closure
sha256: d67b2eb2e34c227b15433a779808e0b39978bd4791353adaa8133821199de111
<<<BODY
本轮 P0：光标隔离审计覆盖加固(禁止静默覆盖: 队列溢出计入 AUDITS_DROPPED 并判 FAIL_AUDIT_COVERAGE; 新增 invalidateNavigationAudits 于编辑器根重绑/切文档取消待处理项并计数) + 序列化泄漏判定(collectPluginPresentationTexts/scanPluginTextInSerializedMarkdown, 必须由真实导出文本判定, 未采样返回 NOT_RUN) + 构建 fail-fast(build:dev/build 前置 pnpm run typecheck=tsc --noEmit; 新增 build-pipeline-fail-fast.test.ts 回归守卫) + Enter 事件链有界只读取证(ENTER-PLUGIN-INTERVENTION-AUDIT; 证据: 普通 Enter 路径插件不调用 preventDefault/stopPropagation, 与 structuralWrite=0 一致)。门禁: TSC_EXIT=0; 全量 237 files/4494 tests PASS; build:dev PASS; 部署 test vault main.js=3A165610E9C56F78EE7FA2CEBCF9FEEDAAB69D37A6FA27B0D59CBFB039ADDE10 style.css=2B782DBD1D5172F8A36C204D247926541A6B70E18B00D234BE458490FD6AB414 (DEPLOY_HASH_MAIN_MATCH=True); 全局生产未覆盖(仍 DE62CB1A, GLOBAL_DEPLOY skipped)。运行时: Typora 未运行且禁止自行启动 => 文末 Enter C0/C4 对照、真实导航键、EOF 视觉(N=0/1/2/5/10)、题注交互、真实导出 Markdown 比对 = PENDING_USER_MANUAL; RUNTIME_IDENTITY=FAIL(已加载 430FC947 != 部署 3A165610, 需重启 Typora 重新加载)。返回 FAIL/PASS=
>>>BODY

## [ENTRY 10] 2026-10-12T12:26:44.733Z sess-p0-en11-indent-shortcut
sha256: 15a0f9b1f89e080667afbfba177bd3fe98b25f5e458e6b16c837f7fcbf4f3c3b
<<<BODY
EN-11 文末 Enter 重复拆分：优先核查缩进快捷输入 。。+Enter 是否为触发源 —— 结论=否证。证据(真实日志): 全部会话 ALLOW_SPECIAL_COMMAND=0 / CANONICAL-RECORD-COMMIT=0 / POST-TOKEN-SELECTION=0(缩进事务从未执行); 每次真实 Enter 的 ENTER-PLUGIN-INTERVENTION-AUDIT 均为 createdTransaction=false / defaultPreventedAtHandlerEnd=false / cancelBubbleAtHandlanDerEnd=false; 源码: readParagraphIndentCommand 仅当段落可见文本恰为 '..' 或 '。。' 才返回 token, 普通句末 。。 返回 null; resolveCurrentBodyParagraph 取选区所在 P 且空段落无 token => 普通 Enter 不可能进入缩进事务。D 组设计上 preventDefault+stopPropagation 且断言 paragraphCount 不变(不产生新段落), 与 +4LF 症状方向相反。新构建证据: 一次真实 Enter 仍产生两条 SPLIT_1_TO_2, 第二批含 pluginOwnedAddedCount=4(展示节点,无内容结构写入) => 归因收敛为回声窗口内插件展示层仍向 #write 写入。定点修复(写入侧): 新增 getEnterEchoWriteHoldRemainingMs(); overlay-host 新增 runContentDocumentPaint(reason,paint) 于回声窗口内推迟展示绘制到窗口后(审计 DOCUMENT-DIAGNOSTIC-ECHO-WINDOW-PAINT-HELD, 计数 echoWindowHeldPaintCount), 收口 5 类 7 处 reconcile 驱动的 #write 展示绘制(HEADING_MARKERS/ACTIVE_HEADING_EMPHASIS/REFLOOR_MARKERS/REFLOOR_ACTIVE_EMPHASIS/PASSIVE_ACTIVE_EMPHASIS/HEADING_TEXT_CHANGED_*/ACTIVE_BLOCK_GAP_RECOMMIT)。保留 。。+Enter 全部功能, 未改缩进模块/未吞原生 Enter/未删空行/未过滤 Mutation。门禁: tsc PASS; 定向 60/60; 全量 237 files/4496 tests PASS; build:dev PASS; archive verify PASS(ENTRY 10); 部署 vault SHA=9146A7B07386448BA0E88CBC19624C31DD56E58B8D72D4B099A39AA367D3E9F1 (global 未覆盖 DE62CB1A); 真实加载 9146A7B0(vault, init=1, PID48576) RUNTIME_IDENTITY=PASS。未运行(不得判 PASS): A禁用/B关缩进/D。。+Enter/C新构建复测, 均 NOT_RUN, 需人工受信任按键。
>>>BODY

## [ENTRY 11] 2026-10-12T12:41:57.510Z sess-p0-en11-causal-closure-r3
sha256: 35d965e29897c2726eac8296d92d1373e7e6b9f8ce459d64b05af1d3f9f4aae1
<<<BODY
EN-11 R3：先把 9146A7B0 候选的真实效果作为待证(本轮加载后尚无真实 Enter => EN11 未验收, 不得判 PASS)。Phase C 定点改造: 新增单一 PresentationPaintCoordinator(presentation-paint-coordinator.ts) 替换旧候选 7 处各自独立 setTimeout(remainingMs+1)。语义: 每(documentKey,展示域)仅一个 pending dirty intent(latest-wins 合并); intent 含 documentKey/editorRootId/sourceRevision/layoutEpoch/intentEpoch; 无 hold => 同步绘制(非 Enter 路径零变化); 有 hold => 帧驱动有界重检(heldPredicate 为唯一权威, 非固定 250ms 唯一判据; MAX_HELD_FRAMES=120 耗尽 fail-open 绘制, 标记不永久消失); 绘制时重读实时 identity/geometry 绝不重放旧 DOM; 文档切换/根替换/dispose => cancelAll + DROP_STALE; 无轮询/无 body MutationObserver/无反馈环。overlay-host 接入: bindDocument=>cancelAll(DOCUMENT_SWITCH), dispose=>coordinator.dispose(), runContentDocumentPaint 转发 coordinator.request(7 处调用点不变), 新增 seam getPresentationPaintCounters/getPresentationPaintPendingCount/flushPresentationPaintNow。未改 。。+Enter 缩进模块/原生 Enter/Undo/Redo/原生侧栏/公式编号题注。测试: 新增 presentation-paint-coordinator.test.ts (11 例状态机: 同步/hold挂起/同域合并/跨文档DROP_STALE/根替换/请求即失配/抛错fail-open/cancelAll-dispose/预算耗尽 fail-open); 更新 HOLD-5 断言协调器化并移除旧 setTimeout 断言; 修正 layout-invalidation 锚点冲突(单行包裹, 未放宽断言窗口)。门禁: tsc PASS; 定向 16/16; 全量 238 files/4507 tests PASS; build:dev PASS(含前置 tsc fail-fast); archive verify PASS; 部署 vault==project==741663E93C20E992422CAF28B911976DD25DF203890CDE184DF2CF35644CEB56 (global 未覆盖 DE62CB1A); 真实加载 741663E9 source=vault init=1 PID44588 RUNTIME_IDENTITY=PASS。未运行(不得判 PASS): C0/C4/B/D 真实 Enter, E/K/V 回归, 因果最小 A/B => C0_C4_BASELINE=NOT_RUN, EN11_REAL_ENTER_SEMANTIC=PENDING, PRESENTATION_WRITE_CAUSALITY=UNKNOWN, FINAL_DECISION=PENDING_USER_MANUAL。
>>>BODY

## [ENTRY 12] 2026-10-12T13:03:37.098Z sess-p0-en11-r4
sha256: 68f4abb979e23a7edb00c01e45a128ef611f2ed32b7a1f68339d129b70a9a69e
<<<BODY
EN-11 R4（承接 R3，不重跑旧指令）。先读源码判定 R3 协调器真实缺陷并修复三条: B1 hold 预算耗尽在 hold 仍 active 时强制写 #write => 改为 BLOCK(PAINT_BLOCKED_UNSTABLE, 保留 dirty intent, 停止主动循环, 事件驱动 resumeOnStable 恢复; fail-open 仅限抛错谓词/闭包); B2 editorRootId 恒传 null 且 sourceRevision/layoutEpoch 只记不校 => 改为 WeakMap 单调 root 身份 editorRoot#n(同 DIV#write 不同对象必然失效) + 提交前 live revision 校验(前进记 REDERIVED_FROM_LIVE 按 live 绘制, 缺失记 REVISION_UNKNOWN_AT_PAINT, 禁硬编码匹配) + 生命周期取消(request/rebind/cancelAll/dispose/bindDocument); B3 新增显式状态流 IDLE->PARKED/BLOCKED->COMMITTED/DROP_STALE 与不可见 PARKED_INACTIVE(不烧帧)。红->绿测试 T10/T12(B1) T13/T14(B2) T15(B3), 协调器测试 15 例 + hold 5 例。B4 全量枚举 11 类 #write/chrome 写入入口并标注根/Enter 窗口可触达/是否托管, 未声称零写入。验收脚本加固: 新增 ADMISSION 门(非当前有效身份 => 当前 Runtime 子门禁全 NOT_ADMITTED), EN11_ECHO_WINDOW_GATE 本次无真实 Enter 恒 NOT_RUN, AUDIT_COVERAGE 要求 eligible>0 且 dropped=0, 新增 OVERALL_DECISION 与退出码对齐(FAIL=exit2), UTF-8 BOM。决定性因果新证据(R3 构建真实 Enter, session 1791808827067): 协调器明确 PARKED(HEADING_MARKERS/ACTIVE_HEADING_EMPHASIS, reason=WRITE_HOLD_ACTIVE) 同时, echo-write trace structuralRecordCount=0/pluginStructuralWriteCount=0/originCounts={plugin:0,typora:14}(14 条全为 Typora 对 P.md-end-block 的属性写), 而第二次 SPLIT_1_TO_2 仍发生 => PRESENTATION_WRITE_CAUSALITY=REFUTED(结构性写入机制被否证; pluginOwnedAddedCount 是节点归属非写入者)。新领先假设(HYPOTHESIS): #write 内长期存在的 overlay 节点(存在性而非写入)改变 Typora 尾块再归一化; 最小单因子实验=临时把 overlay 容器挂到 #write 外层复测。门禁: tsc PASS; 定向 20/20; 全量 238 files/4511 tests PASS; build:dev PASS; archive verify PASS(ENTRY 12); 部署 vault==project==2BAC40036D3676193884FA6A96D0C2C95D012FC5DD85CA8D75F14702B3BB5758 (global 未覆盖 DE62CB1A); 真实加载 2BAC4003 source=vault init=1 PID17680 RUNTIME_IDENTITY=PASS。未运行(不得判 PASS): C0/C4/B/D 真实对照, E/K/V 回归, 真实导出 Markdown 比对 => FINAL_DECISION=PENDING_USER_MANUAL。
>>>BODY

## [ENTRY 13] 2026-10-12T13:06:04.312Z sess-p0-r4-scriptrun
sha256: a50db7689c6aa3b846ae43093f40d227c09ec0f234574d270b96ab0cbb00e90b
<<<BODY
运行 scripts/verify-p0-caret-eof-postrestart.ps1（R4 构建 2BAC4003, 真实加载 source=vault init=1 PID17680）=> OVERALL_DECISION=FAIL(exit2), RUNTIME_IDENTITY=PASS, ADMISSION=CURRENT_RUNTIME_ADMITTED, EN11_GROUP=C_PLAIN_ENTER, ENTER_DUPLICATE_SPLIT_OBSERVED=2, ECHO_WINDOW_PAINT_HELD=8, EN11_ECHO_WINDOW_GATE=FAIL, AUDIT_COVERAGE=NOT_RUN, CARET_ISOLATION_RUNTIME=NOT_RUN。决定性在其内证据(session 1791810143998, 两次真实 Enter): 每次 ENTER-PLUGIN-INTERVENTION createdTransaction=false/defaultPrevented=false; 协调器在窗口内明确 PARKED(HEADING_MARKERS+ACTIVE_HEADING_EMPHASIS, reason=WRITE_HOLD_ACTIVE, 即未写 #write); 随后仍出现 ENTER-DUPLICATE-SPLIT-AFTER-FINAL duplicateSplitIndex=2(windowMs=102/83)。结合 echo-write trace pluginStructuralWriteCount=0/originCounts={plugin:0,typora:14}(全为 Typora 自身对 P.md-end-block 的属性写) => 在两个不同构建上独立确认: 受管展示写入不是第二次拆分的原因; PRESENTATION_WRITE_CAUSALITY=REFUTED 得到在构建内证实。新领先假设(未证实, 需单因子实验): #write 子树内长期存在的 overlay 节点(存在性而非写入)改变 Typora 尾块再归一化。备注: 目标文档标题带 • 未保存标记, 本轮未修改该文档。
>>>BODY

## [ENTRY 14] 2026-10-17T17:34:44.602Z sess-p0-eof-visual-sync-r5
sha256: 5bd36a80f33150a39c66a93b96bcde703d3b3adb0798bba0322ff0485436b8dd
<<<BODY
EOF-R5 文末空行诊断↔视觉标记实时同步。根因(源码+真实日志): EOF excess band/label 只由定位/点击事务(commitSyntheticEofVisual→paintDocEndExcessRows)建立与重建, commitAdmittedSnapshot 被动提交后不投递任何 EOF 视觉同步; 且 recomputeSyntheticEofPresentation 在 geo.rect==null 时无条件清空旧 fragment+chip(编辑瞬间几何不可得 => 先清空后不补, 对应日志 visualFragmentCount 2->0); 审计 diagnosticDiff 原为 publish?'NONE':'REMOVE' 硬编码。修复: 新增 lastEofReconcileFacts + contentFingerprint(documentKey|rule|mode|visible|excess|detail) + geometryFingerprint(editorRoot弱映射身份|sourceRevision|layoutEpoch|trailingRowCount); commitAdmittedSnapshot 在 snapshot=admitted 后 dispatchDocumentEndExcessVisualSync (publish=false=>EOF_TAIL_RETRACT; excess==null=>保留不清空; UPDATE_CONTENT/UPDATE_GEOMETRY/NOOP; 经 runContentDocumentPaint('EOF_TAIL_VISUAL') 协调器); rederiveSyntheticEofVisualOnLayoutChange(extraOverride) 用实时 excess; geo.rect==null 仅 liveExcessRows==0 才清理; 新增 clearEofExcessFragments 仅清本 owner; 审计新增 visualUpdate/contentFingerprint/geometryFingerprint, diagnosticDiff 恢复身份语义。行为测试(真实 host+DOM): 新增 document-diagnostic-eof-visual-sync-r5.test.ts 12 例 EOF-01..15 可执行子集(被动 1->2/2->3/3->2/2->1/3->1/0->1/快速连续/激活态/同 carrier/几何重测/不可测保留/内部空行)。门禁: tsc PASS; 定向 84/84; 全量 239 files/4523 tests PASS; build:dev PASS; 部署 vault==project==B0A98E0953F4A3B7D5777ECC6DD6241E1A5DE3281D88AE05DD3DC22C8615BDDC; 全局未覆盖 DE62CB1A; RUNTIME_IDENTITY=FAIL(loaded 2BAC4003 未重启, 实例 PID37556 含未保存 WIP 未强制关闭)。未运行(不得判 PASS): EOF-07(real)/09/12(real)/13(pixel)/14/15(code,formula,CRLF)/16 与 8 项真实硬门禁 => FINAL_DECISION=PENDING_USER_MANUAL。
>>>BODY

## [ENTRY 15] 2026-10-17T17:42:19.602Z sess-eof-r5-feedback
sha256: 1ddc6a6eaad2db49979261e12e8a93d7f386d5fe3baacb2af0ad32ab4dbfad2c
<<<BODY
用户真实反馈复核(2026-10-18): ①有余行时增减行数数值变而作色块不变 ②删到剩一行色块消失 ③文末回车成两个空行。①复核结论: 旧会话 runtime-sess-1792255754176 (构建 2BAC4003) 中 EOF-BLANK-COUNT-AUDIT(paintDocEndExcessRows 内)仅 3 次且全为 excess=2, 而 decision audit 已出现 3->2->3 => 被动期间无任何重绘, 与用户观察一致; 新增 EOF-04b 行为断言(着色块 style.height 随 3->2->4 缩小/增大) PASS, 证明修复路径同时更新标签与几何; 新构建 B0A98E09 下真实场景仍 PENDING_USER_MANUAL。②剩一行消失是 publish=false -> EOF_TAIL_RETRACT 预期行为(已补零残留断言 EOF-05/06)。③文末回车=EN-11 历史问题, 已证非插件写入(pluginStructuralWriteCount=0), 属 Typora 尾块再归一化, 本轮按 R5 范围未改 Enter 逻辑, 仍 PENDING_USER_MANUAL。定向 13/13 PASS; 未 commit。
>>>BODY

## [ENTRY 16] 2026-10-17T17:44:05.892Z sess-eof-r5-audit-read
sha256: 1f379a1e6c6963815c31b5942cecefaf0b532ad57ee2f26e745a98ff19514464
<<<BODY
真实验收读取: 会话 runtime-sess-1792258568994(构建 B0A98E09) 中 DOCUMENT-DIAGNOSTIC-EOF-VISUAL-SYNC / EOF-BLANK-COUNT-AUDIT / EOF-BLANK-DECISION-AUDIT 全部 0 条; 文件停在 110 行/73458B MTIME=01:38:55, 末条 FORENSIC-SINK-FLUSH queued=109 written=109 dropped=0; 之后标题出现 EOF-R5-Verify-3blanks.md• (确有编辑) 但审计再无任何事件。同会话 17:38:54 ACTIVE-DOCUMENT-RECONCILE 报告 presenceState=EMPTY / activeLeafPath='' / documentEpoch=0 / canonicalFrameDocumentKey=null / readinessState=INACTIVE => 插件在 EMPTY-TAB-CLOSE-INVARIANT + 第二次 CLI 打开文件后丢失活动文档绑定, 对当前文档 INACTIVE, EOF 链路未运行。判定: EOF 视觉同步=NOT_RUN(缺可判定真实字段, 非 PASS 非 FAIL); 新增待修缺陷(非 R5 引入): EMPTY_TAB_CLOSE 后未重新绑定真实文档。恢复步骤: 完全退出 Typora->重开 vault->在 Typora 内打开 runtime/EOF-R5-Verify-3blanks.md(不要第二个 CLI 进程)->确认 presenceState=PRESENT 后再编辑。未 commit。
>>>BODY

## [ENTRY 17] 2026-10-17T17:50:19.179Z sess-eof-r5-restored
sha256: cb2cbf71fb2ebb65249f5cffd0f8bf264a5526bb31f0a8e538d6699feac2df90
<<<BODY
环境恢复并读取真实字段(构建 B0A98E09): 恢复方式=vault 启动 + 第二进程转发文件(无空标签竞争) => presenceState=ACTIVE / activeLeafPath=.../runtime/EOF-R5-Verify-3blanks.md / documentEpoch=2 / canonicalFrameState=READY。真实 OS 按键 Ctrl+End + Enter: ENTER-ADMISSION-AUDIT key=Enter code='' isTrusted=true decision=REJECT_NON_ENTER (插件按非标准 Enter 拒绝, 未进入 EN-11 路径); 但文档仍变化, EOF-BLANK-DECISION-AUDIT: renderedVisibleBlankCount=4, excessVisibleRows=3, detail='文末有 4 个可见空行，建议保留 1 个。', diagnosticDiff=NONE, visualUpdate=UPDATE_CONTENT, contentFingerprint=...|wysiwyg|4|3|..., geometryFingerprint=editorRoot#1|2|6|4, visualFragmentCount=0, publish=true。判定: 诊断链路正确(visualUpdate 按内容指纹触发, diagnosticDiff=NONE 不再阻断); 视觉仍 NOT_RUN(visualFragmentCount=0, 该文档从未点击 EOF 诊断, 无 locateDocEndCarrier, 被动同步按设计不新建第二套几何权威); EN-11 旁证: 本次 Enter 被插件 REJECT_NON_ENTER 未介入, 仍有 2->4 可见空行 / LF 3->7 (+4), 即该次 +2 由 Typora 产生, 非插件干预, 仍需真实鼠标+键盘 C0/C4 定论。下一步: 用户点击 Drawer '文档末尾空行过多' 一次建立 carrier, 再 Enter/Backspace, 即可读 EOF-VISUAL-SYNC 与 EOF-BLANK-COUNT-AUDIT 判定闭环。未 commit。
>>>BODY

## [ENTRY 18] 2026-10-17T17:52:18.112Z sess-eof-r5-closure
sha256: 657555b06e9f4369be08a2e92783dcd77c2db0e48f467410270e8f8546526bc2
<<<BODY
真实闭环证据(构建 B0A98E09, 用户点击 Drawer + 真实 Enter/Backspace, session 1792259260353): EOF-VISUAL-SYNC 5 条 = UPDATE_CONTENT(visible3/excess2) / UPDATE_CONTENT(2/1) / RETRACT(1/0) / UPDATE_CONTENT(2/1) / NOOP(同指纹幂等); EOF-BLANK-COUNT-AUDIT 5 条 = excess 3/2/1/2/1, expected==actual 5/5, visualFragmentRebuilt=true 5/5, eofOldFragmentCleanupCount 0/4/3/0/3。判定: 用户报告『数值变、色块不变』已闭环(audit 级 PASS); 真实硬门禁 7 项为 0, EOF_CROSS_DOCUMENT_STALE_PAINT_COUNT=NOT_RUN(单文档)。仍开放: EN-11(本次 OS Enter code='' 被 REJECT_NON_ENTER, 需真实鼠标+标准 code=Enter 的 C0/C4), EOF-07 real/09/12 real/13 pixel/14/15 code-formula-CRLF/16。RUNTIME_IDENTITY=PASS(B0A98E09, source=vault, init=1)。未 commit。
>>>BODY

## [ENTRY 19] 2026-10-17T18:03:08.013Z sess-en11-r6-retest
sha256: a2eed542114a547216f2f91c9f2047f29d5d4bf03246056bca3d26083233cf4e
<<<BODY
用户物理键盘复测报告『依旧还是两个』, 但同刻审计显示该文档(EOF-R5-Enter-Probe.md, 由 CLI 第二进程打开)从未被插件接管: presenceState=EMPTY / activeLeafPath='' / hasActiveDocument=false / presenceSource=ACTIVE_LEAF_EMPTY / toolbarPresentation=suppressed(NO_ACTIVE_DOCUMENT)。=> 本次复测不能判定层位置修复(ensureLocateDocumentLayer 未执行, #write 内无展示层), 属 NOT_TESTED 而非否证; 同时说明该现象在插件未参与编辑 DOM 时也会出现(Typora 侧行为)。新阻塞项: 第二 CLI 进程打开的文件不绑定插件, 使所有 C4 真实验收无效; 复测必须用 Typora 侧栏/应用内打开。EN11_LAYER_PLACEMENT_FIX=NOT_TESTED, EN11_REAL_RUNTIME=PENDING_USER_MANUAL。门禁: tsc PASS, 定向 14/14, 全量 239 files/4525 tests PASS, build+deploy B68D5041。未 commit。
>>>BODY

## [ENTRY 20] 2026-10-17T18:15:25.668Z sess-en11-r6-attribution
sha256: 67189740c053a3d2932e590cc73e1389b23bc9ded28832a2a3c79a8886655c74
<<<BODY
绑定缺陷结论: main.ts:95 readWorkspaceActiveLeafState 以 activeLeaf.state.path 为最高权威, resolveActiveDocumentPresence 规定 leafStateKnown+path=='' => EMPTY 永不回退 stale activeFile/documentKey(LAST-TAB-1..12 守卫)。为 CLI 第二进程打开路径放宽该 veto 会重新引入陈旧文档身份, 风险>收益 => 判定为开发路径限制, 不改。EN-11 归因: 两条独立证据均指向非插件所致: (1) 真实 Enter 回显窗口 pluginStructuralWriteCount=0 / originCounts={plugin:0,typora:14} / coordinator PARKED 而第二次 SPLIT_1_TO_2 仍发生; (2) 插件完全未绑定(hasActiveDocument=false, presenceState=EMPTY, #write 内无展示层)时用户按 Enter 仍得两个空行。=> EN11_PLUGIN_ATTRIBUTABLE=false(证据级); EN11_LAYER_PLACEMENT_FIX=NOT_TESTED(无法建立有效 C4)。仍差一次有效 C4: 侧栏打开 -> presenceState=ACTIVE -> 物理 Enter。环境: Typora 以 vault 启动, 空工作区, 探针已重置为 '# T\n\ncontent'。未 commit。
>>>BODY

## [ENTRY 21] 2026-10-17T18:18:02.094Z sess-en11-r6-c4-pass
sha256: 9038da5eec0383328719ce7e83dbdfdfc29a478eabee68f2bc55a480a1a326a8
<<<BODY
有效 C4(构建 B68D5041, presenceState=ACTIVE, activeLeafPath=.../EOF-R5-Enter-Probe.md, canonicalFrameState=READY): 真实 Enter ALLOW_NORMAL_ENTER x16(code=Enter,isTrusted=true); ENTER-PLUGIN-INTERVENTION 全部 createdTransaction=false/defaultPrevented=false/cancelBubble=false/dispatchSyntheticEnter=false; ENTER-DUPLICATE-SPLIT-AFTER-FINAL=0; echo trace structural=0/pluginStructural=0/originCounts={plugin:0,typora:14}; 每次 Enter renderedVisibleBlankCount +1(2->3), 源码 LF +2(正常 1 段落)。跨构建对照: 3A165610/2BAC4003(展示层在 #write 末尾) duplicateSplitIndex=2; B68D5041(层前置) =0。=> EN11_LAYER_PLACEMENT_FIX=PASS(真实 Runtime), EN11_REAL_RUNTIME=PASS。残余: 未在同一会话执行 C0 配对(仅跨构建前后对照+用户目视确认 '貌似已经修复了'); EOF-07 real/09/12 real/13 pixel/14/15(code/formula/CRLF)/16 仍 NOT_RUN。
>>>BODY

## [ENTRY 22] 2026-10-17T18:20:41.079Z sess-eof-r5-0709
sha256: 4f49d278d2d50431872a37f8f1a08a5b502f65a7b277303c4de9bde875a04f1e
<<<BODY
补跑 EOF-07/EOF-09(构建 B68D5041, presenceState=ACTIVE, 真实按键/撤销)。EOF-07=PASS: DOCUMENT-TRAILING-BLANK-AUDIT 记录 tail '# T\n\ncontent'(sourceLength=12), hasTerminalNewline=false, terminalNewlineCount=0, extraTrailingBlankLineCount=0, policyDecision=MISSING_TERMINAL_NEWLINE, nextDiagnostic=[DOCUMENT_TERMINAL_NEWLINE_MISSING], 且无 DOCUMENT_TRAILING_BLANK_LINES_EXCESSIVE(过量标记未出现); 中间 1 行合法态 tail 'content\n\n'(14B) policyDecision=PASS。EOF-09=PARTIAL: Undo 真实生效并同步策略 16B/EXCESSIVE -> 14B/PASS -> 12B/MISSING_TERMINAL_NEWLINE; Redo(Ctrl+Y 与 Ctrl+Shift+Z)未被送达, fill/标签无 carrier(本会话 EOF-VISUAL-SYNC=0) => Redo 与 fill/label NOT_RUN。备注: 自动化需先用 ShowWindow(SW_RESTORE)+鼠标点击取得焦点, 否则键盘事件不达编辑器; 合成 Enter 会双插入, 不可用于判定。未 commit 用户文档。
>>>BODY

## [ENTRY 23] 2026-10-17T18:24:30.294Z sess-eof-r5-eof09
sha256: 7a20500ffee75c7fa43c07fabedfd87c5a032c16bdbbe4194bc2d7e949ee7766
<<<BODY
EOF-09 完整 PASS(构建 B68D5041, presenceState=ACTIVE, 用户点击 Drawer 建立 carrier, 真实按键 Enter->Ctrl+Z->Ctrl+Y)。EOF-BLANK-COUNT-AUDIT: sourceRevision 4/5/6 对应 visible 4/3/4, excess 3/2/3, eofExpectedExcessFragmentCount==eofActualExcessFragmentCount (3==3 / 2==2 / 3==3), eofFragmentSetMatch=true, visualFragmentRebuilt=true, eofOldFragmentCleanupCount 3/4/3。EOF-VISUAL-SYNC 三条均 update=UPDATE_CONTENT 且 visible/excess 与计数审计一致; 无 RETRACT(全程 excess>=1)。=> Undo/Redo 下 Drawer/标签/着色集合同步恢复 = PASS, 无残留。自动化要点: 需 ShowWindow(SW_RESTORE)+SetForegroundWindow+点击编辑区取焦点; Chromium AX 树不可用(仅 Chrome Legacy Window), Drawer 行需人工点击一次建立 carrier。未 commit 用户文档。
>>>BODY

## [ENTRY 24] 2026-10-17T18:48:35.285Z sess-en11-r6-tb3
sha256: 73e088a87c72cd0e1abe2f2eb8630a8244c97add25f5f512fcb0fb7de07d3399
<<<BODY
复核用户反馈(Probe 正常, Document-Diagnostics-Trailing-Blank-3 仍两个空行): 加载构建=B68D5041(loadedAt 18:22:10, init=1) 修复已生效; 但 activeLeafPath 仍为 runtime/EOF-R5-Enter-Probe.md; 含 Document-Diagnostics-Trailing-Blank-3 的审计事件=0; 插件日志最后一条 @file:open/@active-leaf:change=18:23:03, 之后无 => 该文档是 CLI 第二进程打开的标签, 不在框架标签模型内, 插件从未接管(非构建未更新)。另: T-B-3 文件本身以 3 个空行结尾(39B/6LF, '# Trailing Blank 3\n\n正文结束。\n\n\n\n'), 在绝对末尾 Enter 会在既有空行上再加一个空段落, 与 Probe(0 尾随空行)不可直接对比。正确复测: 用侧栏打开 T-B-3 -> 确认 activeLeafPath 切换 -> 再按 Enter。未 commit。
>>>BODY

## [ENTRY 25] 2026-10-17T18:49:44.622Z sess-en11-r6-why
sha256: f09950b53b2ee5349adfad432197c6c159ee38c693e1c6b0010c053d35d7bda0
<<<BODY
事件链证据: 插件日志 file:open 最后 5 条止于 18:23:03(Probe); T-B-3 在已有活动文档时由第二 CLI 进程打开, Typora 用原生标签层创建, 未经框架 workspace.openFile => 不触发 file:open / active-leaf:change, workspace.activeLeaf 仍为 Probe => 插件按 main.ts:95 以 activeLeaf.state.path 为最高权威, 继续绑定 Probe, 对 T-B-3 0 事件。对比 17:48:25 的 CLI 打开发生在空工作区, 触发了 file:open 并绑定成功。结论: 框架对外部标签的盲区, 非 R5 未同步; 侧栏打开可正常绑定。
>>>BODY

## [ENTRY 26] 2026-10-28T02:50:04.725Z formula-render-serialization-guard-v1
sha256: 56e33346556c80eb0c463e3b639873205bfaf244809da382efe279071c6e7a5a
<<<BODY
## 问题
墨章加载后，含块公式的文档里 `.md-math-block` 内容被清空：块内只剩 md-rawblock-tooltip，
不含 script[type=math/tex]、不含 mjx-container，getBoundingClientRect().height=0；
Typora 的 File.editor.mathBlock.renderUnder(block,true) 也无法恢复（块内已无源码）。
复现文档：test/vault/墨章插件测试/01-中文学术论文模板.md（两个块公式）。
短文档（PA-Formula-Audit.md 等）不受影响。

## 根因
文档诊断事务为了让“结构快照”可信，调用 Typora 私有 API
UserOp.getMarkdownSourceFrom(writingArea) 对整个 #write 做结构序列化。
该调用会清空块公式内容，即使 MathJax 已完成渲染。

二分证据（每步都重启真实 Typora）：
1) 禁用插件 → 公式正常；
2) 跳过标题装饰投影 → 仍空白；
3) 跳过段落布局投影 → 仍空白；
4) 跳过内部空行诊断呈现 → 仍空白；
5) 跳过整层 document-utilities → 公式恢复；
6) 仅跳过结构序列化 → 公式恢复（定位到该 API）。
7) “等公式渲染完成后再序列化”实测不安全：同一会话内
   STRUCTURAL_SERIALIZER/VERIFIED 之后下一次快照又变 DEGRADED，
   证明已渲染的 mjx 同样会被清空。

## 修复
src/main.ts readStructuralMarkdown：文档存在 `.md-math-block` 时直接降级为增量镜像
（structural:false, reason:API_UNAVAILABLE），不再调用 UserOp.getMarkdownSourceFrom。
公式渲染优先于结构诊断。

## 代价
含块公式的文档不再产出基于结构快照的内部空行诊断（走 DEGRADED 分支，不误报）；
其余诊断与工具不受影响。

## 验证
- build:dev（含 strict typecheck）exit 0；
- test：259 files / 4874 tests passed；
- DIST 与 vault 插件 SHA 一致：636EB6E4A6B6B3CDD8E8F4014069A6E77853DB122E9A946CF0EA2C1B76DCB566；
- 真实 Typora（默认配置）：01 模板 (5.3-1)、(11.2-1) 正常渲染；
- 页面探针 CHK:1@28,1@171（两个块各 1 个 mjx-container，高度 28/171；修复前为 0 个 / 0）；
- 当前会话结构快照 8/8 INCREMENTAL_MIRROR/DEGRADED，无 STRUCTURAL_SERIALIZER。

## 未验证
- 仅验证了 01 模板与短公式文档；未做全量文档回归。
- 诊断降级对“含公式且同时存在空白行问题”文档的实际体验影响未做 GUI 验收。
>>>BODY

## [ENTRY 27] 2026-10-28T03:34:23.362Z blank-gap-incremental-closure-v1
sha256: e3af96f6e4e1dc5de7fb14905b59635dca6439c80010bf2cc2455d692f5e6bd8
<<<BODY
## 目标
Blank Gap 增量更新闭环（GAP_EXPAND/SHRINK/SPLIT/MERGE）+ 延迟定位。只处理空行标记，不动公式编号。

## 已实施修复（F1）
src/document-utilities/document-utility-overlay-host.ts：MutationObserver 的 rAF 回调中，
仅 realContentMutation=true 时才 scheduleDiagnosticsRecompute；纯插件 overlay 写入只做几何同步。
理由：recompute 在 NOOP 判断之前就执行 getStructuralMarkdown → UserOp.getMarkdownSourceFrom（全文序列化），
纯 overlay 批次会形成“永远不可发布”的序列化自唤醒热点。

## 未新增
未新增 GAP_* 枚举 / 第二激活权威；merge 走既有 resolveRenderedBlankRows 重新测量（非旧计数相加）；
视觉 carrier 复用未实施（高风险，需独立迭代）。

## 门禁
typecheck exit 0；test 259 files / 4874 tests passed；build:dev exit 0；
dist / deploy / loaded SHA 三处一致 B3E1B797D9760AFD90CCEEC3460AA716740F9859D5B19861B51577999B4E4F81。

## GUI
BLOCKED：运行时 DOCUMENT-UTILITY-ACTIVE-DOCUMENT-RECONCILE-INVARIANT 显示
presenceState=EMPTY / activeLeafPath=" / readinessState=INACTIVE / recomputeStarted=false。
诊断事务未启动，T0-T8 与 LAT-01..LAT-24 均未执行；破坏性编辑因无可靠 Caret 身份未盲发。
最小人工操作：在 Typora 文件树单击 runtime/smoke/R8-Blank-Row-Split-Merge-Cycle.md 后复测。

## 交付
runtime/evidence/blank-gap-incremental-closure/ 下 8 份文档（BASELINE / FIRST-LATENCY-STAGE /
GAP-STATE-CONTRACT / FIX-LEDGER / LAT-REGRESSION-MATRIX / PERFORMANCE-COMPARISON /
RUNTIME-IDENTITY / FINAL-REPORT）。

FINAL_DECISION = PARTIAL
>>>BODY

## [ENTRY 28] 2026-10-28T04:27:12.186Z blank-gap-merge-gui-v1
sha256: 906b554bd628e275267637e0aa9027bc7ad8b13ff4f3500b2277a155444e815a
<<<BODY
## 真实 GUI 补充（当前 loaded SHA B3E1B797）
- 启动方式修正：不再用 powershell+Start-Process（其控制台会话被关闭会连带关闭 Typora），
  改为 WMI 直接启动 Typora.exe + vault；文档用「文件→打开」在窗口内加载，active leaf 正常。
- LAT-15 PASS：R8 激活后 10 次纯光标下移，R10-STRUCTURAL-SERIALIZE-AUDIT 7→7、
  DOCUMENT-DIAGNOSTIC-STRUCTURAL-SNAPSHOT 7→7，增量 0。
- LAT-17/LAT-18 PASS（GAP_MERGE）：R8 原为「前段 + 4 空行 + 啊 + 4 空行 + 后段」；
  UIA 点击段首“啊” → Home/Shift+End/Ctrl+C 回读“啊”证明 caret 身份 → Backspace 清空文本。
  结果 Drawer 仅 1 条内部空行诊断：「存在 5 个可视连续空行」——即重新测量值，
  非旧左 4 + 旧右 4 = 8；EOF 诊断独立。夹具磁盘 SHA 始终 2432F999…7AE94E（未写盘）。
- 其余 LAT 项仍未执行；FINAL_DECISION 维持 PARTIAL。
>>>BODY

## [ENTRY 29] 2026-10-28T04:58:46.103Z blank-gap-threshold-gui-v1
sha256: aba04200d3283992fe3c8fbad58aff1ce5d673f98746e6f8aa724f28bc0044eb
<<<BODY
## 追加真实 GUI 证据（loaded SHA B3E1B797）
- LAT-06 PASS（2→1 退出违规）：R8 从 5 空行逐次 Backspace 到 3、再到 1；
  工具栏「警告 2 → 1」，内部空行条目消失，仅剩「文末需保留 1 个空行」。
- LAT-07 PASS（1→2 恢复违规）：在 1 空行合规态按 Enter；
  工具栏「警告 1 → 2」，内部条目恢复为「存在 2 个可视连续空行」。
- LAT-20 BLOCKED：插入点须落在空行区间中点，UIA 无法稳定暴露空段锚点，
  type_text/单键输入在跨工具调用后丢失焦点，未取得可信插入证据。
- 夹具磁盘 SHA 仍为 2432F999…7AE94E（窗口内编辑未保存）。
>>>BODY

## [ENTRY 30] 2026-10-28T05:25:05.946Z blank-gap-split-gui-v1
sha256: e37609bc466d7c0aac55cd0d92cad534b85263e7a1054a3b1dac57cc3c9f53a2
<<<BODY
## LAT-20 PASS（真实 GUI，当前 loaded SHA B3E1B797）
- 用户手动在合并区间内插入独立段落 X 并保存，文件结构为：
  前段 / 4空行 / 啊 / 4空行 / X / 3空行 / 后段 / 1空行 / 尾部。
- 工具栏显示「警告 3」：三个违规区间（4/4/3）各自独立测量并各报一条，
  没有相加成 11，也没有只报一条合并区间；末段 1 空行合规不告警。
- 结论：GAP_SPLIT 生效，合并区间被拆为独立候选段，各自按真实 DOM 重新测量。
- 夹具已恢复基线原文：SHA 2432F9993E61AAEDC72AEA89AB9DDAC0F267C1518841530359CCC357157AE94E，size=206。

## 当前 LAT 汇总
PASS：LAT-06、LAT-07、LAT-15、LAT-17、LAT-18、LAT-20
未执行：LAT-01..05、08..14、16、19、21..24、S04-S14
FINAL_DECISION 仍为 PARTIAL。
>>>BODY

## [ENTRY 31] 2026-10-28T05:47:06.906Z sess-1793165988721
sha256: f523fa6c60730bf2331d966ae8f4ca4acc69c87356c3502686ba6c3bfd2d9a1f
<<<BODY
## 本轮完成：LAT-01/03/04/05/08/09/10/11/12/16/21/22 真实 GUI 验收（PARTIAL 更新）

运行身份：Typora 1.6.7 + vault 模式，loaded SHA B3E1B797D9760AFD90CCEEC3460AA716740F9859D5B19861B51577999B4E4F81。
审计会话 runtime-sess-1793165988721.log（主）/ runtime-sess-1793165734110.log（LAT-01/02 早期片段）。

关键结果：
- LAT-01 单 Enter：src 5→7 / visible 2→3，即时增长；
- LAT-03 Backspace 1：工具栏 警告 3→2 即时收缩；
- LAT-04 Backspace 10：警告 3→2→1，无残影，12 次 Undo 回基线；
- LAT-05 Enter/Backspace 30 次：状态与基线完全一致；
- LAT-08/09/10/21：SPLIT 后区间身份取最近块 c#0，逆序删除逐级 MERGE_2_TO_1 血缘正确；
- LAT-11 两个「啊」：啊#0 / 啊#1 未串身份；
- LAT-12 NBSP+U+200B：rows 2→3，仍按空行计，不误认正文；
- LAT-16 Drawer：类别切换正确，点击诊断行 clickDecision=PASS / activeLeasePresent=true；
- LAT-22 Merge→Undo×2→Redo×2：四步逐次收敛，警告 3 稳定。

重要观测：source 与 visible 是两条独立量（5 个 source 空行在 WYSIWYG 下呈现 2 个可见空行带）；
插件自身呈现写入 66 次全部命中 PLUGIN_PRESENTATION_SHORT_CIRCUIT（F1 生效）；
真实内容写入仍会触发结构序列化（本会话 serialize/snapshot 各 160 次），大文档成本未证明。
Typora 的 Ctrl+C 纯文本复制会折叠连续空段落，不能用于判断空行数量。

仍未执行：LAT-14/19/23/24、S04–S14；LAT-02/13 仅部分覆盖。FINAL_DECISION 保持 PARTIAL。
夹具磁盘 SHA 全程 2432F999…7AE94E（206 字节），未写盘；改动以「放弃更改」丢弃。
证据：runtime/evidence/blank-gap-incremental-closure/{LAT-REGRESSION-MATRIX.md,FINAL-REPORT.md}
>>>BODY

## [ENTRY 32] 2026-10-28T06:55:07.871Z sess-p0-reliability-r1
sha256: 9828ead8f4b8d29877aad4caebbc5b33dd86facf6861713fce694c88220c6490
<<<BODY
## P0 连续空行可靠性与实时性专项（第一轮）：DET/LOC 两项根因修复

基线：branch archive/blank-gap-incremental-closure-20261028，HEAD 0ce5f82；三份 app-*.log 在本机不存在，
逐事务日志关联标记 BLOCKED，改用调用链定位 + 失败先行单测复现。

已确认根因与修复：
- DET：evaluateSemanticReconcileDecision 在 stateKey 重复时忽略 mutationShape，真实 SPLIT_1_TO_2 /
  MERGE_2_TO_1 / COMPLEX / REPLACE_1_TO_1 批次被 NOOP_DUPLICATE_SEMANTIC_STATE 短路。修复：该捷径
  仅在 mutationShape==='NONE' 时成立。单测 5 红 -> 7 绿。
- LOC：LOCATE_BOUNDED_REFRESH 后按旧 diagnosticId 查找，刷新会重新签发新 id，导致点击静默结束、无标记。
  修复：新增 resolveLocateSuccessor（规则码 + 规范边界身份，歧义返回 null），宿主 TARGET_CHANGED /
  UNRESOLVED 两支改为 rebind + 显式 DIAGNOSTIC_EXPIRED 退休。单测 7 红 -> 7 绿。
- TEST：R6-08b 的 indexOf('\n  }\n') 抽取在本文件返回 -1，断言实际是空切片（空转）。改为括号配平抽取 + 长度下限。

验证：typecheck exit 0；全量 261 文件 / 4888 测试通过；build:dev exit 0；
dist/deploy SHA = C1B39FA7DD66837AB30721E4B127BF2994D11AEE107ADE87B7E1ABEF7C23FAD6；
loaded 仍为 B3E1B797…（Typora 持有未保存缓冲区，禁止强制重启）=> LOADED_STALE。

未完成：VIS 被动标记修复（仅确认 9071-9084 只计数不修复）、phaseBefore=IDLE 继承成员切换语义、
LIFE/PERF/GUI 全部 BLOCKED。FINAL_DECISION = PARTIAL。
证据：runtime/evidence/blank-gap-reliability-closure/（11 份）
>>>BODY

## [ENTRY 33] 2026-10-28T12:20:49.444Z sess-p0-reliability-gui
sha256: 7cfeeb3879a5890160314f3eec3766a9901e0484ea828b22fd4ed6990c9ca405
<<<BODY
## P0 连续空行可靠性专项：同版本真实 GUI 验收（G1-G10）

运行身份：loaded = deployed = dist = C1B39FA7DD66837AB30721E4B127BF2994D11AEE107ADE87B7E1ABEF7C23FAD6，
loadedAt=2026-10-28T12:11:56.740Z，audit 会话 runtime-sess-1793189621674.log。
夹具 runtime/smoke/P0-Det-Loc-Vis.md（59B，SHA 4A8C978E…ED15），全程未保存，磁盘 SHA 复原一致。

结果：G1 PASS（打开即 警告 3，IA gaps=2 均为 7 源空行 / DEC vis=3）；
G2 PASS（Enter 后 PROBE src=9 rows=4，抽屉行文案同步，工具栏仍 3）；
G3 PASS（点击 clickDecision=PASS / ACTIVATE / firstClickActivated=true；VISUAL-OUTCOME PRESENTED；
VISUAL-CLOSURE blockGapActiveFillCount=1；几何 PASS、overhang=0）；
G4 PARTIAL（3 行同行保留、占位/几何审计 PASS，但无 DOM 级被动计数可证）；
G5 NOT TESTED（行随诊断消失，无法构造陈旧行点击）；
G6 PASS（Backspace×6 合并，警告 3→2，无残留行）；G7 PASS（Undo×6 复原 4/3 行与 警告 3）；
G8 PASS（doc.md 独立窗口独立 警告 3，无跨文档串扰）；G9 PASS（缩放后几何 PASS、epoch 11/11）；
G10 PASS（16 次 Enter/Backspace 交替后状态与基线一致）。

源码相关化观测：source→rendered 归一化 3→1/4→1/5→2/7→3/9→4，规则按可见带决定；
VISUAL-OUTCOME-V2.1 出现自相矛盾（PRESENTED 同时 gateReason=PRESENTATION_NOT_BUILT,
VISUAL_CARRIER_MISSING,PANEL_GEOMETRY_CLIP、fillCommitted=false），而 CLOSURE 报 activeFill=1，待后续对齐。

FINAL_DECISION 维持 PARTIAL（VIS 未复现、G5 未测、性能未测）。
>>>BODY

## [ENTRY 34] 2026-10-28T12:47:37.864Z sess-f4-vis-outcome
sha256: c012978526e14d72a17e92ea863ddc23e2d53ce0a38697e23de14601af1f1d77
<<<BODY
## F4：修复 VISUAL-OUTCOME-V2.1 的自相矛盾记录

症状（runtime-sess-1793189621674.log）：同一事务里 visualOutcome=PRESENTED 同时带
gateReason=PRESENTATION_NOT_BUILT,VISUAL_CARRIER_MISSING,PANEL_GEOMETRY_CLIP 与 fillCommitted=false，
而 VISUAL-CLOSURE-AUDIT 报 blockGapActiveFillCount=1。

三个根因：
1) classifyDiagnosticVisualFailure 对任何非分层类 gate 原因一律返回 PRESENTED；
2) isPanelLayeringCollisionReason 对整串比较，逗号拼接的原因列表永远不会命中分层族；
3) fillCommitted 只看 locateCommittedVisual/locateDocCarrier/locateFrame，漏掉 block-gap 载体。

改动：
- PRESENTED 现在要求 gateReason 为空（干净门禁）；
- gate 失败且非分层类 → DEGRADED_PRESENTED（keepActive=true、rollback=false、reason=GATE_FAILED_NON_LAYERING），
  不因当下还没有
>>>BODY

## [ENTRY 35] 2026-10-28T12:54:30.544Z sess-f4-gui
sha256: 43ac09f9fb3cfe90e9071f55e4eb5d4cadd928a45ad07580930c1acacbe5eb2d
<<<BODY
## F4 同版本 GUI 复验（loaded = 73E77187…）

运行身份：loaded = deployed = dist = 73E771870A9F85BF729A5CD007BD095D192E6F900F6C9A185068D96C2FBF3C9A，
loadedAt=2026-10-28T12:50:30.687Z，会话 runtime-sess-1793191830555.log；夹具 P0-Det-Loc-Vis.md
（59B，SHA 4A8C978E…ED15，全程未保存，磁盘不变）。

F4 实测记录（同一事务）：
gate=[PRESENTATION_NOT_BUILT,VISUAL_CARRIER_MISSING,PANEL_GEOMETRY_CLIP]
visual=DEGRADED_PRESENTED decision=DEGRADED_PRESENTED reason=GATE_FAILED_NON_LAYERING
fillCommitted=True keepActive=True rollbackRequired=False targetEnteredViewport=True
与 CLOSURE 的 blockGapActiveFillCount=1 一致，不再自相矛盾。

G1 PASS（警告 3，两段各 3 可见带）；G2 PASS（Enter 后标记 3→4、警告仍 3）；
G3 PASS（click=ACTIVATE/PASS、activeLease=true、firstClick=true、activeFill=1）；
G4 PARTIAL（三行均保留，无 DOM 级被动计数）；
G5 NOT TESTED；G6 PASS（Backspace×6，警告 3→2）；G7 PASS（Undo×6 复原 4/3 与 警告 3）；
G9 PASS（缩放后状态与抽屉不变）；G10 PASS（16 次交替后与基态一致）；
G8 NOT RE-RUN（打开对话框接受路径但未产生文档窗口，沿用 C1B39FA7… 的结论）。

另：关闭 README.md 时按其提示保存了用户缓冲区（707→699 字节），未丢弃。
>>>BODY

## [ENTRY 36] 2026-10-29T17:08:01.191Z sess-blank-gap-r9-r10
sha256: 03479ab1c7d5f6ede2ba26fe09b325c7214938d181e3104ef725d5ebce60d41f
<<<BODY
会话: 空行诊断「空白语义统一（R9）」+「结构化 Markdown 快照契约（R10）」。
改动: document-diagnostic-whitespace-semantics-v1（stripInvisiblePlaceholderChars / isWhitespaceOnlyText）；渲染行与源锚点归一化统一；BOUNDARY_UNRESOLVED 取代 RUNTIME_UNAVAILABLE 兜底；collectDiagnosticsInput 每诊断事务一次 getMarkdownSourceFrom 并携带 structuralVerified / structuralDegradedReason；删除 cachedMarkdown + cachedBlocks + setTimeout(0) 结构缓存。
根因: editor.getMarkdown() 是 Typora 的增量字符镜像（插入字符只让 length 变化，LF / 空白段不变），不能证明结构未变；三处 whitespace 定义不一致会让纯空白行被判成正文 → 区间被拆 → 诊断整体消失。
门禁: tsc PASS；定向 + 全量 PASS；证据 runtime/evidence/blank-gap-r9/、blank-gap-r10-closure/（S04–S13 与 Drawer 真机 PASS，S14 PENDING）。
文档: modules/document-utilities §3「连续空行实时链路收口」；modules/document-diagnostics §4/§10/§14；architecture/identity-presentation-authorities §1。
>>>BODY

## [ENTRY 37] 2026-10-29T17:08:07.289Z sess-blank-gap-realtime
sha256: 13a2a0c01747d03781ed2db8192897f71ff9323d3f4b4345927346808db66e69
<<<BODY
会话: 空行标记实时视觉先行（EXPAND / SHRINK 走局部 patch，SPLIT / MERGE 交回正式诊断）+ 视觉一致性 / 差分复用。
改动: patchActiveGapVisualFromDom + queueBlankFastRecompute / runBlankFastRecompute + activeGapBoundariesAdjacent；commitBlockGapVisual 为单一写者且 owner 只在 appendChild 成功后登记；retireStrayBlockGapCarriers / reconcileBlankRowFragmentEls / upsertBlockGapCountChip 幂等复用；provenanceAction === action 单 reducer；陈旧视觉按事实而非对象身份判定。
根因: carrier 复用判定在 lastBlockGapDiagnosticId = null 之后重复求值恒为 false → 每次重提交都新建 carrier 并叠加 18% 琥珀色带；id 提前登记留下“已画过”的假事实 → 后代丢标、合并不扩张。
已否决: 用视觉 patch 反推“合成脏区间”（不减少工作量）、一帧 rAF 重放滚动、按对象身份判 stale、按几何 scope 继承血缘。
门禁: 定向 / 全量 PASS；实机 carriers=1 / fragment=2 / chip=1、动画 0；SPLIT / MERGE 与 T8 真实 Paint 未测。
文档: modules/document-utilities §3「连续空行实时链路收口」；modules/ui-visual-system（单层填充契约）。
>>>BODY

## [ENTRY 38] 2026-10-29T17:08:14.358Z sess-blank-gap-group-owner
sha256: 941753eacccaca86cce98db02abd3bcfabf41a5db08f64d41a0eef399cb75caa
<<<BODY
会话: 拆合后的组感知 owner（V3）+ 主 Carrier 所有权回落与组投影对账（V4）。
改动: blankFastOwnerResolution 六态（SINGLE_READY / GROUP_READY / REBOUND_PENDING / OWNER_STALE / NO_ACTIVE_INTENT / BOUNDARY_AMBIGUOUS）；data-gap-member / data-gap-identity 成员索引；patchGapGroupMembers 成员级 patch；retireStalePrimaryGapCarrierForGroup 完成 MERGE 原子交接；DIAGNOSTIC_NOT_GAP 回落到 GROUP_READY；paintActiveGapGroupVisuals 由「整组 clearAll + 重建」改为按区间身份对账；reconcileBlankRowFragmentEls 支持 existingOverride 复用 fragment 节点。
根因: 快速入口只认单主 Carrier，SPLIT 后主 Carrier 退役即持续 NO_ACTIVE_OWNER；组投影每键销毁重建，把快速通道刚原位更新过的 DOM 全部丢弃（样式重算 + 布局抖动 + 一帧空窗），是拆合后每键提交成本 restMs 的来源。
门禁: tsc PASS；定向 56/56；全量 4937/4937（263 文件）；build PASS；实机 GROUP_READY 4.0–5.7ms，commit totalMs 18.5–23（本轮未复测时延，不宣称 ≤30ms）。
文档: modules/document-utilities §3；architecture/identity-presentation-authorities §7；roadmap/known-gaps §B。
>>>BODY

## [ENTRY 39] 2026-10-29T17:08:20.545Z sess-pa-wcr2-prompt-consolidation
sha256: edcc117c667821e9a0fc8445ae2b60f97f676b97cd692195c4ab2d38dd7ae76c
<<<BODY
会话: 公式正确性 PA-10–PA-14、WC-R2 导航意图、全项目审计台账统一，以及 pending 提示词一次性整合。
改动: 公式三段匹配（host 身份 + 文档次序 + hash）/ 空公式消耗编号 / 新装默认节内编号 / 渲染失败归还预算并有界重试 ≤3 / 纯 caret 帧不触发全文诊断；NavigatorIntentMachine 单手势单意图 + 字数面板四态避让；PA-01…PA-26 台账改为唯一口径（P1 8 全修、P2 8 修 + 1 candidate、PA-17/18 与 P3 8 项 OPEN）。
文档: modules/formula-numbering §14；modules/document-utilities §2「字数面板避让 + 单手势导航意图」；modules/runtime-audit-and-identity §15（只读 GUI caret 探针 / 21px 视口标定 / TEST_DRIVER_FAILURE 分离）；roadmap/issue-and-error-ledger §7；roadmap/known-gaps §A 公式行口径更正 + §B 新增 9 条残差；docs/prompts/pending 18 份提示词（含 2 份重复副本，共 20 个文件）按 MERGE_THEN_DELETE 移出，目录保留。
>>>BODY
