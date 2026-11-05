# AGENTS.md

> 本文件是本仓库的 Agent 入口：只放路由、硬规则和命令索引，不复制专题细节。
> 同一事实只写一处，位置见下方「文档规范」。

## 项目速览

- 目标：用手机浏览器完整操作桌面版 DeepSeek Harness（dsh）——自托管中继 + 桌面插件的
  点对点隧道，不改 dsh 内核与前端。
- 形态：两个独立的 pnpm 包
  - `relay-server/`：公网 VPS 上的中继（配对认证、HTTP 反代、WS 帧桥接、管理台），部署在 TLS 之后。
  - `dsh-remote/`：桌面 dsh host 插件（注册到中继、桥接本地 web server、注入移动适配层、设置页）。
- 技术栈：TypeScript + Node ≥ 22 + pnpm 11 + esbuild；中继无数据库（JSONL 追加），
  插件通过 dsh 的 cordis 插件面注入（`cordis.patch.yml`）。
- 主要入口：`README.md`（系统视图与快速开始）。

## 必读顺序

1. 项目简介与系统视图：`README.md`（英文镜像 `README.en.md`）
2. 协议契约（改帧、握手、鉴权前必读）：`docs/PROTOCOL.md`
3. 组件文档：`relay-server/README.md`、`dsh-remote/README.md`（各有 `.en.md` 镜像）
4. 安全事实：`SECURITY.md`
5. 历史与版本：`CHANGELOG.md`

## 文档规范

- 一个事实只写一处：
  - 安全与信任模型 → `SECURITY.md`（README 与包 README 只留摘要和链接）
  - 帧格式、握手、协议层承诺 → `docs/PROTOCOL.md`
  - 各包的安装、配置、部署命令 → 该包 README
  - 版本历史 → `CHANGELOG.md`
- 中英镜像必须同步修改：`README.md` ↔ `README.en.md`，两个包的 `README.md` ↔ `README.en.md`。
- 不移动现有文档、不新增空文档；新内容放进现有分类（`docs/` 或所属包的 README）。
- 行为、命令、协议、安全边界变化必须同步更新对应文档；只改代码不算完成。

## 硬规则

- 不改 dsh 内核与前端。隧道内的适配只在 `dsh-remote/` 注入：`src/mobile-shim.ts`
  （viewport 提示 + 聊天宽度变量）、`src/host-transport.ts`（`ownsHost` 声明），
  且只对经过插件的 HTML 生效，桌面 / GUI 流量零影响。
- 适配只锚定上游明示的合同（布局 CSS 变量、`window.__DSH_TRANSPORT__`、语义属性），
  不把构建期 hash 类名当锚点。
- 安全事实只写 `SECURITY.md`；日志永不打印 code / challenge / response / token。
- 发布只走 tag：`dsh-remote@<ver>` 或 `relay-server@<ver>`；推送 tag 由
  `.github/workflows/release.yml` 构建并创建 Release，不要手工上传资产。
- `dsh-remote` 把 `@deepseek-ai/dsh` 声明为 peer，`pnpm-workspace.yaml` 的
  `autoInstallPeers: false` 是有意为之：打开会把整个 dsh 依赖树拉进锁文件，并使
  `--frozen-lockfile` 失败。
- 提交格式 `<type>(<scope>): <subject>`；subject 用英文祈使句、小写、不加句号；
  常用 scope：`dsh-remote`、`relay`、`ci`、`docs`。body 用 `-` bullet，末尾单独一段
  `Verified: <执行的验证与结论>`。

## 常用命令

```sh
# 中继：构建、类型门、端到端冒烟（冒烟跑 dist，需先 build）
cd relay-server && pnpm install && pnpm build && pnpm typecheck && pnpm test

# 插件：host 端 + 设置页 client bundle，再打包 tgz
cd dsh-remote && pnpm install && pnpm build && pnpm build:client
cd dsh-remote && pnpm typecheck && pnpm typecheck:client   # 需要本机 deepseek-harness 检出
cd dsh-remote && pnpm pack
```

- 门禁与发布的权威定义：`.github/workflows/ci.yml`、`.github/workflows/release.yml`。
- `dsh-remote` 的 tsconfig 类型映射指向 `../../deepseek-harness`（本机检出），
  因此 CI 只跑构建与 `node --check`，类型检查属本地门。

## 任务与计划

当前没有进行中的任务。出现需要跨轮跟踪的任务或计划时，新建仓库根 `TODO.md`
（当前任务、优先级、验收标准、阻塞原因），并在本文件登记；任务结束后清空或归档。
