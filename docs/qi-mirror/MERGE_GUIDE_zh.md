# 氣mirror 前端 UI 增量包合并说明

> Historical import guide. Current tooling uses [next.config.mjs](../../next.config.mjs) and the [Playwright configurations](../../config/). Use the npm commands in the [project README](../../README.md) for current setup and checks.

日期：2026-10-18（Asia/Shanghai）。此包交付首页、选关、跟练外观、竹子加载和宣纸弹窗的当前实现，供队友审查并合并到已有 MotionTrial 项目。它不是完整项目、构建产物或数据库备份。

## 基线与包结构

补丁基线为原始 `MotionTrial_Team_20261016.zip`。其中 `HANDOFF_MANIFEST.json` 与本地保留的原清单完全一致，SHA-256：

`8e8e25fd090def5b73fd58cdc6d41b907d18315f9274616f1deb852890a13a89`

增量包含 **55 个项目文件：14 个修改、41 个新增**，原始文件总字节数 **11,223,290**；不包括本地 `STATUS.md`。最终文件、大小和哈希以 `manifest.json` 为准。

- `files/<项目路径>`：55 个文件的当前完整内容，可用于比较和手工合并。
- `changes.patch`：相对上述团队包的完整 Git 补丁，包含 PNG、字体等二进制内容。
- `baseline/<项目路径>`：仅保存14个被修改文件的原始版本，便于三方比较。
- `manifest.json`：包内当前文件及可用的原始文件 SHA-256。
- `requirements.json`：本包没有重复附带、但运行时依赖的原始代码和 public 资源。
- `tools/check-merge.mjs`：纯只读的包完整性检查及目标项目冲突扫描；不会复制、删除或修改目标文件。

`files/` 与 `baseline/` 是两个比较方向：前者是本包结果，后者是原团队基线。不要把 `baseline/` 复制回目标项目。

## 此包提供的功能

- 水墨山水首页、大“氣”及 `mirror` 毛笔图、毛笔笔划开始按钮，开始进入 `/levels`。
- 太极八卦选关轮盘，24关按离散角度停靠，支持滚轮、按钮和关卡条交互；附近指针使关卡墨块放大，数字直接显示在墨块内。常规桌面比例无需上下滚动。
- 轮盘与预览之间的淡灰色中文毛笔大标题随关卡柔和切换；预览保留原视频色彩，停留约2秒后静音播放，已去掉中央 PREVIEW 遮罩与旋转黑线。
- `/enter?form=N` 与跟练内部资源切换复用同款竹子加载页。每次实际准备至少停留1秒；若资源更慢则继续等待，百分比来自实际准备过程，不用假进度代替就绪。无点击墨迹或淡墨特效，加载后自动进入。
- `/practice` 保留分步与完整动作模式，以水墨、纸张、本地字体和太极元素统一外观；视频及骨架辨识色保留。
- 本次页面首次进入第一式且加载结束后显示 **How to play** 和英文说明，点击 **Begin** 后进入待播放状态。它不会启动摄像头，也不会自动开始练习。相同页面内重学或切换小步骤不重复显示；刷新、重新进入或模式重新挂载后可以再次出现。完整动作模式的第一个动作也使用此说明。
- 一式完成后显示 **Congratulations / Restudy / Next**，两个主按钮下方另有 **Back to home**。单击动作先播放纸纹消散，再执行相应操作；Next 进入下一式时仍经过至少1秒竹子加载，最后一式的 Next 返回选关。Restudy 重置当前式，不清空其他式的确认。
- 宣纸弹窗共享650ms柔边展开、520ms消散、原生模态焦点管理、防重复点击和减少动态效果设置。手动 Next 是学习者确认，不能写成模型验证通过；完整动作模式仍由原有真实跟练规则决定匹配结果。

## 建议合并顺序

1. **先保存队友工作和数据。** 在目标项目建立分支或本地备份，记录尚未提交的改动。保留 `data/`、实际 `MOTIONTRIAL_DATA_DIR`、私有视频、环境配置和队友的服务端改动；本包不提供这些内容。
2. 在解压包根目录运行检查。优先使用目标项目已有的兼容 Node 24.x；此包不安装 Node，也不改系统 PATH：

   ```powershell
   node tools/check-merge.mjs "D:\YourProject\MotionTrial"
   ```

   检查目标路径、包内哈希、原始资源要求和冲突报告。缺少基线资源时先找回原团队包，不重新剪辑视频、生成参考姿态或重新下载不同版本的模型来代替。
