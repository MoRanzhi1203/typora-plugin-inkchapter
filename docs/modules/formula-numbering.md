# Formula Numbering（公式编号权威链）

> 本页整合 Phase 6.0R–7R.3.9R（提示词 13–34）的耐久结论。核心主线：**canonical heading snapshot → 共享对象语义作用域 → 公式语义计划 → 投影仲裁（单权威）→ transient 渲染计划 → 原子发布 → 精确可见验证**。旧的 `FORMULA-BASELINE.md` 记录 R5→R60 已废弃架构，本节禁止恢复旧架构。

## §1 权威链总览

```
CanonicalHeadingFrame（stableIdentity + semanticState.physicalLevel）
→ resolvePrecedingSemanticHeading（最近前置 canonical heading 身份）
→ 有效作用域（GLOBAL / CHAPTER / SECTION，含 strict H1 边界）
→ 公式序号（objectKind 独立计数）
→ canonical preset formatter → rawNumber（如 5.3-1）
→ 投影仲裁（FormulaProjectionController，单权威）
→ transient 渲染计划（MathJax hook 单稳定包装 + live context）
→ 原子发布 → 精确可见验证
```

- **Formula 必须复用 Phase 6 resolver**，不得复制标题收集/compareDocumentPosition/排除规则/语义角色映射，不得 fork resolver。
- 三关注点分离：stableIdentity（元数据/渲染生命周期，不编码序号权威）、semantic scope（只来自 snapshot+resolver）、ordinal（按当前逻辑文档序重算，旧可见数字不是权威）。
- `formula:${ordinal}` ≠ stableIdentity，仅为运行时序诊断键。
- **NO-SNAPSHOT 硬规则**：无快照/上下文不匹配/resolver 未就绪 → DEFER 语义投影、writes=0，不得空号、`()`、旧 DOM fallback、临时 global。

## §2 业务目标发现与基数（Phase 7R / 7R.1）

- **1 个逻辑公式 → 1 个 canonical 业务目标**；渲染产物（MJX-CONTAINER/SVG/mjx-assistive-mml/MathJax 后代）可作投影目标但**绝不进业务目标/序号序列**。
- 业务选择器 `FORMULA_LOGICAL_HOST_SELECTOR='.md-math-block'`（`div.mathjax-block.md-math-block.md-rawblock` 业务宿主）；旧 `MATH_HOST_SELECTOR` 不得作业务权威。
- 目标基数在 MathJax 生命周期全程稳定（渲染前/中/后恒等）；去重禁止用"TeX 文本相同/渲染编号相同/当前序号/数组下标"，必须用 DOM 包含关系与 canonical host ownership。
- renderer-not-ready → **DEFER**（writes=0）而非破坏性 BLOCK；渲染器出现后经既有信号自动 reconcile，禁点击/聚焦修复。
- 基数诊断文档感知化：生产标记只报观察事实（logicalFormulaHostCount/canonicalFormulaTargetCount/...），"expected" 侧需独立权威，否则 `NOT_APPLICABLE`；禁止把 fixture 数字硬编码进生产。

## §3 语义规划（Phase 7 迁移 / 7R.6）

- 公式语义解析显式化：`BOUND / LEGITIMATE_CHAPTER_FALLBACK / LEGITIMATE_GLOBAL_FALLBACK / TRANSIENT_UNRESOLVED`；临时解析器失效**禁止静默降级 GLOBAL**（会闪 `(1)(2)`）。
- 脱机构建候选（带 provenance），发布前复核 live 值。
- 原子发布：仅当候选 COMPLETE（doc 当前、epoch 不变、provenance 一致、每 host 有终解、无 TRANSIENT_UNRESOLVED、host 集匹配）才整体 swap；不完整则保留上一 COMPLETE 集 + writes=0 + 事件驱动至多一次跟进；planSetEpoch 仅在原子发布时递增。
- 公式计数器独立于 figure/table/code；进入新 section/chapter 按 preset 重置；global 连续；startAt 作用于 `{n}`；minDigits 只 pad `{n}`。

## §4 投影仲裁与单投影权威（Phase 7R.2 / 7R.2A1 / 7R.3）

