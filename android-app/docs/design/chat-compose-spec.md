# Chat 发送与流式：组件＋页面规格（A 刀）

> 流程：Define 路径。方向与 Token 沿用已拍板的 brief（冷静精确/克制/深色优先＋浅色同发）。
> Source of Truth：`ui/theme/Tokens.kt`＋`Theme.kt`；事件词汇以 harness 源码为准
> （`api/session-controller/src/types.ts` 的 follow/page/prompt/cancel，`api/gateway` 的包络与流协议）。

## Discovery Notes（增量）

- 系统现状：有约定成体系雏形——Semantic 双主题、Spacing/Radius/Motion 三档、AppButton/ConnectionBanner 已入库。
- 缺口：聊天页控件仍是页内实现（MessageBubble/ToolCard 单页使用，按准入三问暂不晋升共享，待第二消费方出现再晋升）。
- 冲突记录：无。dsh 第三方文档的老接口名（`session.list` 点分隔）与现行 slash 式冲突，一律以本地 harness 源码裁决。

## 组件规格

### Composer（页内，发送＋取消）

1. Purpose：聊天唯一输入入口；发送文本，运行中转为取消。不做附件/语音。
2. Anatomy：input / action-button（send/stop 二态同位）/ hint。
3. Variants：无（单一样式，语义由状态表达）。
4. Sizes：输入框 min-height 48dp（触控底线），随内容增高至 max 5 行。
5. States：Default（空：send disabled＋hint）/ Ready（有字：send 可点）/ Sending（运行中：stop 可点，input 只读，不断连）/ Disabled（未连接：全灰＋原因 hint）。Loading 不单独存在＝Sending。
6. Content：hint 动词开头；发送按钮 contentDescription“发送/停止生成”（动作非形状）。
7. Spacing：外边距 space-4；按钮与框间距 space-2。
8. Accessibility：input 关联 label；发送/停止是同一热区的语义切换，播报变化。
9. Responsive：键盘弹起时 `adjustResize` 顶起；横屏保持单行＋滚动。
10. Usage：发送空文本/纯空白禁止（按钮 disabled 是唯一防线，不弹 Toast）。

### ReasoningCard（页内，思考过程）

1. Purpose：承载 reasoning-delta 流与收拢后的 reasoning 块；默认收起不抢正文注意力。
2. Anatomy：header（icon＋“已思考”＋字数＋expand-icon）/ body（等宽小字正文）。
3. Variants：live（流式中：header 脉冲态）/ done（收拢：静态）。
4. Sizes：body 最多 8 行，超长内部滚动，不撑爆列表。
5. States：Collapsed（默认）/ Expanded / Live（append 中，自动跟随末尾）/ Empty（无 thinking 时整卡不渲染，不是占位）。
6. Content：header 文案固定“思考过程”，字数 Arabic numerals。
7. Spacing：卡内边距 space-3；与正文间距 space-2。
8. Accessibility：展开按钮播报“展开/收起思考过程”；图标 aria-hidden。
9. Responsive：随列表宽度自适应；字号不跟系统放大崩（sp＋maxLines 约束）。
10. Usage：只用于 reasoning 通道；工具调用另用 ToolCard，不混用。

### StreamingMessage（页内）

1. Purpose：text-delta 的实时落点＋流式光标。
2. Anatomy：body-text / caret（2dp 宽 primary 色竖条，常亮）。
3. States：Streaming（caret 显示）/ Committed（turn/end 后转为普通 Assistant 行，光标消失）。
4. Motion：新文本只淡入（fast），整行入场 fade＋8dp 上浮（base，EasingStandard）；只动 alpha/translationY。
5. Content：纯文本（Markdown 下一刀）；空流不渲染空行。
6. 其余节：同 ReasoningCard 的 6–10（间距/可访问/响应式/用法：光标不是装饰，是“正在生成”的状态指示）。

## 页面规格（聊天页增量）
- Layout：TopAppBar（返回＋标题）/ LazyColumn 时间线 / 底部 Composer；离线横幅插在 AppBar 下。
- 状态机：Loading→Ready；Running（发送后至 turn/end，Composer 切 stop）；Error（红字＋重试，不丢已加载内容）；HostOffline（横幅＋Composer disabled）。
- turn 结束策略：常驻流是唯一正本——committed 消息以事件到达即为准，不做快照重拉；
  只有流中断重连时才用新快照对齐（单一正本原则，避免双写）。