3. 阅读下面的高冲突说明。Git 项目从**目标项目根目录**先验证补丁，再应用：

   ```powershell
   git apply --check "D:\UnpackedUiPackage\changes.patch"
   git apply "D:\UnpackedUiPackage\changes.patch"
   ```

   **只有第一条无冲突成功后才执行第二条。** 原基线以外的项目应使用 `baseline/`、`files/` 和队友当前版本做三方比较，逐段合并；不要通过强制覆盖或忽略失败的方式应用补丁。没有 Git 的项目也可以按这三个版本手工合并。检查工具是冲突提示，不代表业务语义合并已经正确。
4. 建议依次合入本地素材/字体与共享组件、选关及加载工具、跟练状态转换、首页与复核导航、样式及测试。已有同名新增文件也应比较，不直接覆盖。
5. 合并后在队友项目自行运行类型检查、测试及生产构建，再进行实际页面验收。PowerShell 使用 `npm.cmd`。若项目生产服务正从该目录运行，先核验并妥善停止**本项目**服务或在独立目录构建，避免覆盖正在使用的 `.next`；不要套用包制作者电脑的历史 PID。

## 高冲突文件与必须保留的关系

| 文件/区域 | 合并时应保留的行为 |
| --- | --- |
| `components/TeachingPractice.tsx` | 真实参考读取、相机与模型释放、分步慢放及 held target、手动/可选自动确认仍保留；新增 `instructions` / `form-complete` 状态、当前式进度、加载代际取消和弹窗回调应一起合并。须知和完成弹窗期间不能启动底层自动播放。不要覆盖队友其他跟练修复。 |
| `components/PracticeDemo.tsx` | 完整动作模式仍使用真实 MediaPipe 和既有匹配规则。合入须知、完成选择、1秒加载与取消逻辑时保留计时器、暂停、重试和相机停止流程。 |
| `components/PracticeWorkspace.tsx`、`app/practice/page.tsx` | 同时包含模式选择、纸纹预加载和所有共享样式。页面样式顺序保持 `game-type → landing → enter → practice → practice-ink → practice-completion`，防止字体、模态或加载页失样式。 |
| `app/page.tsx`、`app/review/page.tsx`、`app/layout.tsx` | `/` 现在是游戏封面，原 Queue 工作台移到新增 `/review`；布局中的工作台导航也指向 `/review`。必须同时提供新入口，保留原 Queue 组件、评估、会话详情和 API。不要把原评估功能随首页替换而删除。 |
| `components/CaptureFlow.tsx`、`components/Review.tsx`、`app/about/page.tsx`、`tests/review.spec.ts` | 评估结束、复核返回、删除后导航及相关测试已改到 `/review`。这几处应作为导航补丁合并，保留队友后端、保存、删除授权与数据结构改动。 |
| `lib/practice-display.ts` | `readRecordedAnalysis` 支持预先准备的 Response，同时保留来源视频、模型哈希、尺寸、时长和采样验证。不能删掉这些校验或把保存的参考姿态当作当前摄像头结果。 |
| `lib/lesson-preload.ts`、`lib/use-bamboo-loading.ts`、`lib/form-progress.ts` | 分别负责预取/Blob交接与清理、实际准备和1秒下限、当前式完成与重学范围；它们是必要逻辑，不只是装饰。异步完成后仍需检查任务代际与卸载状态。 |
| `components/PracticePaperDialog.tsx`、`PracticeInstructions.tsx`、`PracticeCompletion.tsx` | 同一纸张壳服务须知和完成弹窗，不能只合入其中一个。原生 dialog、焦点/滚动恢复、520ms动作回调和 reduced motion 需保持同步。 |
| `components/LevelSelection.tsx`、`LevelScrubber.tsx`、`lib/level-selection.ts` | 轮盘、关卡条和离散24关映射一起合入；选择条附近放大不应拦截页面其他按钮。中文标题采用两个有界图层切换，避免快速选择时积累节点。 |
| `tsconfig.json` | 只合并必要的 `exclude: ["node_modules", "artifacts"]` 等差异，不覆盖队友自己的 paths/include 配置，也不关闭 strict 或忽略构建错误。备份源码放在 artifacts 下时必须避免被纳入应用编译。 |

