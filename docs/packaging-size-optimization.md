# Electron 打包体积优化记录

## 背景

本记录整理 CodexFree 在 macOS Electron 打包体积异常后的排查、修复和后续优化边界。

最初问题是 dmg 接近 `1G`，`app.asar` 达到 `3G+`。根因不是 Electron 本体突然变大，
而是 `electron-builder.yml` 的 `files` 只有排除项，没有正向白名单。项目根目录里的
`test/*.har`、历史 `dist` 产物、源码和其它非运行时文件都有机会进入 `app.asar`。
多架构构建时，如果上一轮 `dist/mac` 或 `dist/mac-arm64` 被下一轮重新打进 asar，
体积会继续滚大。

## 当前目标

- macOS app 只支持中文和英文 Electron locale。
- dmg 和 app.asar 不包含 `dist`、`test`、HAR、源码、docs、`.git`。
- 保留现有运行能力：desktop app、daemon、SQLite、本地 HTTP/WSS proxy、direct/http/https/
  socks4/socks5 outbound proxy。
- 不把 `dist` 作为构建前置清理对象，因为 x64 和 arm64 产物都需要保留在 `dist`。
- 本地和 GitHub alpha macOS 构建不签名、不公证。这是当前发布成本约束下的明确策略，
  不是发布阻塞项。

## 官方与本地依据

- `electron-builder` 的 `files` 是包内容选择入口。官方文档说明：一旦自定义包含非
  `!` 开头的 pattern，默认 `**/*` 不会再自动追加；但 `package.json` 和生产
  `node_modules` 仍会参与复制。见：
  <https://www.electron.build/docs/mac/#files>
- `electronLanguages` 用于限制 Electron 保留的 locale。默认保留全部 Electron
  locale。见：
  <https://www.electron.build/docs/mac/#electronlanguages>
- `compression` 支持 `store`、`normal`、`maximum`。官方说明 `maximum` 体积收益通常不
  明显，但构建时间更长。见：
  <https://www.electron.build/docs/mac/#compression>
- `identity: null` 表示 macOS 构建跳过签名。见：
  <https://www.electron.build/docs/mac/#identity>
- Electron Fuses 是包时功能开关，主要用于安全收敛，不是主要体积优化工具。
  `runAsNode` 影响 `ELECTRON_RUN_AS_NODE`；CodexFree daemon 依赖该机制，不能关闭。
  见：<https://www.electronjs.org/docs/latest/tutorial/fuses>
- 当前项目实际使用的 `electron-builder` schema 也在本地确认：
  `node_modules/app-builder-lib/scheme.json`。

## 已落地配置

当前 `electron-builder.yml` 的核心策略：

```yaml
compression: maximum
electronLanguages:
  - en
  - zh_CN
publish: null
files:
  - out/**
  - resources/**
  - package.json
  - "!dist/**"
  - "!test/**"
  - "!**/*.har"
  - "!out/**/*.map"
asarUnpack:
  - node_modules/**/*.node
mac:
  identity: null
  notarize: false
```

关键点：

- 使用正向白名单，只把构建产物、资源和 manifest 放进应用。
- 继续显式排除 `dist/**`，防止多架构构建时旧产物被重新打包。
- 继续显式排除 `test/**` 和 `*.har`，防止大抓包文件进入 asar。
- `resources/**` 保留在 asar 中，不再重复 unpack。
- `publish: null` 防止 `electron-builder` 根据 GitHub metadata 自动生成旧 updater 配置。
- `.node` native module 继续 unpack，保证 `better-sqlite3` 和 Velopack native runtime 可正常加载。
- `build:mac` 使用 `bun electron-builder --mac -c.mac.identity=null`，本地不签名。
- macOS Info.plist 不声明 Camera、Microphone、Documents 或 Downloads 等未使用权限。

## 依赖分层

`electron-builder` 会复制生产 dependencies。之前许多只在 renderer 或 build 阶段使用的包
被放在 `dependencies`，导致它们整包进入 `app.asar`。其中较大的包包括：

| 包 | 原因 | 处理 |
| --- | --- | --- |
| `date-fns` | `react-day-picker` 间接依赖，renderer 已被 Vite bundle | 移到 dev 侧 |
| `lucide-react` | renderer icon 库，已 bundle | 移到 dev 侧 |
| `react` / `react-dom` | renderer runtime，已 bundle | 移到 dev 侧 |
| `@base-ui/react` | renderer UI primitives，已 bundle | 移到 dev 侧 |
| `drizzle-orm` | main/daemon bundle 已内联，运行时不需要整包 | 移到 dev 侧 |
| `tailwindcss` / `@tailwindcss/vite` | build-time CSS 工具 | 移到 dev 侧 |
| `motion` | renderer animation，已 bundle | 移到 dev 侧 |

生产 dependencies 只保留满足以下条件的包：打包后的 `out/main/index.js` 或
`out/daemon/cli.cjs` 仍以 `require(...)` 加载；包含 native binary，需要由
electron-builder 按目标 arch rebuild 或 unpack；updater/logging 等 main runtime 需要在
安装后的 app 中解析。当前核心运行时依赖是 `better-sqlite3`、`electron-log`、
`velopack`、`@electron-toolkit/utils`、`valibot`、`http-proxy-agent`、
`https-proxy-agent` 和 `socks-proxy-agent`。

