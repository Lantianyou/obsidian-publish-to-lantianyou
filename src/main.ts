import {
  App,
  FileSystemAdapter,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
} from "obsidian";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { planPublish, stripFrontmatter } from "./publish";

interface PluginSettings {
  blogPath: string;
  buildCmd: string;
  deployCmd: string;
  autoDeploy: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
  blogPath: "/Users/lantianyou/Developer/eai-thoughts",
  buildCmd: "pnpm build",
  deployCmd: "pnpm deploy",
  autoDeploy: true,
};

const EMBED_RE = /!\[\[([^\]|#]+?)(?:[|#][^\]]*)?\]\]/g;

export default class PublishPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();
    this.addCommand({
      id: "publish-current-note",
      name: "Publish current note to lantianyou.com",
      callback: () => this.publishActiveFile(),
    });
    this.addSettingTab(new PublishSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  async publishActiveFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Publish: 没有打开的 note");
      return;
    }
    const blog = this.settings.blogPath;
    if (!fs.existsSync(path.join(blog, "docs"))) {
      new Notice(`Publish: 博客仓库不存在：${blog}`);
      return;
    }

    const slug = file.basename;
    const raw = await this.app.vault.read(file);
    const sourceBody = stripFrontmatter(raw);
    const cache = this.app.metadataCache.getFileCache(file);
    const sourceTitle = cache?.frontmatter?.title as string | undefined;
    const sourceDescription = cache?.frontmatter?.description as string | undefined;

    // 解析图片 embed → vault 绝对路径
    const imageLinks = [...sourceBody.matchAll(EMBED_RE)].map((m) => m[1].trim());
    const resolved: { link: string; absPath: string }[] = [];
    const missing: string[] = [];
    const adapter = this.app.vault.adapter;
    const basePath =
      adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
    for (const link of imageLinks) {
      const dest = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
      if (dest instanceof TFile && basePath) {
        resolved.push({ link, absPath: path.join(basePath, dest.path) });
      } else {
        missing.push(link);
      }
    }
    if (missing.length > 0) {
      new Notice(`Publish: 找不到图片，已跳过：${missing.join("、")}`);
    }

    // 读博客现有文章
    const postPath = path.join(blog, "docs", `${slug}.md`);
    const existingPost = fs.existsSync(postPath)
      ? fs.readFileSync(postPath, "utf8")
      : null;

    // 新建文章先问 title / description
    let newTitle: string | undefined;
    let newDescription: string | undefined;
    if (existingPost === null) {
      const input = await new NewPostModal(
        this.app,
        sourceTitle ?? slug,
        sourceDescription ?? "",
      ).openAndAwait();
      if (input === null) return; // 用户取消
      newTitle = input.title;
      newDescription = input.description;
    }

    // 纯转换逻辑（缺图的 wikilink 不在 imageLinks 里，原文保留并在上面报告）
    const plan = planPublish({
      slug,
      sourceBody,
      imageLinks: resolved.map((r) => r.link),
      existingPost,
      today: this.today(),
      newTitle,
      newDescription,
    });

    // 复制图片
    const imagesDir = path.join(blog, "docs", ".vuepress", "public", "images");
    fs.mkdirSync(imagesDir, { recursive: true });
    resolved.forEach((img, i) => {
      fs.copyFileSync(img.absPath, path.join(imagesDir, plan.imageNames[i]));
    });

    // 写文章
    fs.writeFileSync(postPath, plan.postContent);

    // 新建时更新首页目录（插在第一个一级标题之后）
    if (plan.readmeEntry) {
      const readmePath = path.join(blog, "docs", "README.md");
      if (fs.existsSync(readmePath)) {
        const readme = fs.readFileSync(readmePath, "utf8");
        if (!readme.includes(`](/${slug})`)) {
          const lines = readme.split("\n");
          const idx = lines.findIndex((l) => l.startsWith("# "));
          if (idx >= 0) {
            lines.splice(idx + 1, 0, "", plan.readmeEntry);
            fs.writeFileSync(readmePath, lines.join("\n"));
          }
        }
      }
    }

    new Notice(
      `Publish: 已写入 docs/${slug}.md（${plan.isNew ? "新建" : "更新"}），开始构建…`,
      8000,
    );

    if (!this.settings.autoDeploy) {
      new Notice(`Publish: 完成（未部署）。发布前记得 git commit 博客仓库。`, 0);
      return;
    }

    // 构建 + 部署：用 login shell 保证 pnpm 在 PATH 里
    const run = (cmd: string) =>
      new Promise<{ ok: boolean; stdout: string }>((res) => {
        exec(
          `/bin/zsh -lc ${JSON.stringify(cmd)}`,
          { cwd: blog, timeout: 600000 },
          (error, stdout, stderr) => {
            res({ ok: !error, stdout: `${stdout}\n${stderr}` });
          },
        );
      });

    const build = await run(this.settings.buildCmd);
    if (!build.ok) {
      new Notice(`Publish: 构建失败，文章已写入但未部署。请看 console`, 0);
      console.error(build.stdout);
      return;
    }
    new Notice("Publish: 构建成功，部署中…", 8000);
    const deploy = await run(this.settings.deployCmd);
    if (!deploy.ok) {
      new Notice(`Publish: 部署失败。请看 console`, 0);
      console.error(deploy.stdout);
      return;
    }
    const preview = deploy.stdout.match(/https:\/\/[a-z0-9-]+\.pages\.dev/);
    new Notice(
      `Publish: 成功 🎉 https://lantianyou.com/${slug}` +
        (preview ? `\n预览：${preview[0]}` : "") +
        `\n博客仓库改动未 commit，记得提交。`,
      0,
    );
  }
}

class NewPostModal extends Modal {
  private title: string;
  private description: string;

  constructor(
    app: App,
    initialTitle: string,
    initialDescription: string,
  ) {
    super(app);
    this.title = initialTitle;
    this.description = initialDescription;
  }

  openAndAwait(): Promise<{ title: string; description: string } | null> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (v: { title: string; description: string } | null) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
        this.close();
      };
      this.onOpen = () => {
        const { contentEl } = this;
        contentEl.createEl("h3", { text: "新建博客文章" });
        new Setting(contentEl)
          .setName("标题")
          .addText((t) =>
            t.setValue(this.title).onChange((v) => (this.title = v)),
          );
        new Setting(contentEl)
          .setName("description")
          .setDesc("一两句话概括全文核心论点（60-120 字）")
          .addTextArea((t) => {
            t.setValue(this.description).onChange((v) => (this.description = v));
            t.inputEl.rows = 3;
          });
        new Setting(contentEl)
          .addButton((b) =>
            b
              .setButtonText("发布")
              .setCta()
              .onClick(() => done({ title: this.title, description: this.description })),
          )
          .addButton((b) => b.setButtonText("取消").onClick(() => done(null)));
      };
      this.onClose = () => done(null);
      this.open();
    });
  }
}

class PublishSettingTab extends PluginSettingTab {
  plugin: PublishPlugin;

  constructor(app: App, plugin: PublishPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("博客仓库路径")
      .setDesc("eai-thoughts 仓库的绝对路径")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.blogPath)
          .onChange(async (v) => {
            this.plugin.settings.blogPath = v;
            await this.plugin.saveSettings();
          }),
      );
    new Setting(containerEl)
      .setName("构建命令")
      .setDesc("写入文章后执行（cwd = 博客仓库）")
      .addText((t) =>
        t.setValue(this.plugin.settings.buildCmd).onChange(async (v) => {
          this.plugin.settings.buildCmd = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl)
      .setName("部署命令")
      .setDesc("构建成功后执行")
      .addText((t) =>
        t.setValue(this.plugin.settings.deployCmd).onChange(async (v) => {
          this.plugin.settings.deployCmd = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(containerEl)
      .setName("自动构建部署")
      .setDesc("关闭后只写入文件，不执行命令")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoDeploy).onChange(async (v) => {
          this.plugin.settings.autoDeploy = v;
          await this.plugin.saveSettings();
        }),
      );
  }
}