原有 `app/globals.css`、`app/practice/practice.css`、`lib/imitation.ts`、`lib/teaching.ts`、`lib/practice-overlay.ts`、`next.config.ts` 与原交接基线一致，它们属于依赖，不应为本次UI盲目覆盖。布局隐藏规则由 `.qi-landing` / `.practice-page` 的作用域触发；合并到不同外壳时应相应检查，防止在游戏页出现旧侧栏或影响评估页。

镜像仍为**展示层选择**：默认不镜像，勾选 Mirror both views 后，教师视频、相机视频及对应骨架共同翻转；解剖左右和动作比较不交换。不要另加仅相机 `scaleX(-1)`、双重镜像或左右关节替换。当前包不修改原评估的数据采集规则。

## 素材、字体与运行兼容性

- **必须保留原始 public 媒体。** 本包只补充UI素材，不重复附带原311个视频、JSON、参考姿态、MediaPipe模型/WASM、Three.js等大资源。`requirements.json` 列出所需基线；保留字节和路径，不重新制作或清理它们。
- `public/landing-art/` 的山水图为 The Met 的 *Landscape*（佚名，仿夏珪），来源及CC0记录见 `source.json` 和 `docs/QI_MIRROR_ASSETS.md`。不要把作品本身误署名为夏珪真迹。
- 大“氣”、`mirror`、不规则宣纸PNG为此前内置图像生成工具产出的素材，不能沿用山水图的CC0标记；应保留包内附带的各自生成来源记录。用户提供的参考截图并非本包运行素材，无须复制到项目。
- 中文使用项目本地自托管的 Ma Shan Zheng 字体，以及只涵盖传统“氣”字的 WenKai TC 子集。TTF、相应OFL版权许可和来源JSON需一起保留，`unicode-range: U+6C23` 不能移除后当完整中文字体使用。旧 Caveat 已无运行时CSS引用；若保留其文件，也需保留对应OFL。
- 英文 `Bodoni MT` / `Segoe UI` 通过 `local(...)` 使用原部署电脑已安装的字体；本包不分发Windows系统字体。异机缺少时依次回退到CSS已声明的Georgia/Times或Arial等字体，布局可用但字形可能不同。运行时无第三方字体请求，不需要替队友安装或下载字体。
- `package.json`、`package-lock.json` 与基线完全一致，本包不覆盖它们、没有新增npm依赖。运行仍要求Node 24.x，原固定Next 16.4.2/React 19.3.1环境；优先复用项目本地兼容运行时和依赖。
- 保留Node服务模式、`node:sqlite`和服务端文件读取能力；`/enter` 需要读取本地资源大小，不能改成静态导出或serverless部署。默认仅绑定本机127.0.0.1。
- 页面使用桌面Chrome支持的原生dialog、`:has()`、`svh`/`cqi`、CSS mask与Web Animations，低版本或其他浏览器应重新验收。保留减少动态效果设置，不为动画牺牲按钮可用性。

## 验证记录的边界

最近的实际应用验证来自 **2026-10-18 第一关须知发布**（`artifacts/qi-play-instructions-20261018`）：严格类型检查、**83项单元/集成测试**及生产构建通过；实际浏览器验证了须知、Begin、慢放、完成三个选择、Restudy不重复须知、Next的竹子切换，以及桌面和320px排版。原311项资源哈希完整，数据库只读完整性检查正常。具体历史日志与截图由发布记录留存。

**本次制作增量包只验证包内容、哈希、基线与补丁可应用性，没有重新运行应用测试或重新做浏览器/摄像头验收。** 原CLI E2E规格虽已适配须知断言，但最近发布未运行这些摄像头脚本，不能把它们写成通过。预录输入、历史报告和手动确认也不能代表真人跟练匹配。

队友完成合并后应在自己的环境运行检查，并实际确认：封面到选关、24关离散选择/彩色预览、第一关加载后须知、Begin后视频仍待操作、慢放/定格/前后步骤、完成弹窗三按钮、下一式至少1秒加载，以及 `/review` / `/assess/new` / 会话读取入口。相机测试需用户亲自允许权限后进行，不自动保存或上传录像。

`HANDOFF_MANIFEST.json` 是原始快照，合入授权改动后 `team-verify` 出现源码变化属于应报告的事实；不要重写它或清空数据来让旧清单显示通过。本包不运行重置、演示播种或数据迁移。