## outbound proxy 依赖裁剪

之前使用 `proxy-agent`。它支持环境变量和 PAC 等更泛化场景，会把 `pac-proxy-agent`、
`pac-resolver`、`quickjs-wasi` 等依赖带进包。CodexFree UI 当前只暴露 `direct`、`http`、
`https`、`socks4` 和 `socks5`，因此改为按模式创建专用 agent：HTTP upstream 使用
`http-proxy-agent`，HTTPS upstream 使用 `https-proxy-agent`，SOCKS4/SOCKS5 使用
`socks-proxy-agent`。这样保留现有功能，同时移除 PAC/QuickJS 这类未暴露能力。

## 实测结果

验证命令：

```bash
rtk bun run lint
rtk bun run typecheck
rtk bun run test
rtk bun run build
rtk bun run build:mac
```

打包后体积：

| 产物 | 体积 |
| --- | ---: |
| `dist/CodexFree-0.1.0-alpha.0-arm64.dmg` | `112M` |
| `dist/CodexFree-0.1.0-alpha.0-x64.dmg` | `112M` |
| arm64 `app.asar` | `6.6M` |
| x64 `app.asar` | `6.6M` |
| arm64 `app.asar.unpacked` | `31M` |
| x64 `app.asar.unpacked` | `31M` |
| arm64 Electron Framework | `225M` |
| x64 Electron Framework | `224M` |

Electron locale 检查结果只剩 `en.lproj` 和 `zh_CN.lproj`。asar 抽查确认未包含 `/dist`、
`/test`、`/docs`、`/src`、`/.git`、`*.har`，也未包含 `date-fns`、`lucide-react`、
`react`、`react-dom`、`@base-ui`、`drizzle-orm`、`proxy-agent`、`quickjs-wasi`。
接入 Velopack 后，`app.asar.unpacked` 额外包含约 `19M` Velopack native runtime；macOS
bundle 抽查确认没有旧 `app-update.yml`。

packaged daemon smoke 使用 `ELECTRON_RUN_AS_NODE=1` 从 `app.asar` 内执行
`out/daemon/cli.cjs --help`，可以正常输出 `codexfree-daemon` help，说明 daemon 入口和
native module 解析路径未被破坏。

## 不能做或暂不建议做

- 不要在 `build:mac` 前清理 `dist`。多架构构建需要保留 x64 和 arm64 产物。
- 不要关闭 Electron fuse `runAsNode`。daemon 通过 `ELECTRON_RUN_AS_NODE=1` 运行。
- 不建议手动删除 `libvk_swiftshader.dylib`、`libGLESv2.dylib`、`icudtl.dat` 等 Electron/
  Chromium 运行时文件。收益不稳定，容易引入硬件、渲染或系统兼容问题。
- 不建议用 UPX 或类似二进制压缩工具处理 Electron Framework。macOS 签名、Gatekeeper、
  notarization 和安全软件都可能受影响，dmg 压缩后收益也有限。
- 不要把 Developer ID 签名或 Apple notarization 作为当前 alpha 发布前置条件。后续如果
  改为正式商业分发，再单独引入证书、密钥托管和公证流程。
- `compression: maximum` 可以保留，但不要期待它带来数量级变化。数量级收益来自白名单、
  locale 裁剪和生产依赖分层。

## 后续可选优化

1. 启用部分 Electron Fuses。可考虑 `enableNodeOptionsEnvironmentVariable: false`、
   `enableNodeCliInspectArguments: false`、`onlyLoadAppFromAsar: true` 和
   `enableEmbeddedAsarIntegrityValidation: true`。这主要提升安全性，体积收益很小。
2. 用 `onNodeModuleFile` 做更细的 node_modules 过滤。适合发现某个生产依赖带入大量
   docs/tests/examples 时使用，但必须配套 packaged smoke，避免误删 runtime 文件。
3. 继续审核 Velopack 的 platform package 输出。macOS 当前同时上传完整 DMG 和
   `osx-x64`/`osx-arm64` Velopack release feeds；Windows/Linux 由 `win-x64`、`win-arm64`、
   `linux-x64`、`linux-arm64` Velopack release feeds 支持自动更新。Velopack full 包接近
   安装包大小是正常现象；跨版本增量更新依赖同 channel 历史 full 包生成的 delta 包。
4. 长期改用 Utility Process 替代 `ELECTRON_RUN_AS_NODE` daemon。这样未来才可能关闭
   `runAsNode` fuse；这是架构改造，不是单纯体积优化。

## 回归检查清单

每次改 packaging 或 dependencies 后至少检查：

```bash
rtk bun run typecheck
rtk bun run lint
rtk bun run test src/main/proxy/service.test.ts src/main/proxy/config.test.ts
rtk bun run build:mac
```

同时检查 dmg、`app.asar`、`app.asar.unpacked` 体积，以及 Electron Framework 里是否只剩
`en.lproj` 和 `zh_CN.lproj`。

如果 `app.asar` 再次异常变大，优先检查：

- `files` 是否退回了只有排除项；
- 新增 runtime dependency 是否实际只用于 renderer/build；
- `dist/**`、`test/**` 或 `*.har` 是否进入 asar；
- 是否新增了 `extraResources` 或 `asarUnpack` 的重复复制。
