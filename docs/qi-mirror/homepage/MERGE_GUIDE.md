# 首页合并指南

## 接入方式

首页入口是 `source/app/page.tsx`，它导出默认 React 组件及 Next.js `metadata`。整个首页由 HomeMotion 提供 `.qi-landing.qi-home` 容器，内含封面、太极体验、练习方式、文化说明四个场景。

Next.js App Router 项目：将 `source/` 下的 app、components 合并到项目 app/components 或 src/app/src/components；使 `@/*` 别名指向对应源码根。保留已有 RootLayout、providers、全局样式和依赖版本。页面本身不需要新增动画库、图标库或 Tailwind 插件。`next/link`、React 和 Next Metadata 由宿主提供。

Vite / React Router 等项目：保留首页组件和样式，把 `next/link` 替换为现有路由 Link 或普通 `<a>`；移除 `page.tsx` 的 Next Metadata 类型与导出，将 Home 挂到现有首页路由，并配置 `@/*`。本包没有包含预览的 Next 兼容层或假接口，不能把它作为完整独立工程直接 npm install/start。

`integration/landing-base.css` 是原有最小 reset 的参考副本。若主项目已有全局 reset，优先复用；缺少时再合并等价规则。它有 body、元素和 reduced-motion 全局规则，不能无审查地覆盖整个站点。`integration/layout.example.tsx` 仅示意导入位置，不要替换已有根布局。

## 样式顺序和页面容器

保留 `page.tsx` 中的导入顺序：home-story → home-exhibit → home-stage → home-practice → home-ink → home-unified → home-experience-entrance → home-identity。home-story 还引用 game-type.css，HomeWheelStory 引用 home-formation.css。后置 identity 样式负责最终衬线标题和无衬线正文，不要用旧的 landing.css 覆盖它。

首页使用页面原生滚动、sticky、svh/cqw、容器查询和 backdrop-filter。不要把首页放在另一个固定高度的 overflow:auto 容器中，不要为上层容器额外加 transform/overflow:hidden，也不要再套一层滚动劫持或强制 scroll-snap。正常布局流总计四个场景。暂停或减少动态效果时，使用清晰的普通滚动。

home-story.css 开头有仅在出现 `.qi-home` 时隐藏旧 `.sidebar`、`.topbar`、旧页脚和展示菜单的兼容规则。如果主项目结构不同，按实际壳层调整这些规则。固定导航已经在首页内部，避免重复添加导航。

## 链接对接

| 页面内容 | 当前目标 | 合并要求 |
| --- | --- | --- |
| 品牌 | `/` | 主项目首页 |
| Explore the forms / 24 forms | `/levels` | 接到组员实现的动作库 |
| 分步练习 | `/practice?mode=guided&form=1` | 接到现有分步入口 |
| 完整练习 | `/practice?mode=forms&routine=original24` | 接到现有完整练习入口 |
| See how it works、顶部导航 | `#experience` / `#idea` | 保留 HomeScrollLink 平滑旅程和焦点管理 |

替换宿主路由时检查 page.tsx 和 HomePracticeStudio.tsx。首页不提供动作库、摄像头、评分或后端实现；这四章是交互插画，没有视频播放或身体数据。

## 素材和字体

全部资源使用根路径 `/landing-art/` 和 `/fonts/`，应由同一站点提供。不要只复制 TSX/CSS。若站点部署在子路径，需统一调整这些 URL 与框架 basePath；保持文件路径一致。

英文字体随站点加载：Instrument Serif 标题、Manrope 正文和控件；中文沿用 Ma Shan Zheng 和仅含「氣」的 WenKai 子集。保留每个字体的 OFL 许可和来源记录。game-type.css 中有历史本机字体回退，但最终英文样式已由 home-identity.css 覆盖，不依赖电脑安装 Bodoni 或 Segoe。

首页书法字标由 ink-mark-shapes.ts 的矢量轮廓生成内存遮罩，墨色、肌理和响应在 WebGL 中计算。WebGL 不可用时用内联 SVG；其他水墨材质使用包内 PNG 降级。4 个 WebP 是生成的静态材质加实时渲染，不是完整流体求解器。

## 已验证范围和合并后验收

本次源文件与本地已运行版本逐字节校验一致。该版本已通过 TypeScript、Vite 构建及隔离 Edge 浏览器检查。衬线版覆盖过 1920×1080、1287×1084、1280×600、768×1024、390×844、320×568；最新水墨收敛增量通过鼠标响应/精确回位、暂停/恢复、减少动态效果、隐藏/离屏停止检查，并在实际静态服务上复验。Next 主项目构建、真实手机和设备帧率需由接收方在自己的宿主验证。

合并后检查：首页与手机窄屏不溢出；英文自托管字体加载；四章可切换；See how it works 顺着玻璃过渡滚下去，反向滚动恢复；鼠标字形不大幅扭曲、停手后安定；暂停和减少动态效果可用；刷新 #experience、浏览器返回和练习入口正确。保留既有静态降级路径。

构建提示：当前预览主 JS 约 531 kB（gzip 约 158 kB），包含其他预览页面，不能据此当作本包单页性能指标；源包没有强制宿主拆包方式。现有预览构建的 Next 指令和 sourcemap 提示来自 Vite 兼容运行，不表示已完成目标 Next 工程验证。