- **一个公式只有一个可见投影权威**；标准模式禁止 `span.inkchapter-formula-number`。
- 策略分离：`FormulaSemanticPlan → FormulaProjectionArbitrator → 单一投影权威`（typora-native / inkchapter-native-transient / defer / explicit-user-tag-preserved）。
- `nativeNumberFound=false` **不代表** Typora 无可见原生号（检测器盲区）；拆 `NATIVE_NODE_DETECTED` 与 `TYPORA_NATIVE_NUMBER_VISIBLY_PRESENT`。
- 通过 transient `\tag{rawNumber}`（或证实的原生等价 seam）注入渲染输入；**不写回 Markdown**（before==after、不建 undo 条目）；用户显式 `\tag{X}` 保留（`EXPLICIT_USER_TAG_PRESERVED`）。
- 禁止全局 `File.option.autoNumberingForMath=false` 作为方案；临时抑制必须限定单次渲染事务、finally 恢复、异常安全、不跨公式/文档泄漏。
- **禁止假修复**：CSS 掩盖/位移/z-index/透明、setInterval 轮询偏好、程序化改全局偏好。
- 诊断代码纪律（7R.2A1）：`safeElementClassName()`（SVG `className` 可为 `SVGAnimatedString`）；forensic 三性 = READ-ONLY / NON-THROWING / NON-BLOCKING（`FORENSIC_FAILURE_BLOCKS_FORMULA_RECONCILE=false`）。

## §5 transient 渲染执行（Phase 7R.3.1 / 7R.3.2）

- 执行阶梯：PROJECTION-POLICY → HOOK-CALL → PLAN-LOOKUP(MATCHED) → INJECT → DELEGATE → OUTPUT(SEMANTIC_TAG_PRESENT) → COMMIT → VERIFY；缺一环即阻塞。
- **hook 单稳定包装 + LIVE CONTEXT PROVIDER**：安装一次（`MATHJAX_HOOK_INSTALLATION_COUNT=1`），安装不拥有文档身份；**每次 tex2svgPromise/tex2svg 调用重新 getLiveContext()**（安装时闭包会冻结 documentKey → 跨 revision/文档切换 DOCUMENT_MISMATCH）。
- 计划创建**不要求**渲染器就绪：PRE-RENDER 就绪（document/snapshot/host/source/desiredNumber/mode）与 POST-RENDER 就绪（渲染器存在/提交/验证）分离；`RENDERER_NOT_READY` 只意味 `PLAN_READY_BUT_OUTPUT_NOT_YET_RENDERED`。
- 语义投影签名：documentKey + host + sourceHash + rawNumber + projectionAuthority（host 是主身份，非字符串序数）；snapshot revision 仅 provenance（`REVISION_DRIFT_SEMANTIC_EQUIVALENT_ACCEPTED`），文档不一致永远拒绝。
- 源匹配归一化仅允许 CRLF→LF、trim 外层空白等有证据的步骤；重复源 → AMBIGUOUS 拒绝，禁止按 ordinal/最近公式猜测。
- 受控重渲染：目标精确逻辑公式、走 Typora 既有 per-block seam（`File.editor.mathBlock.renderUnder(blockElement, true)`）；禁止全局 `MathJax.typesetPromise(document)`、删全部 mjx、setInterval、合成点击。
- 错过首次渲染竞态：一次性受控恢复（`MAX_CONTROLLED_RECOVERY_RENDER=1`），per-host 状态机 idle→plan-ready→render-requested→rendering→committed。
- 静态事实：MathJax 显式 `\tag` 使 `currentTag.tag=X`，autoTag 仅在 tag==null 时生成 → ALL/AMS/OFF 下 transient `\tag` 均产出恰一个语义号。

## §6 动态重投影与精确验证（Phase 7R.3.3）

