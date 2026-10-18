# 首页素材、字体及 AI 贡献

本包仅交付 Qi Mirror 首页。源代码从项目提供的首页设计与后续已检查增量整理，既有品牌、QiSymbol 太极几何和中文字体保持原来源。首页的动画、排版和鼠标反应是展览插画，不是运动测量或临床效果。

## 字体

原始字体二进制和 SIL Open Font License 1.1 文件一同放在 public/fonts 下。英文不依赖电脑安装字体或外部字体 CDN。

- Instrument Serif Regular：Google Fonts commit `0b58fb370093f9a9f4ff785d94405710b79de67c`，见 https://github.com/google/fonts/tree/0b58fb370093f9a9f4ff785d94405710b79de67c/ofl/instrumentserif 。
- Manrope variable：Google Fonts commit `b31870aff700ab7a1d74fa0c6887d95beb9e0037`，见 https://github.com/google/fonts/tree/b31870aff700ab7a1d74fa0c6887d95beb9e0037/ofl/manrope 。保留 FONTLOG、OFL 和 metadata。
- Ma Shan Zheng、LXGW WenKai TC「氣」子集：继承项目已提供的 Google Fonts 来源与许可。完整来源、原始文件与许可证哈希在 public/fonts/qi/source.json；未重新编辑字体。未使用的 Caveat 字体没有打包。

## 水墨和字标

4 个 ink-sculpture-*.webp 材质由项目已有的 image_gen 生成图派生；其中 mist 是基于已选水墨风格生成的透明浅色云墨。WebP 仅为交付编码。5 个 ink-*.png 是对应渲染器的静态降级导出。无新外部图片或视频在本次打包时引入。

ink-mark-shapes.ts 的字形轮廓来自已有 qi-brush-mark.png 和 mirror-brush-word.png 的透明度边界。mirror 原来源记录为 AI 生成书法字标；氣字沿用提供的品牌图形。两张原 PNG 不作为首页运行资源打包。提取方法及原文件 SHA256 在 docs/mark-geometry-provenance.json。运行时仅用矢量轮廓计算遮罩，墨色和交互由着色器生成；这不意味着字形从流体中凭空生成，也不产生新的第三方授权。

## 实际贡献

AI 辅助实现和修订了首页 React/TypeScript/CSS、四章太极阵法、水墨材质渲染、字形矢量转换、有限鼠标响应、暂停/可见性生命周期、原生滚动与白色毛玻璃过渡、可中断锚点导航、字体与响应式排版，以及集成校验和本合并包。

Linear 和 OpenCap 用于排版/滚动观感参考；没有复制其代码、字体、商标或媒体。首页保留插画/无摄像头说明。本包未纳入历史练习视频、研究档案、原始对话、预览模拟数据或任何摄像头数据。