- 回执去重：本地 echo 在流式 user/message 同文到达时撤回，避免双气泡。
- 降级：减动效设置下入场动画退化为直接出现；流式光标保留（状态指示不断）。

## 事件解析契约（以 harness 源码为准，L1）

| 事件 | 取数位置 | App 呈现 |
|---|---|---|
| user/message | `data.content[]`（text 块） | 用户气泡；非 user 来源跳过 |
| assistant/message | `data.message.content[]`（text/reasoning/tool-call 块） | 正文行＋思考卡；tool-call 块跳过（事件另有卡） |
| tool/call | `data.{callId,name,arguments}`（arguments 是 JSON 字符串） | 工具卡头部＋参数区 |
| tool/result | `data.message.{source.callId,content[]}`＋首块 `isError` | 按 callId 并入对应卡片结果区；孤儿结果独立成卡 |
| turn/end | `data.reason.error` | 失败行；无 error 只关运行态 |

subagent 会话必须用 `{kind:subagent, parentSessionId, childSessionId, mode}` 跟随，
mode 先 `continuable`、报 mode 不匹配再试 `one-shot`（各一次，确定性回退）。

## 控制流与排队（v4）

- 聊天页常驻第二条流 `session/control`（`{args:{}}`）：首帧 baseline 的
  `queues[sessionId]`＋后续 queue 增量，`placement=='queued'` 计数显示
  “排队中 · N 条等待执行”。控制流只做展示，断了不致命（follow 负责报错）。
- 铁律：解析层零静默丢弃——`recordsToTimeline` 经 `onSkipped` 上报未识别形状，
  ViewModel 计数进诊断条（`skip=N`）。未知事件先计数、再补解析，不许再出现“凭空消失”。

## Token 增补（无新增）

本刀零新增 token：卡片用 surfaceVariant＋outline，强调色只用 primary（光标/运行态），字用 body/label 两档＋MonoFamily。符合“新增三判定”（都不满足就不加）。

### ToolCard（页内，工具调用＋结果）

1. Purpose：一张卡讲完一次工具调用：头部状态＋参数＋折叠的结果，不跳页。
2. Anatomy：status-icon / name(mono) / status-text / chevron / args 区 / result 区。
3. Variants：running（无结果：默认扳手标）/ success（勾）/ error（红标＋“失败”字样）。
4. States：Collapsed（默认）/ Expanded；Empty（参数结果都空也渲染头部，不消失）。
5. Content：参数为原文 JSON（mono，最多 8 行截断）；结果纯文本最多 12 行；错误结果红色。
6. Spacing：卡内 space-3；参数/结果小节间距 space-2；小节标题用 labelSmall。
7. Accessibility：展开播报“展开/收起＋工具名”；状态图标＋文字双通道（error 有“失败”字样）。
8. Usage：结果由 tool/result 按 callId 并入，不单独成行（孤儿结果除外）。

## 聊天页视觉终版（v3：成品 App 观感）

- 时间线状态行（v2 保留）：`图标(16dp) · 标签 · 摘要(单行截断)`，点击展开等宽详情（缩进 space-6）。
- **Markdown 渲染**（v3）：助手回复走 Markwon（表格/粗体/列表/代码/删除线/链接），
  主题色随深浅自动切换；远程图片默认不加载（隧道内不出网），代码高亮后续刀。
- 用户气泡不对称圆角（靠近输入方向小圆角），对话归属感更强。
- 会话列表 v3：**按工作目录分组**，组头＝文件夹名＋运行数；行去掉卡片底，
  右侧加 chevron，列表页呈“通讯录式”信息结构。
- AppBar：标题＋subagent 副标题（“子代理会话”）；列表行 subagent 前缀“子代理 · ”。
- 通知图标语义：Psychology=思考、Build=调用中、CheckCircle=完成、ErrorOutline=失败；
  颜色不承担唯一区分（标签文字＋红字冗余）。

## QA 清单（真机量化）