- 每 host 四状态：currentPlanned / lastInjected / lastCommitted / lastRenderRequested，全部按签名作用域；旧签名证据绝不证明新签名。
- 先全量逻辑重算 → 完整新 plan set → 与旧 diff → **受影响集** → 发布 → 仅对受影响既有 host 定向渲染；禁止逐公式交错"计算+渲染"。
- 一次性渲染预算按 `host + signatureHash` 键控（不是 host-only / planGeneration / revision）。
- **精确可见验证**：`extractVisibleFormulaTagTokens()` 读 MathJax 可见 tag；归一化仅限 trim、去一层外层括号、NBSP；`observedRawTag === expectedRawNumber` 严格相等（expected=1-1 遇 observed=1.1-1 必须 FAIL）；禁止 `text.includes(rawNumber)` 子串验证。
- 语义变化顺序：新完整 set 发布 → live hook 指向新 set → 旧证据失效 → 定向渲染 → hook 消费新计划（先发布后渲染，禁止反序）。

## §7 初始打开性能（Phase 7R.3.4）

- 单一协调器调度权威 `requestNumberingReconcile({reason, invalidation, documentEpoch, documentKey})`；多原因合并为一次执行（微任务/rAF）；`MAX_CONCURRENT_RECONCILE_EXECUTION=1`；执行中事件标 rerunNeeded 至多一次跟进；DOM 写前检查 epoch/key 过期则 `ABORT_STALE_TRANSACTION`。
- 语义指纹（只含影响编号的语义字段，排除 revision/调试串）+ 对象结构指纹 → 早期语义 no-op 门；**revision 变化不算变化证据**。
- 自变更边界：插件自身 DOM 变更（heading 装饰/caption/MathJax tag commit/outline/工具栏）不得回流成语义/结构失效。
- 每 reconcile 一次只读绑定会话：canonical heading 绑定收集一次，多目标文档序单次前向扫描 O(H+O)。
- MathJax hook 生命周期 UNINITIALIZED→WAITING_FOR_MATHJAX→INSTALLED；稳定态不重入安装路径。
- 性能目标：`OPEN_TO_STABLE ≤700ms`（硬 ≤1000ms）、一次稳定打开 reconcile 执行 ≤2；禁"隐藏延迟"式修复（全文档 opacity:0、等 1s、禁用 MathJax、全局关自动编号）。

## §8 激活模型与原子快照（Phase 7R.3.6）

- 语义签名（WHAT 应可见）与执行激活（WHICH 事务是当前的）分离：per-host `FormulaProjectionActivation`（activationId 单调、signatureHash、previousSignatureHash、state、rerenderAttemptCount、planSetEpoch、editorStructureEpoch）。
- 签名变化（即使 A→B→A）必须新 activationId；同签名重复 reconcile 复用激活；预算权威 = host+activationId（`MAX_CONTROLLED_RERENDER_PER_ACTIVATION=1`）；**历史签名非门控**。
- `editorStructureEpoch`：仅在真实源/业务结构变化时递增（heading 增删改级、公式逻辑宿主增删、文档切换）；MathJax 输出/装饰/outline/选择不递增。
- 异步守卫：transient plan 携带 planSetEpoch/activationId/signatureHash，lookup→inject→delegate→output→commit 全程同一身份；过期输出 `STALE_ACTIVATION_COMMIT_IGNORED`。
- 持久提交状态：lastCommittedActivationId/SignatureHash/RawNumber/PlanSetEpoch；可见已精确但元数据丢失时仅全部条件满足 `ADOPTED_EXISTING_SEMANTIC_OUTPUT`。

## §9 严格 H1 边界与共享作用域（Phase 7R.3.7）

- 严格 H1 双属性：`counted=false` + `opensNumberingBoundary=true`；新 H1 重置 H2/H3/更深计数、切断前结构祖先；`STRICT-FIRST-H1` 校验 ≠ 只允许一个 H1。
- `SemanticHeadingNumberState.strictBoundaryIdentity`（= 最近 H1 stableIdentity；strictBoundaryOrdinal 仅诊断不进可见编号）。
- 缺失层不造零：`STRICT_VISIBLE_ZERO_FILL_COUNT=0`，禁 1.0.1/0.1/1.0；缺父时抑制子级数字前缀而非压缩/替换层级。
- 共享 `ObjectSemanticScopeIdentity`；scopeKey：GLOBAL=kind+boundary+GLOBAL、CHAPTER=kind+boundary+chapterIdentity、SECTION=kind+boundary+chapter+sectionIdentity；strict GLOBAL 是 **H1 边界内局部**。
- 投影签名加入边界 provenance：Boundary A 1-1 ≠ Boundary B 1-1；边界变化但 raw 相同 → 新激活/新 provenance。
- Figure/Table/Code 复用公式解析合同：`CANDIDATE_IDENTITY_MISSING → TRANSIENT_UNRESOLVED → DEFER`（禁止→GLOBAL）。

