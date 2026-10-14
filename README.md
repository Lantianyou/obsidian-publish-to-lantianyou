# Publish to lantianyou.com

Obsidian 插件：把当前 note 一键发布到 https://lantianyou.com 。

实现的是 opencode skill `publish-obsidian-to-blog` 的机械部分：

- slug = 源文件名（一字不改），permalink `/<slug>`
- 新建：弹窗询问标题 / description，生成 frontmatter，首页 `docs/README.md` 链接列表顶部插入条目
- 更新：保留原 frontmatter 与 `date`，只更新 `updated` 和正文
- `![[img.png]]` → `![](/images/<slug>-<n>.png)`，更新时若图片数量不变则沿用旧文件名与旧 alt；图片通过 vault 的 metadataCache 解析，复制到 `docs/.vuepress/public/images/`
- 独占一行的裸 URL → `[域名](url)`
- 没有一级标题时补 `# <title>`
- 写入后依次执行构建命令、部署命令（默认 `pnpm build` / `pnpm deploy`，即 wrangler → Cloudflare Pages）

## 使用

命令面板：`Publish current note to lantianyou.com`。

## 与 skill 的差距

skill 由 LLM 完成的润色步骤插件不做：图片的语义命名与中文 alt、description 代拟、
明显标点/OCR 修正。新建文章的 description 在弹窗里由你手写；图片默认 `<slug>-<n>.png`
命名、alt 留空，需要语义化 alt 时发布后在博客仓库里手改一次，之后更新会沿用。

## 开发

```sh
npm install
npm test    # 纯转换逻辑单测（node:test）
npm run build
```

构建产物 `main.js` 手动复制到 vault 的 `.obsidian/plugins/publish-to-lantianyou/`。
桌面专用插件（`isDesktopOnly`，依赖 fs 与 child_process）。

## 设置

- 博客仓库路径（默认 `~/Developer/eai-thoughts`）
- 构建命令 / 部署命令
- 自动构建部署（关闭则只写文件不执行命令）

注意：插件不执行任何 git 操作，部署成功后博客仓库的改动需要你手动 commit。