- Markdown：表格/粗体/列表/代码块/删除线/链接可点；链接只外开，不执行任何东西。
- 会话分组：按工作目录文件夹分组，组头显示“文件夹名＋N 个运行中”；空目录归“未分组”。
- 触控：发送/停止热区 ≥48dp；会话行整行可点。
- 对比：正文/辅助文两主题 ≥4.5:1（取色实测，非目测）。
- 动效：只动 alpha/translationY；减动效开关联验证。
- 状态：Composer 四态、状态行三态逐项走查；旋转屏幕不丢流（ViewModel 持有）。
- 转灰度：运行中/错误/折叠态仍可区分。

## v4 动效回退（真机验证结论）
- 教训：逐行动画在直播中每来一行播一次，与滚屏动画打架＝闪烁。
- 时间线行改为直接出现；跟随滚屏改瞬时 `scrollToItem`。
- 保留：流式光标（常亮）、按钮 Ripple、展开/收起、发送/停止切换。
  动效预算只花在状态变化上（motion.md：无状态变化不做动效）。

## v5 断线自愈（真机验证结论）

- 根因（L1）：relay 桥接层自身无闲置清理；断线来自对端——host 闪断时
  relay 以 1012 清掉桥接，手机跟随流随之死亡。App 原来只会摆烂等手动重试。
- 跟随流改为 supervisor 自动重连（1s→2s→…→30s 上限封顶），成功快照清零退避；
  横条显示“连接中断 · Ns 后自动重连”＋立即重试按钮。
- 关闭码归因：1012 显示“主机闪断”，其余显示服务端原文；关闭码一并记入诊断条。
  再看到断线，先看归因词——1012 就是桌面/duan 在闪，重装 App 也没用，得治桌面。

## v6 成品质感打磨（参照 CaliBaby 取经但不照搬）

- 取经（特征）：大字层级（一屏一个数字主角）、卡片圆角与留白节奏、
  状态胶囊、一屏一主操作、底部抽屉式操作区、触控目标慷慨。
- 不搬（品类冲突）：暖米色＋高留白消费美学不适合开发者工具聊天；
  已拍板方向（冷静精确/克制/深色优先）维持， concluded in Discovery。
- 落点：正文字阶 14→16sp（bodyLarge，M3 平台字阶，非新 token）；
  输入框 24dp 全圆角＋圆形发送/停止键（停止走 error 色）；
  会话行垂直 12→16dp；状态行/ mono 细节维持桌面密度（ deliberate 反差）。
- 静默集＋3：preset、sandbox/mode、approval/policy（会话配置事件）。
  其中 approval/policy=never 解释了“从无审批卡”——未来会话信息页可展示。

## v7 断线根因与 App 感打磨

- 根因（待真机验证）：OkHttp 的读超时同样作用于闲置 WS，
  60s 无帧即被当断线掐掉——“隔一会断”与之一致。修法：WS 独立客户端
  （读/写超时无限＋25s 应用 ping 保活＋快速失败探测），RPC 保持 60s。
  cookie jar 双端共享，身份不变。验证法：静置 5 分钟不断即定案；
  若仍断，看关闭码归因（1012＝桌面闪断，须重启桌面 dsh）。
- 日期线：User/Assistant/Tool/Reasoning 携带 journal time；
  反向列表中按天分组胶囊（今天/昨天/M月d日）。
- 会话列表：搜索框（标题＋目录）、刷新键、设置入口；行距 16dp。
- 设置页（全真实功能）：中继地址、设备短号、本机移除配对、关于。
  主机在线态无廉价来源，不展示假状态（诚实优先）。
- 配对页脚注：有效期＋信任声明两行小字。
- 模型选择器未做：需新增 RPC，留待有真机联调时再做，不发未验证功能。

## v8 全面视觉重建（ChatGPT review 裁决版）

方向：Linear × Raycast × AI Console；关键词 Minimal / Dense but readable /
Technical / Editorial / Quiet / Precise。Material Demo 感（大卡片/重描边/
随机紫）是头号敌人。

- Token：锌灰中性阶＋鸢尾蓝 primary（90% 界面不用 primary，只用于
  选中/激活/CTA/重要态）；圆角按件收敛 button10/input12/card14/dialog20/
  sheet24；字阶 headline22/title18+16/body16+14+13/label12+11。
- 列表：无卡片扁平行（14semibold标题/12正文元信息/11三级时间）；
  按天分组（今天/昨天/MM-dd，组内保持服务端顺序，可折叠）；
  运行中是唯一 primary 元素（呼吸点＋pill）；草稿纯文字；
  搜索无边框 dock；extended FAB；底部导航（会话＋三个诚实占位）。