## §10 稳定性 / 诊断纪律（Phase 7R.3.8）

- heading 语义指纹（每 heading 文档序：stableIdentity/physicalLevel/effectiveDepth/semanticRole/各级 ordinal/结构 identity/strictBoundaryIdentity/counted…）确定性；指纹未变 → 不递增 revision、不通知、不调度（`SEMANTIC_NOOP_REVISION_ADVANCE_COUNT=0`）。
- 语义状态与渲染器修复分离：heading DOM 重建允许渲染器修复，不得伪造新语义 revision。
- 边界审计压缩：normal 模式每次语义提交只发一条 `STRICT-NUMBERING-BOUNDARY-SUMMARY`；失败日志按 lastReportedFailureSignature 去重。
- 禁止硬编码 fixture 数字（33/55/4）进生产；禁止删除基数检查迁就错误。

## §11 Caption 热循环关闭与规范 Heading Frame（Phase 7R.3.9）

- 删除基于时间的延迟轮询（`CAPTION_DEFER_TIMER_POLLING_COUNT=0`）；`CaptionReconcileStateToken`（documentKey+editorStructureEpoch+heading 语义指纹+frame 指纹+target 指纹+settings 签名；无时间戳/尝试计数）。
- 瞬态失败状态机：IDLE → 首次瞬态失败 FOLLOW_UP_ALLOWED（至多一次合并跟进）→ 同 token 同失败签名复现 **PARK**；PARK 不自唤醒，仅真实权威变化唤醒；热循环熔断作安全网。
- 失败分类：身份类在单次跟进后仍不变 → `CANONICAL_INVARIANT_FAILURE`（保留上一完整集、PARK、一条定向 forensic）。
- **规范 heading frame 权威**：一次收集 + 一次 stableIdentity 分配 + 语义状态与 DOM 绑定同身份；frame 提交前校验 epoch/计数/身份集一致（semantic==binding==canonicalEntry）；Caption 用 `resolvePrecedingHeading(target, frame)` 返回 entry 本身，不得独立重收集。
- 34-vs-33 取证分类：多收集/漏收集/同 heading 不同身份/DOM 变化/重复身份/隐藏瞬态，先证后断。

## §12 启动时序与权威门禁（Phase 7R.3.9R）

- 分离 `AUTHORITY_NOT_READY` 与 `POST-READY TRANSIENT_UNRESOLVED`；显式状态机 NO_DOCUMENT / WAITING_FOR_DOCUMENT_CONTEXT / WAITING_FOR_HEADING_AUTHORITY / READY。
- READY 判据：文档上下文业务就绪 + captionDocumentKey==active + 已提交 CanonicalHeadingFrame 且 frame.documentKey==active 且为当前已提交帧；**空帧（entries=[]，合法无标题文档）也 READY**；禁止用 headingCount==0 或 snapshotRevision>=0 当就绪代理。
- 权威就绪前早期门：在 collectTargets/resolver batch/plan 构建/重试机之前；只记录合并 pending intent（latest wins）；`PREAUTH_*` 计数全 0。
- 唤醒事件 = CanonicalHeadingFrame COMMITTED；先订阅再回读当前 frame 防 missed-wakeup 竞态；文档切换立即失效 A 权威状态/pending/重试，A 旧 plan 不得作 B 语义回退。

## §13 贯穿性纪律

- 真实制品激活验证（SHA 闭环）才能验收语义；vault-only 启动（禁直接打开 .md）；禁止全局 Typora 设置变更；禁止源文本改写；禁止时间轮询/防抖修正确性；Git 只在真实 Runtime 证明后提交。