- 聊天：表头（返回＋品牌＋标题＋分享）；元信息条（模型 pill，有才显示＋
  实时同步态）；用户气泡 primary＋时间＋回执（echo 时钟/落盘双勾）；
  助手按 ## 分节卡片（蓝绿交替 rail）＋代码卡（含复制）＋表格走 Markwon；
  思考卡显示用时（直播实测）/字数（历史）；工具状态行保留；
  遥测胶囊（ pills＋可展 raw）取代临时诊断条。
- 冲突裁决记录：
  ① 文件夹分组→按天分组（会话是按近度找的；文件夹退为元信息行）；
  ② 蓝纸 M3 Expressive→锌＋鸢尾（90% 规则压倒一切）；
  ③ 参考原型里的 tps/时延/麦克风/附件/自动小节卡片一律不做——无数据源
      或无后端，做出来就是假 UI（见下）。
- 诚实清单（明确不做的）：指标条（无数据源）、语音/附件入口（无后端）、
  作用域下拉（无后端）、自动语义分节（只有 ## 启发式）、模型 pill 取不到时隐藏。

## v9 有 Tab 必须有活（总览/链路实装，遥测砍掉）

- 用户问“总览和链路是干嘛的”——答：之前是空壳，现在每个 Tab 都有真实数据源：
  总览＝一次计时列表探针（主机在线/延迟/总数/运行中/子代理＋新建/去列表）；
  链路＝连接诊断（中继/延迟/配对有效性/会话计数＋重新检测）。
- 遥测砍掉：无数据源，画出来就是假 UI（诚实清单＋1）。
- 参考项目（yukiykchen/mobile）UI 研读结论（只取结构，不取协议——
  它的传输方言在新版 dsh 上 404，逻辑搬不过来）：
  模型选择器弹层、审批/提问行内卡、composer 模型标签、消息原地更新、
  滚动 settle——前三项进入后续刀，后两项已有（反向布局/单源刷新）。
  它家也没有 Fleet/Chains/Telemetry 式空 Tab佐证：没后端的 Tab 不该存在。

## v10 去原生感＋项目分组回归

- 认错：按天分组是本轮最错的决策——找会话按项目，时间只是行内元信息。
  改回按工作目录分组（组头＝目录＋总数＋运行数＋折叠），行内保留相对时间。
- 参考项目视觉研读（yukiykchen/mobile 首页＋连接页源码，L1）：
  纸面 #F7F9FF、白卡＋1px 细线、标题 28 粗、按钮实心小圆角、无底部空 Tab。
  取：细线分隔（行间/顶栏下）、标题层级、小圆角按钮；
  不取：它的蓝（保留鸢尾品牌中性）、SSH 表单（无此功能）。
- 去 M3 原生感：自定义底部 Tab 栏（面＋顶细线＋选中 pill）、顶栏下细线、
  会话行去卡片化已在 v8、配对标题 displaySmall(28)。
- 图标说明：功能图标沿用 Material Symbols（与两家参考一致，行业标准）；
  品牌 mark 为自绘资产；“设计感”来自层级/节奏/分隔，不来自换图标库。

## v11 子代理退场＋标题升级

- 认错：子代理是后台工人，不是会话——却和用户对话混排。
  改：主列表只留普通会话；子代理收进底部“子代理会话 · N”默认折叠区
  （打开方式不变，之前做的 durable parent 寻址继续有效）。
- 标题 14→16sp（titleSmall），与两家参考的行标题对齐。
- 图标终审：DeepSeek 官方 App 截图为证——汉堡/加号/麦克风/箭头/点赞
  全是系统 glyph；Material Symbols 定版不再讨论。
  “设计感”继续由层级/节奏/分隔承担。

## v12 配对签名＋运行态身份

- 配对页换 6 格码（输入递进/退格回退/粘贴填满），成品配对页签名动作；
  标题 28＋品牌 64dp＋脚注信任声明。
- 运行中的行给 45% primary 底色——列表扫一眼就知道谁在干活，
  比小圆点更快（圆点保留做冗余）。
- 空态文案指向 FAB 新建，不再把用户推回桌面。
