//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let obsidian = require("obsidian");
let fs = require("fs");
fs = __toESM(fs, 1);
let path = require("path");
path = __toESM(path, 1);
let child_process = require("child_process");
//#region src/publish.ts
var FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
/** 从全文剥掉 frontmatter，返回正文 */
function stripFrontmatter(raw) {
	const m = raw.match(FRONTMATTER_RE);
	return m ? raw.slice(m[0].length).replace(/^\n+/, "") : raw;
}
function parsePost(raw) {
	const m = raw.match(FRONTMATTER_RE);
	if (!m) return {
		frontmatter: "",
		body: raw
	};
	return {
		frontmatter: m[1],
		body: raw.slice(m[0].length)
	};
}
function parseFlatYaml(fm) {
	const out = {};
	for (const line of fm.split("\n")) {
		const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
		if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
	}
	return out;
}
function replaceUpdated(frontmatter, today) {
	if (/^updated:/m.test(frontmatter)) return frontmatter.replace(/^updated:.*$/m, `updated: "${today}"`);
	return `${frontmatter.trimEnd()}\nupdated: "${today}"`;
}
/** 沿用旧图的判定：旧正文里的图片引用按顺序解析 */
function existingImageRefs(body, slug) {
	const refs = [];
	const re = /!\[([^\]]*)\]\(\/images\/([^\s)]+)\)/g;
	let m;
	while ((m = re.exec(body)) !== null) if (m[2].startsWith(`${slug}-`)) refs.push({
		alt: m[1],
		name: m[2]
	});
	return refs;
}
/** 独占一行的裸 URL → [域名](url)（去掉 www. 前缀） */
function linkifyBareUrls(body) {
	return body.split("\n").map((line) => {
		const t = line.trim();
		if (!/^https?:\/\/\S+$/.test(t)) return line;
		let host = t.replace(/^https?:\/\//, "").split("/")[0];
		host = host.replace(/^www\./, "");
		return `[${host}](${t})`;
	}).join("\n");
}
function planPublish(input) {
	const { slug, sourceBody, imageLinks, existingPost, today } = input;
	const isNew = existingPost === null;
	let frontmatter;
	let title;
	if (isNew) {
		title = (input.newTitle ?? "").trim() || slug;
		const description = (input.newDescription ?? "").trim();
		frontmatter = [
			"---",
			`title: ${title}`,
			`description: ${description}`,
			`date: "${today}"`,
			`updated: "${today}"`,
			`permalink: /${slug}`,
			"---"
		].join("\n");
	} else {
		const parsed = parsePost(existingPost);
		title = parseFlatYaml(parsed.frontmatter).title ?? slug;
		frontmatter = `---\n${replaceUpdated(parsed.frontmatter, today)}\n---`;
	}
	const imageNames = [];
	const imageAlts = [];
	const oldRefs = isNew ? [] : existingImageRefs(parsePost(existingPost).body, slug);
	const reuse = oldRefs.length === imageLinks.length && imageLinks.length > 0;
	imageLinks.forEach((_, i) => {
		if (reuse) {
			imageAlts.push(oldRefs[i].alt);
			imageNames.push(oldRefs[i].name);
		} else {
			imageAlts.push("");
			imageNames.push(`${slug}-${i + 1}.png`);
		}
	});
	let body = linkifyBareUrls(sourceBody.trim());
	imageLinks.forEach((link, i) => {
		body = body.replace(`![[${link}]]`, `![${imageAlts[i]}](/images/${imageNames[i]})`);
	});
	if (!/^# [^\n]/m.test(body)) body = `# ${title}\n\n${body}`;
	const postContent = `${frontmatter}\n\n${body.trimEnd()}\n`;
	return {
		isNew,
		title,
		postContent,
		imageNames,
		imageAlts,
		readmeEntry: isNew ? `- [${title}](/${slug})` : null
	};
}
//#endregion
//#region src/main.ts
var DEFAULT_SETTINGS = {
	blogPath: "/Users/lantianyou/Developer/eai-thoughts",
	buildCmd: "pnpm build",
	deployCmd: "pnpm deploy",
	autoDeploy: true
};
var EMBED_RE = /!\[\[([^\]|#]+?)(?:[|#][^\]]*)?\]\]/g;
var PublishPlugin = class extends obsidian.Plugin {
	constructor(..._args) {
		super(..._args);
		this.settings = DEFAULT_SETTINGS;
	}
	async onload() {
		await this.loadSettings();
		this.addCommand({
			id: "publish-current-note",
			name: "Publish current note to lantianyou.com",
			callback: () => this.publishActiveFile()
		});
		this.addSettingTab(new PublishSettingTab(this.app, this));
	}
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}
	async saveSettings() {
		await this.saveData(this.settings);
	}
	today() {
		return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
	}
	async publishActiveFile() {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new obsidian.Notice("Publish: 没有打开的 note");
			return;
		}
		const blog = this.settings.blogPath;
		if (!fs.existsSync(path.join(blog, "docs"))) {
			new obsidian.Notice(`Publish: 博客仓库不存在：${blog}`);
			return;
		}
		const slug = file.basename;
		const sourceBody = stripFrontmatter(await this.app.vault.read(file));
		const cache = this.app.metadataCache.getFileCache(file);
		const sourceTitle = cache?.frontmatter?.title;
		const sourceDescription = cache?.frontmatter?.description;
		const imageLinks = [...sourceBody.matchAll(EMBED_RE)].map((m) => m[1].trim());
		const resolved = [];
		const missing = [];
		const adapter = this.app.vault.adapter;
		const basePath = adapter instanceof obsidian.FileSystemAdapter ? adapter.getBasePath() : null;
		for (const link of imageLinks) {
			const dest = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
			if (dest instanceof obsidian.TFile && basePath) resolved.push({
				link,
				absPath: path.join(basePath, dest.path)
			});
			else missing.push(link);
		}
		if (missing.length > 0) new obsidian.Notice(`Publish: 找不到图片，已跳过：${missing.join("、")}`);
		const postPath = path.join(blog, "docs", `${slug}.md`);
		const existingPost = fs.existsSync(postPath) ? fs.readFileSync(postPath, "utf8") : null;
		let newTitle;
		let newDescription;
		if (existingPost === null) {
			const input = await new NewPostModal(this.app, sourceTitle ?? slug, sourceDescription ?? "").openAndAwait();
			if (input === null) return;
			newTitle = input.title;
			newDescription = input.description;
		}
		const plan = planPublish({
			slug,
			sourceBody,
			imageLinks: resolved.map((r) => r.link),
			existingPost,
			today: this.today(),
			newTitle,
			newDescription
		});
		const imagesDir = path.join(blog, "docs", ".vuepress", "public", "images");
		fs.mkdirSync(imagesDir, { recursive: true });
		resolved.forEach((img, i) => {
			fs.copyFileSync(img.absPath, path.join(imagesDir, plan.imageNames[i]));
		});
		fs.writeFileSync(postPath, plan.postContent);
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
		new obsidian.Notice(`Publish: 已写入 docs/${slug}.md（${plan.isNew ? "新建" : "更新"}），开始构建…`, 8e3);
		if (!this.settings.autoDeploy) {
			new obsidian.Notice(`Publish: 完成（未部署）。发布前记得 git commit 博客仓库。`, 0);
			return;
		}
		const run = (cmd) => new Promise((res) => {
			(0, child_process.exec)(`/bin/zsh -lc ${JSON.stringify(cmd)}`, {
				cwd: blog,
				timeout: 6e5
			}, (error, stdout, stderr) => {
				res({
					ok: !error,
					stdout: `${stdout}\n${stderr}`
				});
			});
		});
		const build = await run(this.settings.buildCmd);
		if (!build.ok) {
			new obsidian.Notice(`Publish: 构建失败，文章已写入但未部署。请看 console`, 0);
			console.error(build.stdout);
			return;
		}
		new obsidian.Notice("Publish: 构建成功，部署中…", 8e3);
		const deploy = await run(this.settings.deployCmd);
		if (!deploy.ok) {
			new obsidian.Notice(`Publish: 部署失败。请看 console`, 0);
			console.error(deploy.stdout);
			return;
		}
		const preview = deploy.stdout.match(/https:\/\/[a-z0-9-]+\.pages\.dev/);
		new obsidian.Notice(`Publish: 成功 🎉 https://lantianyou.com/${slug}` + (preview ? `\n预览：${preview[0]}` : "") + `\n博客仓库改动未 commit，记得提交。`, 0);
	}
};
var NewPostModal = class extends obsidian.Modal {
	constructor(app, initialTitle, initialDescription) {
		super(app);
		this.title = initialTitle;
		this.description = initialDescription;
	}
	openAndAwait() {
		return new Promise((resolve) => {
			let settled = false;
			const done = (v) => {
				if (!settled) {
					settled = true;
					resolve(v);
				}
				this.close();
			};
			this.onOpen = () => {
				const { contentEl } = this;
				contentEl.createEl("h3", { text: "新建博客文章" });
				new obsidian.Setting(contentEl).setName("标题").addText((t) => t.setValue(this.title).onChange((v) => this.title = v));
				new obsidian.Setting(contentEl).setName("description").setDesc("一两句话概括全文核心论点（60-120 字）").addTextArea((t) => {
					t.setValue(this.description).onChange((v) => this.description = v);
					t.inputEl.rows = 3;
				});
				new obsidian.Setting(contentEl).addButton((b) => b.setButtonText("发布").setCta().onClick(() => done({
					title: this.title,
					description: this.description
				}))).addButton((b) => b.setButtonText("取消").onClick(() => done(null)));
			};
			this.onClose = () => done(null);
			this.open();
		});
	}
};
var PublishSettingTab = class extends obsidian.PluginSettingTab {
	constructor(app, plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}
	display() {
		const { containerEl } = this;
		containerEl.empty();
		new obsidian.Setting(containerEl).setName("博客仓库路径").setDesc("eai-thoughts 仓库的绝对路径").addText((t) => t.setValue(this.plugin.settings.blogPath).onChange(async (v) => {
			this.plugin.settings.blogPath = v;
			await this.plugin.saveSettings();
		}));
		new obsidian.Setting(containerEl).setName("构建命令").setDesc("写入文章后执行（cwd = 博客仓库）").addText((t) => t.setValue(this.plugin.settings.buildCmd).onChange(async (v) => {
			this.plugin.settings.buildCmd = v;
			await this.plugin.saveSettings();
		}));
		new obsidian.Setting(containerEl).setName("部署命令").setDesc("构建成功后执行").addText((t) => t.setValue(this.plugin.settings.deployCmd).onChange(async (v) => {
			this.plugin.settings.deployCmd = v;
			await this.plugin.saveSettings();
		}));
		new obsidian.Setting(containerEl).setName("自动构建部署").setDesc("关闭后只写入文件，不执行命令").addToggle((t) => t.setValue(this.plugin.settings.autoDeploy).onChange(async (v) => {
			this.plugin.settings.autoDeploy = v;
			await this.plugin.saveSettings();
		}));
	}
};
//#endregion
module.exports = PublishPlugin;

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsIm5hbWVzIjpbIlBsdWdpbiIsIk5vdGljZSIsIkZpbGVTeXN0ZW1BZGFwdGVyIiwiVEZpbGUiLCJNb2RhbCIsIlNldHRpbmciLCJQbHVnaW5TZXR0aW5nVGFiIl0sInNvdXJjZXMiOlsiLi4vc3JjL3B1Ymxpc2gudHMiLCIuLi9zcmMvbWFpbi50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIOWPkeW4g+a1geeoi+eahOe6r+i9rOaNoumAu+i+ke+8iOS4jeS+nei1liBPYnNpZGlhbiBBUEnvvIzlj6/ljZXmtYvvvInjgIJcbiAqIOinhOWImeS4jiBvcGVuY29kZSBza2lsbOOAjHB1Ymxpc2gtb2JzaWRpYW4tdG8tYmxvZ+OAjeS4gOiHtO+8mlxuICogLSBzbHVnID0g5rqQ5paH5Lu25ZCN77yI5LiA5a2X5LiN5pS577yJXG4gKiAtIOabtOaWsO+8muS/neeVmeWOnyBmcm9udG1hdHRlcu+8jOWPquaUuSB1cGRhdGVk77yb5paw5bu677ya55Sf5oiQ5qih5p2/IGZyb250bWF0dGVyXG4gKiAtICFbW2ltZ11dIOKGkiAhW2FsdF0oL2ltYWdlcy88c2x1Zz4tPG4+LnBuZynvvIzmm7TmlrDml7boi6Xlm77niYfmlbDph4/kuI3lj5jliJnmsr/nlKjml6flkI3kuI7ml6cgYWx0XG4gKiAtIOeLrOWNoOS4gOihjOeahOijuCBVUkwg4oaSIFvln5/lkI1dKHVybClcbiAqIC0g5rKh5pyJ5LiA57qn5qCH6aKY5pe26KGlIGAjIDx0aXRsZT5gXG4gKi9cblxuZXhwb3J0IGludGVyZmFjZSBQdWJsaXNoUGxhbklucHV0IHtcbiAgLyoqIOa6kOaWh+S7tuWQjeWOu+aJqeWxleWQje+8jOWNsyBzbHVnIC8gcGVybWFsaW5rICovXG4gIHNsdWc6IHN0cmluZztcbiAgLyoqIOa6kOato+aWh++8iGZyb250bWF0dGVyIOW3suWJpeemu++8iSAqL1xuICBzb3VyY2VCb2R5OiBzdHJpbmc7XG4gIC8qKiDmraPmlofkuK3mjInlh7rnjrDpobrluo/mjpLliJfnmoTlm77niYcgd2lraWxpbmvvvIjkuI3lkKsgISDlkowgW1tdXe+8iSAqL1xuICBpbWFnZUxpbmtzOiBzdHJpbmdbXTtcbiAgLyoqIOWNmuWuoueOsOacieaWh+eroOWFqOaWh++8m251bGwg6KGo56S65paw5bu6ICovXG4gIGV4aXN0aW5nUG9zdDogc3RyaW5nIHwgbnVsbDtcbiAgLyoqIOW9k+WkqeaXpeacnyBZWVlZLU1NLUREICovXG4gIHRvZGF5OiBzdHJpbmc7XG4gIC8qKiDku4XmlrDlu7rml7blv4XloavvvJrmlofnq6DmoIfpopggKi9cbiAgbmV3VGl0bGU/OiBzdHJpbmc7XG4gIC8qKiDku4XmlrDlu7rml7blv4XloavvvJpkZXNjcmlwdGlvbiAqL1xuICBuZXdEZXNjcmlwdGlvbj86IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBQdWJsaXNoUGxhbiB7XG4gIGlzTmV3OiBib29sZWFuO1xuICB0aXRsZTogc3RyaW5nO1xuICAvKiog5YaZ5YWlICRCTE9HL2RvY3MvPHNsdWc+Lm1kIOeahOWujOaVtOWGheWuuSAqL1xuICBwb3N0Q29udGVudDogc3RyaW5nO1xuICAvKiog5LiOIGltYWdlTGlua3Mg5LiA5LiA5a+55bqU55qEIHB1YmxpYy9pbWFnZXMvIOS4i+eahOaWh+S7tuWQjSAqL1xuICBpbWFnZU5hbWVzOiBzdHJpbmdbXTtcbiAgLyoqIOS4jiBpbWFnZUxpbmtzIOS4gOS4gOWvueW6lOeahCBhbHQg5paH5pysICovXG4gIGltYWdlQWx0czogc3RyaW5nW107XG4gIC8qKiDmlrDlu7rml7bopoHmj5LliLDpppbpobXpk77mjqXliJfooajnmoTkuIDooYzvvJvmm7TmlrDml7bkuLogbnVsbCAqL1xuICByZWFkbWVFbnRyeTogc3RyaW5nIHwgbnVsbDtcbn1cblxuY29uc3QgRlJPTlRNQVRURVJfUkUgPSAvXi0tLVxcbihbXFxzXFxTXSo/KVxcbi0tLVxcbj8vO1xuXG4vKiog5LuO5YWo5paH5Yml5o6JIGZyb250bWF0dGVy77yM6L+U5Zue5q2j5paHICovXG5leHBvcnQgZnVuY3Rpb24gc3RyaXBGcm9udG1hdHRlcihyYXc6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG0gPSByYXcubWF0Y2goRlJPTlRNQVRURVJfUkUpO1xuICByZXR1cm4gbSA/IHJhdy5zbGljZShtWzBdLmxlbmd0aCkucmVwbGFjZSgvXlxcbisvLCBcIlwiKSA6IHJhdztcbn1cblxuaW50ZXJmYWNlIFBhcnNlZFBvc3Qge1xuICBmcm9udG1hdHRlcjogc3RyaW5nO1xuICBib2R5OiBzdHJpbmc7XG59XG5cbmZ1bmN0aW9uIHBhcnNlUG9zdChyYXc6IHN0cmluZyk6IFBhcnNlZFBvc3Qge1xuICBjb25zdCBtID0gcmF3Lm1hdGNoKEZST05UTUFUVEVSX1JFKTtcbiAgaWYgKCFtKSByZXR1cm4geyBmcm9udG1hdHRlcjogXCJcIiwgYm9keTogcmF3IH07XG4gIHJldHVybiB7IGZyb250bWF0dGVyOiBtWzFdLCBib2R5OiByYXcuc2xpY2UobVswXS5sZW5ndGgpIH07XG59XG5cbmZ1bmN0aW9uIHBhcnNlRmxhdFlhbWwoZm06IHN0cmluZyk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICBjb25zdCBvdXQ6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgZm9yIChjb25zdCBsaW5lIG9mIGZtLnNwbGl0KFwiXFxuXCIpKSB7XG4gICAgY29uc3QgbSA9IGxpbmUubWF0Y2goL14oXFx3W1xcdy1dKik6XFxzKiguKikkLyk7XG4gICAgaWYgKG0pIG91dFttWzFdXSA9IG1bMl0ucmVwbGFjZSgvXlwiKC4qKVwiJC8sIFwiJDFcIik7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuZnVuY3Rpb24gcmVwbGFjZVVwZGF0ZWQoZnJvbnRtYXR0ZXI6IHN0cmluZywgdG9kYXk6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICgvXnVwZGF0ZWQ6L20udGVzdChmcm9udG1hdHRlcikpIHtcbiAgICByZXR1cm4gZnJvbnRtYXR0ZXIucmVwbGFjZSgvXnVwZGF0ZWQ6LiokL20sIGB1cGRhdGVkOiBcIiR7dG9kYXl9XCJgKTtcbiAgfVxuICByZXR1cm4gYCR7ZnJvbnRtYXR0ZXIudHJpbUVuZCgpfVxcbnVwZGF0ZWQ6IFwiJHt0b2RheX1cImA7XG59XG5cbi8qKiDmsr/nlKjml6flm77nmoTliKTlrprvvJrml6fmraPmlofph4znmoTlm77niYflvJXnlKjmjInpobrluo/op6PmnpAgKi9cbmZ1bmN0aW9uIGV4aXN0aW5nSW1hZ2VSZWZzKGJvZHk6IHN0cmluZywgc2x1Zzogc3RyaW5nKTogeyBhbHQ6IHN0cmluZzsgbmFtZTogc3RyaW5nIH1bXSB7XG4gIGNvbnN0IHJlZnM6IHsgYWx0OiBzdHJpbmc7IG5hbWU6IHN0cmluZyB9W10gPSBbXTtcbiAgY29uc3QgcmUgPSAvIVxcWyhbXlxcXV0qKVxcXVxcKFxcL2ltYWdlc1xcLyhbXlxccyldKylcXCkvZztcbiAgbGV0IG06IFJlZ0V4cEV4ZWNBcnJheSB8IG51bGw7XG4gIHdoaWxlICgobSA9IHJlLmV4ZWMoYm9keSkpICE9PSBudWxsKSB7XG4gICAgaWYgKG1bMl0uc3RhcnRzV2l0aChgJHtzbHVnfS1gKSkgcmVmcy5wdXNoKHsgYWx0OiBtWzFdLCBuYW1lOiBtWzJdIH0pO1xuICB9XG4gIHJldHVybiByZWZzO1xufVxuXG4vKiog54us5Y2g5LiA6KGM55qE6KO4IFVSTCDihpIgW+Wfn+WQjV0odXJsKe+8iOWOu+aOiSB3d3cuIOWJjee8gO+8iSAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxpbmtpZnlCYXJlVXJscyhib2R5OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYm9keVxuICAgIC5zcGxpdChcIlxcblwiKVxuICAgIC5tYXAoKGxpbmUpID0+IHtcbiAgICAgIGNvbnN0IHQgPSBsaW5lLnRyaW0oKTtcbiAgICAgIGlmICghL15odHRwcz86XFwvXFwvXFxTKyQvLnRlc3QodCkpIHJldHVybiBsaW5lO1xuICAgICAgbGV0IGhvc3QgPSB0LnJlcGxhY2UoL15odHRwcz86XFwvXFwvLywgXCJcIikuc3BsaXQoXCIvXCIpWzBdO1xuICAgICAgaG9zdCA9IGhvc3QucmVwbGFjZSgvXnd3d1xcLi8sIFwiXCIpO1xuICAgICAgcmV0dXJuIGBbJHtob3N0fV0oJHt0fSlgO1xuICAgIH0pXG4gICAgLmpvaW4oXCJcXG5cIik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwbGFuUHVibGlzaChpbnB1dDogUHVibGlzaFBsYW5JbnB1dCk6IFB1Ymxpc2hQbGFuIHtcbiAgY29uc3QgeyBzbHVnLCBzb3VyY2VCb2R5LCBpbWFnZUxpbmtzLCBleGlzdGluZ1Bvc3QsIHRvZGF5IH0gPSBpbnB1dDtcbiAgY29uc3QgaXNOZXcgPSBleGlzdGluZ1Bvc3QgPT09IG51bGw7XG5cbiAgLy8gLS0tLSDmoIfpopjkuI4gZnJvbnRtYXR0ZXIgLS0tLVxuICBsZXQgZnJvbnRtYXR0ZXI6IHN0cmluZztcbiAgbGV0IHRpdGxlOiBzdHJpbmc7XG4gIGlmIChpc05ldykge1xuICAgIHRpdGxlID0gKGlucHV0Lm5ld1RpdGxlID8/IFwiXCIpLnRyaW0oKSB8fCBzbHVnO1xuICAgIGNvbnN0IGRlc2NyaXB0aW9uID0gKGlucHV0Lm5ld0Rlc2NyaXB0aW9uID8/IFwiXCIpLnRyaW0oKTtcbiAgICBmcm9udG1hdHRlciA9IFtcbiAgICAgIFwiLS0tXCIsXG4gICAgICBgdGl0bGU6ICR7dGl0bGV9YCxcbiAgICAgIGBkZXNjcmlwdGlvbjogJHtkZXNjcmlwdGlvbn1gLFxuICAgICAgYGRhdGU6IFwiJHt0b2RheX1cImAsXG4gICAgICBgdXBkYXRlZDogXCIke3RvZGF5fVwiYCxcbiAgICAgIGBwZXJtYWxpbms6IC8ke3NsdWd9YCxcbiAgICAgIFwiLS0tXCIsXG4gICAgXS5qb2luKFwiXFxuXCIpO1xuICB9IGVsc2Uge1xuICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlUG9zdChleGlzdGluZ1Bvc3QgYXMgc3RyaW5nKTtcbiAgICBjb25zdCBtZXRhID0gcGFyc2VGbGF0WWFtbChwYXJzZWQuZnJvbnRtYXR0ZXIpO1xuICAgIHRpdGxlID0gbWV0YS50aXRsZSA/PyBzbHVnO1xuICAgIGZyb250bWF0dGVyID0gYC0tLVxcbiR7cmVwbGFjZVVwZGF0ZWQocGFyc2VkLmZyb250bWF0dGVyLCB0b2RheSl9XFxuLS0tYDtcbiAgfVxuXG4gIC8vIC0tLS0g5Zu+54mH5ZG95ZCNIC0tLS1cbiAgY29uc3QgaW1hZ2VOYW1lczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgaW1hZ2VBbHRzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBvbGRSZWZzID0gaXNOZXdcbiAgICA/IFtdXG4gICAgOiBleGlzdGluZ0ltYWdlUmVmcyhwYXJzZVBvc3QoZXhpc3RpbmdQb3N0IGFzIHN0cmluZykuYm9keSwgc2x1Zyk7XG4gIGNvbnN0IHJldXNlID0gb2xkUmVmcy5sZW5ndGggPT09IGltYWdlTGlua3MubGVuZ3RoICYmIGltYWdlTGlua3MubGVuZ3RoID4gMDtcbiAgaW1hZ2VMaW5rcy5mb3JFYWNoKChfLCBpKSA9PiB7XG4gICAgaWYgKHJldXNlKSB7XG4gICAgICBpbWFnZUFsdHMucHVzaChvbGRSZWZzW2ldLmFsdCk7XG4gICAgICBpbWFnZU5hbWVzLnB1c2gob2xkUmVmc1tpXS5uYW1lKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaW1hZ2VBbHRzLnB1c2goXCJcIik7XG4gICAgICBpbWFnZU5hbWVzLnB1c2goYCR7c2x1Z30tJHtpICsgMX0ucG5nYCk7XG4gICAgfVxuICB9KTtcblxuICAvLyAtLS0tIOato+aWh+i9rOaNoiAtLS0tXG4gIGxldCBib2R5ID0gbGlua2lmeUJhcmVVcmxzKHNvdXJjZUJvZHkudHJpbSgpKTtcbiAgaW1hZ2VMaW5rcy5mb3JFYWNoKChsaW5rLCBpKSA9PiB7XG4gICAgLy8g5q+P5qyh5Y+q5pu/5o2i56ys5LiA5Liq5Yy56YWN77yM5L+d5oyB6aG65bqP5a+55bqUXG4gICAgYm9keSA9IGJvZHkucmVwbGFjZShgIVtbJHtsaW5rfV1dYCwgYCFbJHtpbWFnZUFsdHNbaV19XSgvaW1hZ2VzLyR7aW1hZ2VOYW1lc1tpXX0pYCk7XG4gIH0pO1xuICBpZiAoIS9eIyBbXlxcbl0vbS50ZXN0KGJvZHkpKSB7XG4gICAgYm9keSA9IGAjICR7dGl0bGV9XFxuXFxuJHtib2R5fWA7XG4gIH1cblxuICBjb25zdCBwb3N0Q29udGVudCA9IGAke2Zyb250bWF0dGVyfVxcblxcbiR7Ym9keS50cmltRW5kKCl9XFxuYDtcblxuICByZXR1cm4ge1xuICAgIGlzTmV3LFxuICAgIHRpdGxlLFxuICAgIHBvc3RDb250ZW50LFxuICAgIGltYWdlTmFtZXMsXG4gICAgaW1hZ2VBbHRzLFxuICAgIHJlYWRtZUVudHJ5OiBpc05ldyA/IGAtIFske3RpdGxlfV0oLyR7c2x1Z30pYCA6IG51bGwsXG4gIH07XG59XG4iLCJpbXBvcnQge1xuICBBcHAsXG4gIEZpbGVTeXN0ZW1BZGFwdGVyLFxuICBNb2RhbCxcbiAgTm90aWNlLFxuICBQbHVnaW4sXG4gIFBsdWdpblNldHRpbmdUYWIsXG4gIFNldHRpbmcsXG4gIFRGaWxlLFxufSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCAqIGFzIGZzIGZyb20gXCJmc1wiO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgZXhlYyB9IGZyb20gXCJjaGlsZF9wcm9jZXNzXCI7XG5pbXBvcnQgeyBwbGFuUHVibGlzaCwgc3RyaXBGcm9udG1hdHRlciB9IGZyb20gXCIuL3B1Ymxpc2hcIjtcblxuaW50ZXJmYWNlIFBsdWdpblNldHRpbmdzIHtcbiAgYmxvZ1BhdGg6IHN0cmluZztcbiAgYnVpbGRDbWQ6IHN0cmluZztcbiAgZGVwbG95Q21kOiBzdHJpbmc7XG4gIGF1dG9EZXBsb3k6IGJvb2xlYW47XG59XG5cbmNvbnN0IERFRkFVTFRfU0VUVElOR1M6IFBsdWdpblNldHRpbmdzID0ge1xuICBibG9nUGF0aDogXCIvVXNlcnMvbGFudGlhbnlvdS9EZXZlbG9wZXIvZWFpLXRob3VnaHRzXCIsXG4gIGJ1aWxkQ21kOiBcInBucG0gYnVpbGRcIixcbiAgZGVwbG95Q21kOiBcInBucG0gZGVwbG95XCIsXG4gIGF1dG9EZXBsb3k6IHRydWUsXG59O1xuXG5jb25zdCBFTUJFRF9SRSA9IC8hXFxbXFxbKFteXFxdfCNdKz8pKD86W3wjXVteXFxdXSopP1xcXVxcXS9nO1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBQdWJsaXNoUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgc2V0dGluZ3M6IFBsdWdpblNldHRpbmdzID0gREVGQVVMVF9TRVRUSU5HUztcblxuICBhc3luYyBvbmxvYWQoKSB7XG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwicHVibGlzaC1jdXJyZW50LW5vdGVcIixcbiAgICAgIG5hbWU6IFwiUHVibGlzaCBjdXJyZW50IG5vdGUgdG8gbGFudGlhbnlvdS5jb21cIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLnB1Ymxpc2hBY3RpdmVGaWxlKCksXG4gICAgfSk7XG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBQdWJsaXNoU2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xuICB9XG5cbiAgYXN5bmMgbG9hZFNldHRpbmdzKCkge1xuICAgIHRoaXMuc2V0dGluZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NFVFRJTkdTLCBhd2FpdCB0aGlzLmxvYWREYXRhKCkpO1xuICB9XG5cbiAgYXN5bmMgc2F2ZVNldHRpbmdzKCkge1xuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEodGhpcy5zZXR0aW5ncyk7XG4gIH1cblxuICBwcml2YXRlIHRvZGF5KCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gIH1cblxuICBhc3luYyBwdWJsaXNoQWN0aXZlRmlsZSgpIHtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICBpZiAoIWZpbGUpIHtcbiAgICAgIG5ldyBOb3RpY2UoXCJQdWJsaXNoOiDmsqHmnInmiZPlvIDnmoQgbm90ZVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgYmxvZyA9IHRoaXMuc2V0dGluZ3MuYmxvZ1BhdGg7XG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKHBhdGguam9pbihibG9nLCBcImRvY3NcIikpKSB7XG4gICAgICBuZXcgTm90aWNlKGBQdWJsaXNoOiDljZrlrqLku5PlupPkuI3lrZjlnKjvvJoke2Jsb2d9YCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgc2x1ZyA9IGZpbGUuYmFzZW5hbWU7XG4gICAgY29uc3QgcmF3ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcbiAgICBjb25zdCBzb3VyY2VCb2R5ID0gc3RyaXBGcm9udG1hdHRlcihyYXcpO1xuICAgIGNvbnN0IGNhY2hlID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk7XG4gICAgY29uc3Qgc291cmNlVGl0bGUgPSBjYWNoZT8uZnJvbnRtYXR0ZXI/LnRpdGxlIGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICBjb25zdCBzb3VyY2VEZXNjcmlwdGlvbiA9IGNhY2hlPy5mcm9udG1hdHRlcj8uZGVzY3JpcHRpb24gYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG4gICAgLy8g6Kej5p6Q5Zu+54mHIGVtYmVkIOKGkiB2YXVsdCDnu53lr7not6/lvoRcbiAgICBjb25zdCBpbWFnZUxpbmtzID0gWy4uLnNvdXJjZUJvZHkubWF0Y2hBbGwoRU1CRURfUkUpXS5tYXAoKG0pID0+IG1bMV0udHJpbSgpKTtcbiAgICBjb25zdCByZXNvbHZlZDogeyBsaW5rOiBzdHJpbmc7IGFic1BhdGg6IHN0cmluZyB9W10gPSBbXTtcbiAgICBjb25zdCBtaXNzaW5nOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IGFkYXB0ZXIgPSB0aGlzLmFwcC52YXVsdC5hZGFwdGVyO1xuICAgIGNvbnN0IGJhc2VQYXRoID1cbiAgICAgIGFkYXB0ZXIgaW5zdGFuY2VvZiBGaWxlU3lzdGVtQWRhcHRlciA/IGFkYXB0ZXIuZ2V0QmFzZVBhdGgoKSA6IG51bGw7XG4gICAgZm9yIChjb25zdCBsaW5rIG9mIGltYWdlTGlua3MpIHtcbiAgICAgIGNvbnN0IGRlc3QgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpcnN0TGlua3BhdGhEZXN0KGxpbmssIGZpbGUucGF0aCk7XG4gICAgICBpZiAoZGVzdCBpbnN0YW5jZW9mIFRGaWxlICYmIGJhc2VQYXRoKSB7XG4gICAgICAgIHJlc29sdmVkLnB1c2goeyBsaW5rLCBhYnNQYXRoOiBwYXRoLmpvaW4oYmFzZVBhdGgsIGRlc3QucGF0aCkgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBtaXNzaW5nLnB1c2gobGluayk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChtaXNzaW5nLmxlbmd0aCA+IDApIHtcbiAgICAgIG5ldyBOb3RpY2UoYFB1Ymxpc2g6IOaJvuS4jeWIsOWbvueJh++8jOW3sui3s+i/h++8miR7bWlzc2luZy5qb2luKFwi44CBXCIpfWApO1xuICAgIH1cblxuICAgIC8vIOivu+WNmuWuoueOsOacieaWh+eroFxuICAgIGNvbnN0IHBvc3RQYXRoID0gcGF0aC5qb2luKGJsb2csIFwiZG9jc1wiLCBgJHtzbHVnfS5tZGApO1xuICAgIGNvbnN0IGV4aXN0aW5nUG9zdCA9IGZzLmV4aXN0c1N5bmMocG9zdFBhdGgpXG4gICAgICA/IGZzLnJlYWRGaWxlU3luYyhwb3N0UGF0aCwgXCJ1dGY4XCIpXG4gICAgICA6IG51bGw7XG5cbiAgICAvLyDmlrDlu7rmlofnq6DlhYjpl64gdGl0bGUgLyBkZXNjcmlwdGlvblxuICAgIGxldCBuZXdUaXRsZTogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgIGxldCBuZXdEZXNjcmlwdGlvbjogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgIGlmIChleGlzdGluZ1Bvc3QgPT09IG51bGwpIHtcbiAgICAgIGNvbnN0IGlucHV0ID0gYXdhaXQgbmV3IE5ld1Bvc3RNb2RhbChcbiAgICAgICAgdGhpcy5hcHAsXG4gICAgICAgIHNvdXJjZVRpdGxlID8/IHNsdWcsXG4gICAgICAgIHNvdXJjZURlc2NyaXB0aW9uID8/IFwiXCIsXG4gICAgICApLm9wZW5BbmRBd2FpdCgpO1xuICAgICAgaWYgKGlucHV0ID09PSBudWxsKSByZXR1cm47IC8vIOeUqOaIt+WPlua2iFxuICAgICAgbmV3VGl0bGUgPSBpbnB1dC50aXRsZTtcbiAgICAgIG5ld0Rlc2NyaXB0aW9uID0gaW5wdXQuZGVzY3JpcHRpb247XG4gICAgfVxuXG4gICAgLy8g57qv6L2s5o2i6YC76L6R77yI57y65Zu+55qEIHdpa2lsaW5rIOS4jeWcqCBpbWFnZUxpbmtzIOmHjO+8jOWOn+aWh+S/neeVmeW5tuWcqOS4iumdouaKpeWRiu+8iVxuICAgIGNvbnN0IHBsYW4gPSBwbGFuUHVibGlzaCh7XG4gICAgICBzbHVnLFxuICAgICAgc291cmNlQm9keSxcbiAgICAgIGltYWdlTGlua3M6IHJlc29sdmVkLm1hcCgocikgPT4gci5saW5rKSxcbiAgICAgIGV4aXN0aW5nUG9zdCxcbiAgICAgIHRvZGF5OiB0aGlzLnRvZGF5KCksXG4gICAgICBuZXdUaXRsZSxcbiAgICAgIG5ld0Rlc2NyaXB0aW9uLFxuICAgIH0pO1xuXG4gICAgLy8g5aSN5Yi25Zu+54mHXG4gICAgY29uc3QgaW1hZ2VzRGlyID0gcGF0aC5qb2luKGJsb2csIFwiZG9jc1wiLCBcIi52dWVwcmVzc1wiLCBcInB1YmxpY1wiLCBcImltYWdlc1wiKTtcbiAgICBmcy5ta2RpclN5bmMoaW1hZ2VzRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICByZXNvbHZlZC5mb3JFYWNoKChpbWcsIGkpID0+IHtcbiAgICAgIGZzLmNvcHlGaWxlU3luYyhpbWcuYWJzUGF0aCwgcGF0aC5qb2luKGltYWdlc0RpciwgcGxhbi5pbWFnZU5hbWVzW2ldKSk7XG4gICAgfSk7XG5cbiAgICAvLyDlhpnmlofnq6BcbiAgICBmcy53cml0ZUZpbGVTeW5jKHBvc3RQYXRoLCBwbGFuLnBvc3RDb250ZW50KTtcblxuICAgIC8vIOaWsOW7uuaXtuabtOaWsOmmlumhteebruW9le+8iOaPkuWcqOesrOS4gOS4quS4gOe6p+agh+mimOS5i+WQju+8iVxuICAgIGlmIChwbGFuLnJlYWRtZUVudHJ5KSB7XG4gICAgICBjb25zdCByZWFkbWVQYXRoID0gcGF0aC5qb2luKGJsb2csIFwiZG9jc1wiLCBcIlJFQURNRS5tZFwiKTtcbiAgICAgIGlmIChmcy5leGlzdHNTeW5jKHJlYWRtZVBhdGgpKSB7XG4gICAgICAgIGNvbnN0IHJlYWRtZSA9IGZzLnJlYWRGaWxlU3luYyhyZWFkbWVQYXRoLCBcInV0ZjhcIik7XG4gICAgICAgIGlmICghcmVhZG1lLmluY2x1ZGVzKGBdKC8ke3NsdWd9KWApKSB7XG4gICAgICAgICAgY29uc3QgbGluZXMgPSByZWFkbWUuc3BsaXQoXCJcXG5cIik7XG4gICAgICAgICAgY29uc3QgaWR4ID0gbGluZXMuZmluZEluZGV4KChsKSA9PiBsLnN0YXJ0c1dpdGgoXCIjIFwiKSk7XG4gICAgICAgICAgaWYgKGlkeCA+PSAwKSB7XG4gICAgICAgICAgICBsaW5lcy5zcGxpY2UoaWR4ICsgMSwgMCwgXCJcIiwgcGxhbi5yZWFkbWVFbnRyeSk7XG4gICAgICAgICAgICBmcy53cml0ZUZpbGVTeW5jKHJlYWRtZVBhdGgsIGxpbmVzLmpvaW4oXCJcXG5cIikpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIG5ldyBOb3RpY2UoXG4gICAgICBgUHVibGlzaDog5bey5YaZ5YWlIGRvY3MvJHtzbHVnfS5tZO+8iCR7cGxhbi5pc05ldyA/IFwi5paw5bu6XCIgOiBcIuabtOaWsFwife+8ie+8jOW8gOWni+aehOW7uuKApmAsXG4gICAgICA4MDAwLFxuICAgICk7XG5cbiAgICBpZiAoIXRoaXMuc2V0dGluZ3MuYXV0b0RlcGxveSkge1xuICAgICAgbmV3IE5vdGljZShgUHVibGlzaDog5a6M5oiQ77yI5pyq6YOo572y77yJ44CC5Y+R5biD5YmN6K6w5b6XIGdpdCBjb21taXQg5Y2a5a6i5LuT5bqT44CCYCwgMCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8g5p6E5bu6ICsg6YOo572y77ya55SoIGxvZ2luIHNoZWxsIOS/neivgSBwbnBtIOWcqCBQQVRIIOmHjFxuICAgIGNvbnN0IHJ1biA9IChjbWQ6IHN0cmluZykgPT5cbiAgICAgIG5ldyBQcm9taXNlPHsgb2s6IGJvb2xlYW47IHN0ZG91dDogc3RyaW5nIH0+KChyZXMpID0+IHtcbiAgICAgICAgZXhlYyhcbiAgICAgICAgICBgL2Jpbi96c2ggLWxjICR7SlNPTi5zdHJpbmdpZnkoY21kKX1gLFxuICAgICAgICAgIHsgY3dkOiBibG9nLCB0aW1lb3V0OiA2MDAwMDAgfSxcbiAgICAgICAgICAoZXJyb3IsIHN0ZG91dCwgc3RkZXJyKSA9PiB7XG4gICAgICAgICAgICByZXMoeyBvazogIWVycm9yLCBzdGRvdXQ6IGAke3N0ZG91dH1cXG4ke3N0ZGVycn1gIH0pO1xuICAgICAgICAgIH0sXG4gICAgICAgICk7XG4gICAgICB9KTtcblxuICAgIGNvbnN0IGJ1aWxkID0gYXdhaXQgcnVuKHRoaXMuc2V0dGluZ3MuYnVpbGRDbWQpO1xuICAgIGlmICghYnVpbGQub2spIHtcbiAgICAgIG5ldyBOb3RpY2UoYFB1Ymxpc2g6IOaehOW7uuWksei0pe+8jOaWh+eroOW3suWGmeWFpeS9huacqumDqOe9suOAguivt+eciyBjb25zb2xlYCwgMCk7XG4gICAgICBjb25zb2xlLmVycm9yKGJ1aWxkLnN0ZG91dCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIG5ldyBOb3RpY2UoXCJQdWJsaXNoOiDmnoTlu7rmiJDlip/vvIzpg6jnvbLkuK3igKZcIiwgODAwMCk7XG4gICAgY29uc3QgZGVwbG95ID0gYXdhaXQgcnVuKHRoaXMuc2V0dGluZ3MuZGVwbG95Q21kKTtcbiAgICBpZiAoIWRlcGxveS5vaykge1xuICAgICAgbmV3IE5vdGljZShgUHVibGlzaDog6YOo572y5aSx6LSl44CC6K+355yLIGNvbnNvbGVgLCAwKTtcbiAgICAgIGNvbnNvbGUuZXJyb3IoZGVwbG95LnN0ZG91dCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHByZXZpZXcgPSBkZXBsb3kuc3Rkb3V0Lm1hdGNoKC9odHRwczpcXC9cXC9bYS16MC05LV0rXFwucGFnZXNcXC5kZXYvKTtcbiAgICBuZXcgTm90aWNlKFxuICAgICAgYFB1Ymxpc2g6IOaIkOWKnyDwn46JIGh0dHBzOi8vbGFudGlhbnlvdS5jb20vJHtzbHVnfWAgK1xuICAgICAgICAocHJldmlldyA/IGBcXG7pooTop4jvvJoke3ByZXZpZXdbMF19YCA6IFwiXCIpICtcbiAgICAgICAgYFxcbuWNmuWuouS7k+W6k+aUueWKqOacqiBjb21taXTvvIzorrDlvpfmj5DkuqTjgIJgLFxuICAgICAgMCxcbiAgICApO1xuICB9XG59XG5cbmNsYXNzIE5ld1Bvc3RNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgcHJpdmF0ZSB0aXRsZTogc3RyaW5nO1xuICBwcml2YXRlIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgYXBwOiBBcHAsXG4gICAgaW5pdGlhbFRpdGxlOiBzdHJpbmcsXG4gICAgaW5pdGlhbERlc2NyaXB0aW9uOiBzdHJpbmcsXG4gICkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy50aXRsZSA9IGluaXRpYWxUaXRsZTtcbiAgICB0aGlzLmRlc2NyaXB0aW9uID0gaW5pdGlhbERlc2NyaXB0aW9uO1xuICB9XG5cbiAgb3BlbkFuZEF3YWl0KCk6IFByb21pc2U8eyB0aXRsZTogc3RyaW5nOyBkZXNjcmlwdGlvbjogc3RyaW5nIH0gfCBudWxsPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICBsZXQgc2V0dGxlZCA9IGZhbHNlO1xuICAgICAgY29uc3QgZG9uZSA9ICh2OiB7IHRpdGxlOiBzdHJpbmc7IGRlc2NyaXB0aW9uOiBzdHJpbmcgfSB8IG51bGwpID0+IHtcbiAgICAgICAgaWYgKCFzZXR0bGVkKSB7XG4gICAgICAgICAgc2V0dGxlZCA9IHRydWU7XG4gICAgICAgICAgcmVzb2x2ZSh2KTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICB9O1xuICAgICAgdGhpcy5vbk9wZW4gPSAoKSA9PiB7XG4gICAgICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgICAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoM1wiLCB7IHRleHQ6IFwi5paw5bu65Y2a5a6i5paH56ugXCIgfSk7XG4gICAgICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgICAgICAuc2V0TmFtZShcIuagh+mimFwiKVxuICAgICAgICAgIC5hZGRUZXh0KCh0KSA9PlxuICAgICAgICAgICAgdC5zZXRWYWx1ZSh0aGlzLnRpdGxlKS5vbkNoYW5nZSgodikgPT4gKHRoaXMudGl0bGUgPSB2KSksXG4gICAgICAgICAgKTtcbiAgICAgICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgICAgIC5zZXROYW1lKFwiZGVzY3JpcHRpb25cIilcbiAgICAgICAgICAuc2V0RGVzYyhcIuS4gOS4pOWPpeivneamguaLrOWFqOaWh+aguOW/g+iuuueCue+8iDYwLTEyMCDlrZfvvIlcIilcbiAgICAgICAgICAuYWRkVGV4dEFyZWEoKHQpID0+IHtcbiAgICAgICAgICAgIHQuc2V0VmFsdWUodGhpcy5kZXNjcmlwdGlvbikub25DaGFuZ2UoKHYpID0+ICh0aGlzLmRlc2NyaXB0aW9uID0gdikpO1xuICAgICAgICAgICAgdC5pbnB1dEVsLnJvd3MgPSAzO1xuICAgICAgICAgIH0pO1xuICAgICAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAgICAgLmFkZEJ1dHRvbigoYikgPT5cbiAgICAgICAgICAgIGJcbiAgICAgICAgICAgICAgLnNldEJ1dHRvblRleHQoXCLlj5HluINcIilcbiAgICAgICAgICAgICAgLnNldEN0YSgpXG4gICAgICAgICAgICAgIC5vbkNsaWNrKCgpID0+IGRvbmUoeyB0aXRsZTogdGhpcy50aXRsZSwgZGVzY3JpcHRpb246IHRoaXMuZGVzY3JpcHRpb24gfSkpLFxuICAgICAgICAgIClcbiAgICAgICAgICAuYWRkQnV0dG9uKChiKSA9PiBiLnNldEJ1dHRvblRleHQoXCLlj5bmtohcIikub25DbGljaygoKSA9PiBkb25lKG51bGwpKSk7XG4gICAgICB9O1xuICAgICAgdGhpcy5vbkNsb3NlID0gKCkgPT4gZG9uZShudWxsKTtcbiAgICAgIHRoaXMub3BlbigpO1xuICAgIH0pO1xuICB9XG59XG5cbmNsYXNzIFB1Ymxpc2hTZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XG4gIHBsdWdpbjogUHVibGlzaFBsdWdpbjtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBQdWJsaXNoUGx1Z2luKSB7XG4gICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgZGlzcGxheSgpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIuWNmuWuouS7k+W6k+i3r+W+hFwiKVxuICAgICAgLnNldERlc2MoXCJlYWktdGhvdWdodHMg5LuT5bqT55qE57ud5a+56Lev5b6EXCIpXG4gICAgICAuYWRkVGV4dCgodCkgPT5cbiAgICAgICAgdFxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5ibG9nUGF0aClcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHYpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmJsb2dQYXRoID0gdjtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKFwi5p6E5bu65ZG95LukXCIpXG4gICAgICAuc2V0RGVzYyhcIuWGmeWFpeaWh+eroOWQjuaJp+ihjO+8iGN3ZCA9IOWNmuWuouS7k+W6k++8iVwiKVxuICAgICAgLmFkZFRleHQoKHQpID0+XG4gICAgICAgIHQuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuYnVpbGRDbWQpLm9uQ2hhbmdlKGFzeW5jICh2KSA9PiB7XG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuYnVpbGRDbWQgPSB2O1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIumDqOe9suWRveS7pFwiKVxuICAgICAgLnNldERlc2MoXCLmnoTlu7rmiJDlip/lkI7miafooYxcIilcbiAgICAgIC5hZGRUZXh0KCh0KSA9PlxuICAgICAgICB0LnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmRlcGxveUNtZCkub25DaGFuZ2UoYXN5bmMgKHYpID0+IHtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5kZXBsb3lDbWQgPSB2O1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIuiHquWKqOaehOW7uumDqOe9slwiKVxuICAgICAgLnNldERlc2MoXCLlhbPpl63lkI7lj6rlhpnlhaXmlofku7bvvIzkuI3miafooYzlkb3ku6RcIilcbiAgICAgIC5hZGRUb2dnbGUoKHQpID0+XG4gICAgICAgIHQuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuYXV0b0RlcGxveSkub25DaGFuZ2UoYXN5bmMgKHYpID0+IHtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5hdXRvRGVwbG95ID0gdjtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG59XG4iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBd0NBLElBQU0saUJBQWlCOztBQUd2QixTQUFnQixpQkFBaUIsS0FBcUI7Q0FDcEQsTUFBTSxJQUFJLElBQUksTUFBTSxjQUFjO0NBQ2xDLE9BQU8sSUFBSSxJQUFJLE1BQU0sRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUMsUUFBUSxRQUFRLEVBQUUsSUFBSTtBQUMxRDtBQU9BLFNBQVMsVUFBVSxLQUF5QjtDQUMxQyxNQUFNLElBQUksSUFBSSxNQUFNLGNBQWM7Q0FDbEMsSUFBSSxDQUFDLEdBQUcsT0FBTztFQUFFLGFBQWE7RUFBSSxNQUFNO0NBQUk7Q0FDNUMsT0FBTztFQUFFLGFBQWEsRUFBRTtFQUFJLE1BQU0sSUFBSSxNQUFNLEVBQUUsRUFBRSxDQUFDLE1BQU07Q0FBRTtBQUMzRDtBQUVBLFNBQVMsY0FBYyxJQUFvQztDQUN6RCxNQUFNLE1BQThCLENBQUM7Q0FDckMsS0FBSyxNQUFNLFFBQVEsR0FBRyxNQUFNLElBQUksR0FBRztFQUNqQyxNQUFNLElBQUksS0FBSyxNQUFNLHNCQUFzQjtFQUMzQyxJQUFJLEdBQUcsSUFBSSxFQUFFLE1BQU0sRUFBRSxFQUFFLENBQUMsUUFBUSxZQUFZLElBQUk7Q0FDbEQ7Q0FDQSxPQUFPO0FBQ1Q7QUFFQSxTQUFTLGVBQWUsYUFBcUIsT0FBdUI7Q0FDbEUsSUFBSSxhQUFhLEtBQUssV0FBVyxHQUMvQixPQUFPLFlBQVksUUFBUSxpQkFBaUIsYUFBYSxNQUFNLEVBQUU7Q0FFbkUsT0FBTyxHQUFHLFlBQVksUUFBUSxFQUFFLGNBQWMsTUFBTTtBQUN0RDs7QUFHQSxTQUFTLGtCQUFrQixNQUFjLE1BQStDO0NBQ3RGLE1BQU0sT0FBd0MsQ0FBQztDQUMvQyxNQUFNLEtBQUs7Q0FDWCxJQUFJO0NBQ0osUUFBUSxJQUFJLEdBQUcsS0FBSyxJQUFJLE9BQU8sTUFDN0IsSUFBSSxFQUFFLEVBQUUsQ0FBQyxXQUFXLEdBQUcsS0FBSyxFQUFFLEdBQUcsS0FBSyxLQUFLO0VBQUUsS0FBSyxFQUFFO0VBQUksTUFBTSxFQUFFO0NBQUcsQ0FBQztDQUV0RSxPQUFPO0FBQ1Q7O0FBR0EsU0FBZ0IsZ0JBQWdCLE1BQXNCO0NBQ3BELE9BQU8sS0FDSixNQUFNLElBQUksQ0FBQyxDQUNYLEtBQUssU0FBUztFQUNiLE1BQU0sSUFBSSxLQUFLLEtBQUs7RUFDcEIsSUFBSSxDQUFDLG1CQUFtQixLQUFLLENBQUMsR0FBRyxPQUFPO0VBQ3hDLElBQUksT0FBTyxFQUFFLFFBQVEsZ0JBQWdCLEVBQUUsQ0FBQyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUM7RUFDcEQsT0FBTyxLQUFLLFFBQVEsVUFBVSxFQUFFO0VBQ2hDLE9BQU8sSUFBSSxLQUFLLElBQUksRUFBRTtDQUN4QixDQUFDLENBQUMsQ0FDRCxLQUFLLElBQUk7QUFDZDtBQUVBLFNBQWdCLFlBQVksT0FBc0M7Q0FDaEUsTUFBTSxFQUFFLE1BQU0sWUFBWSxZQUFZLGNBQWMsVUFBVTtDQUM5RCxNQUFNLFFBQVEsaUJBQWlCO0NBRy9CLElBQUk7Q0FDSixJQUFJO0NBQ0osSUFBSSxPQUFPO0VBQ1QsU0FBUyxNQUFNLFlBQVksR0FBQSxDQUFJLEtBQUssS0FBSztFQUN6QyxNQUFNLGVBQWUsTUFBTSxrQkFBa0IsR0FBQSxDQUFJLEtBQUs7RUFDdEQsY0FBYztHQUNaO0dBQ0EsVUFBVTtHQUNWLGdCQUFnQjtHQUNoQixVQUFVLE1BQU07R0FDaEIsYUFBYSxNQUFNO0dBQ25CLGVBQWU7R0FDZjtFQUNGLENBQUMsQ0FBQyxLQUFLLElBQUk7Q0FDYixPQUFPO0VBQ0wsTUFBTSxTQUFTLFVBQVUsWUFBc0I7RUFFL0MsUUFEYSxjQUFjLE9BQU8sV0FDMUIsQ0FBQSxDQUFLLFNBQVM7RUFDdEIsY0FBYyxRQUFRLGVBQWUsT0FBTyxhQUFhLEtBQUssRUFBRTtDQUNsRTtDQUdBLE1BQU0sYUFBdUIsQ0FBQztDQUM5QixNQUFNLFlBQXNCLENBQUM7Q0FDN0IsTUFBTSxVQUFVLFFBQ1osQ0FBQyxJQUNELGtCQUFrQixVQUFVLFlBQXNCLENBQUMsQ0FBQyxNQUFNLElBQUk7Q0FDbEUsTUFBTSxRQUFRLFFBQVEsV0FBVyxXQUFXLFVBQVUsV0FBVyxTQUFTO0NBQzFFLFdBQVcsU0FBUyxHQUFHLE1BQU07RUFDM0IsSUFBSSxPQUFPO0dBQ1QsVUFBVSxLQUFLLFFBQVEsRUFBRSxDQUFDLEdBQUc7R0FDN0IsV0FBVyxLQUFLLFFBQVEsRUFBRSxDQUFDLElBQUk7RUFDakMsT0FBTztHQUNMLFVBQVUsS0FBSyxFQUFFO0dBQ2pCLFdBQVcsS0FBSyxHQUFHLEtBQUssR0FBRyxJQUFJLEVBQUUsS0FBSztFQUN4QztDQUNGLENBQUM7Q0FHRCxJQUFJLE9BQU8sZ0JBQWdCLFdBQVcsS0FBSyxDQUFDO0NBQzVDLFdBQVcsU0FBUyxNQUFNLE1BQU07RUFFOUIsT0FBTyxLQUFLLFFBQVEsTUFBTSxLQUFLLEtBQUssS0FBSyxVQUFVLEdBQUcsWUFBWSxXQUFXLEdBQUcsRUFBRTtDQUNwRixDQUFDO0NBQ0QsSUFBSSxDQUFDLFlBQVksS0FBSyxJQUFJLEdBQ3hCLE9BQU8sS0FBSyxNQUFNLE1BQU07Q0FHMUIsTUFBTSxjQUFjLEdBQUcsWUFBWSxNQUFNLEtBQUssUUFBUSxFQUFFO0NBRXhELE9BQU87RUFDTDtFQUNBO0VBQ0E7RUFDQTtFQUNBO0VBQ0EsYUFBYSxRQUFRLE1BQU0sTUFBTSxLQUFLLEtBQUssS0FBSztDQUNsRDtBQUNGOzs7QUM3SUEsSUFBTSxtQkFBbUM7Q0FDdkMsVUFBVTtDQUNWLFVBQVU7Q0FDVixXQUFXO0NBQ1gsWUFBWTtBQUNkO0FBRUEsSUFBTSxXQUFXO0FBRWpCLElBQXFCLGdCQUFyQixjQUEyQ0EsU0FBQUEsT0FBTzs7O0VBQ3JCLEtBQUEsV0FBQTs7Q0FFM0IsTUFBTSxTQUFTO0VBQ2IsTUFBTSxLQUFLLGFBQWE7RUFDeEIsS0FBSyxXQUFXO0dBQ2QsSUFBSTtHQUNKLE1BQU07R0FDTixnQkFBZ0IsS0FBSyxrQkFBa0I7RUFDekMsQ0FBQztFQUNELEtBQUssY0FBYyxJQUFJLGtCQUFrQixLQUFLLEtBQUssSUFBSSxDQUFDO0NBQzFEO0NBRUEsTUFBTSxlQUFlO0VBQ25CLEtBQUssV0FBVyxPQUFPLE9BQU8sQ0FBQyxHQUFHLGtCQUFrQixNQUFNLEtBQUssU0FBUyxDQUFDO0NBQzNFO0NBRUEsTUFBTSxlQUFlO0VBQ25CLE1BQU0sS0FBSyxTQUFTLEtBQUssUUFBUTtDQUNuQztDQUVBLFFBQXdCO0VBQ3RCLHdCQUFPLElBQUksS0FBSyxFQUFBLENBQUUsWUFBWSxDQUFDLENBQUMsTUFBTSxHQUFHLEVBQUU7Q0FDN0M7Q0FFQSxNQUFNLG9CQUFvQjtFQUN4QixNQUFNLE9BQU8sS0FBSyxJQUFJLFVBQVUsY0FBYztFQUM5QyxJQUFJLENBQUMsTUFBTTtHQUNULElBQUlDLFNBQUFBLE9BQU8scUJBQXFCO0dBQ2hDO0VBQ0Y7RUFDQSxNQUFNLE9BQU8sS0FBSyxTQUFTO0VBQzNCLElBQUksQ0FBQyxHQUFHLFdBQVcsS0FBSyxLQUFLLE1BQU0sTUFBTSxDQUFDLEdBQUc7R0FDM0MsSUFBSUEsU0FBQUEsT0FBTyxvQkFBb0IsTUFBTTtHQUNyQztFQUNGO0VBRUEsTUFBTSxPQUFPLEtBQUs7RUFFbEIsTUFBTSxhQUFhLGlCQUFpQixNQURsQixLQUFLLElBQUksTUFBTSxLQUFLLElBQUksQ0FDSDtFQUN2QyxNQUFNLFFBQVEsS0FBSyxJQUFJLGNBQWMsYUFBYSxJQUFJO0VBQ3RELE1BQU0sY0FBYyxPQUFPLGFBQWE7RUFDeEMsTUFBTSxvQkFBb0IsT0FBTyxhQUFhO0VBRzlDLE1BQU0sYUFBYSxDQUFDLEdBQUcsV0FBVyxTQUFTLFFBQVEsQ0FBQyxDQUFDLENBQUMsS0FBSyxNQUFNLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQztFQUM1RSxNQUFNLFdBQWdELENBQUM7RUFDdkQsTUFBTSxVQUFvQixDQUFDO0VBQzNCLE1BQU0sVUFBVSxLQUFLLElBQUksTUFBTTtFQUMvQixNQUFNLFdBQ0osbUJBQW1CQyxTQUFBQSxvQkFBb0IsUUFBUSxZQUFZLElBQUk7RUFDakUsS0FBSyxNQUFNLFFBQVEsWUFBWTtHQUM3QixNQUFNLE9BQU8sS0FBSyxJQUFJLGNBQWMscUJBQXFCLE1BQU0sS0FBSyxJQUFJO0dBQ3hFLElBQUksZ0JBQWdCQyxTQUFBQSxTQUFTLFVBQzNCLFNBQVMsS0FBSztJQUFFO0lBQU0sU0FBUyxLQUFLLEtBQUssVUFBVSxLQUFLLElBQUk7R0FBRSxDQUFDO1FBRS9ELFFBQVEsS0FBSyxJQUFJO0VBRXJCO0VBQ0EsSUFBSSxRQUFRLFNBQVMsR0FDbkIsSUFBSUYsU0FBQUEsT0FBTyxzQkFBc0IsUUFBUSxLQUFLLEdBQUcsR0FBRztFQUl0RCxNQUFNLFdBQVcsS0FBSyxLQUFLLE1BQU0sUUFBUSxHQUFHLEtBQUssSUFBSTtFQUNyRCxNQUFNLGVBQWUsR0FBRyxXQUFXLFFBQVEsSUFDdkMsR0FBRyxhQUFhLFVBQVUsTUFBTSxJQUNoQztFQUdKLElBQUk7RUFDSixJQUFJO0VBQ0osSUFBSSxpQkFBaUIsTUFBTTtHQUN6QixNQUFNLFFBQVEsTUFBTSxJQUFJLGFBQ3RCLEtBQUssS0FDTCxlQUFlLE1BQ2YscUJBQXFCLEVBQ3ZCLENBQUMsQ0FBQyxhQUFhO0dBQ2YsSUFBSSxVQUFVLE1BQU07R0FDcEIsV0FBVyxNQUFNO0dBQ2pCLGlCQUFpQixNQUFNO0VBQ3pCO0VBR0EsTUFBTSxPQUFPLFlBQVk7R0FDdkI7R0FDQTtHQUNBLFlBQVksU0FBUyxLQUFLLE1BQU0sRUFBRSxJQUFJO0dBQ3RDO0dBQ0EsT0FBTyxLQUFLLE1BQU07R0FDbEI7R0FDQTtFQUNGLENBQUM7RUFHRCxNQUFNLFlBQVksS0FBSyxLQUFLLE1BQU0sUUFBUSxhQUFhLFVBQVUsUUFBUTtFQUN6RSxHQUFHLFVBQVUsV0FBVyxFQUFFLFdBQVcsS0FBSyxDQUFDO0VBQzNDLFNBQVMsU0FBUyxLQUFLLE1BQU07R0FDM0IsR0FBRyxhQUFhLElBQUksU0FBUyxLQUFLLEtBQUssV0FBVyxLQUFLLFdBQVcsRUFBRSxDQUFDO0VBQ3ZFLENBQUM7RUFHRCxHQUFHLGNBQWMsVUFBVSxLQUFLLFdBQVc7RUFHM0MsSUFBSSxLQUFLLGFBQWE7R0FDcEIsTUFBTSxhQUFhLEtBQUssS0FBSyxNQUFNLFFBQVEsV0FBVztHQUN0RCxJQUFJLEdBQUcsV0FBVyxVQUFVLEdBQUc7SUFDN0IsTUFBTSxTQUFTLEdBQUcsYUFBYSxZQUFZLE1BQU07SUFDakQsSUFBSSxDQUFDLE9BQU8sU0FBUyxNQUFNLEtBQUssRUFBRSxHQUFHO0tBQ25DLE1BQU0sUUFBUSxPQUFPLE1BQU0sSUFBSTtLQUMvQixNQUFNLE1BQU0sTUFBTSxXQUFXLE1BQU0sRUFBRSxXQUFXLElBQUksQ0FBQztLQUNyRCxJQUFJLE9BQU8sR0FBRztNQUNaLE1BQU0sT0FBTyxNQUFNLEdBQUcsR0FBRyxJQUFJLEtBQUssV0FBVztNQUM3QyxHQUFHLGNBQWMsWUFBWSxNQUFNLEtBQUssSUFBSSxDQUFDO0tBQy9DO0lBQ0Y7R0FDRjtFQUNGO0VBRUEsSUFBSUEsU0FBQUEsT0FDRixxQkFBcUIsS0FBSyxNQUFNLEtBQUssUUFBUSxPQUFPLEtBQUssVUFDekQsR0FDRjtFQUVBLElBQUksQ0FBQyxLQUFLLFNBQVMsWUFBWTtHQUM3QixJQUFJQSxTQUFBQSxPQUFPLDJDQUEyQyxDQUFDO0dBQ3ZEO0VBQ0Y7RUFHQSxNQUFNLE9BQU8sUUFDWCxJQUFJLFNBQTBDLFFBQVE7R0FDcEQsQ0FBQSxHQUFBLGNBQUEsS0FBQSxDQUNFLGdCQUFnQixLQUFLLFVBQVUsR0FBRyxLQUNsQztJQUFFLEtBQUs7SUFBTSxTQUFTO0dBQU8sSUFDNUIsT0FBTyxRQUFRLFdBQVc7SUFDekIsSUFBSTtLQUFFLElBQUksQ0FBQztLQUFPLFFBQVEsR0FBRyxPQUFPLElBQUk7SUFBUyxDQUFDO0dBQ3BELENBQ0Y7RUFDRixDQUFDO0VBRUgsTUFBTSxRQUFRLE1BQU0sSUFBSSxLQUFLLFNBQVMsUUFBUTtFQUM5QyxJQUFJLENBQUMsTUFBTSxJQUFJO0dBQ2IsSUFBSUEsU0FBQUEsT0FBTyxzQ0FBc0MsQ0FBQztHQUNsRCxRQUFRLE1BQU0sTUFBTSxNQUFNO0dBQzFCO0VBQ0Y7RUFDQSxJQUFJQSxTQUFBQSxPQUFPLHNCQUFzQixHQUFJO0VBQ3JDLE1BQU0sU0FBUyxNQUFNLElBQUksS0FBSyxTQUFTLFNBQVM7RUFDaEQsSUFBSSxDQUFDLE9BQU8sSUFBSTtHQUNkLElBQUlBLFNBQUFBLE9BQU8sNEJBQTRCLENBQUM7R0FDeEMsUUFBUSxNQUFNLE9BQU8sTUFBTTtHQUMzQjtFQUNGO0VBQ0EsTUFBTSxVQUFVLE9BQU8sT0FBTyxNQUFNLGtDQUFrQztFQUN0RSxJQUFJQSxTQUFBQSxPQUNGLHlDQUF5QyxVQUN0QyxVQUFVLFFBQVEsUUFBUSxPQUFPLE1BQ2xDLDBCQUNGLENBQ0Y7Q0FDRjtBQUNGO0FBRUEsSUFBTSxlQUFOLGNBQTJCRyxTQUFBQSxNQUFNO0NBSS9CLFlBQ0UsS0FDQSxjQUNBLG9CQUNBO0VBQ0EsTUFBTSxHQUFHO0VBQ1QsS0FBSyxRQUFRO0VBQ2IsS0FBSyxjQUFjO0NBQ3JCO0NBRUEsZUFBdUU7RUFDckUsT0FBTyxJQUFJLFNBQVMsWUFBWTtHQUM5QixJQUFJLFVBQVU7R0FDZCxNQUFNLFFBQVEsTUFBcUQ7SUFDakUsSUFBSSxDQUFDLFNBQVM7S0FDWixVQUFVO0tBQ1YsUUFBUSxDQUFDO0lBQ1g7SUFDQSxLQUFLLE1BQU07R0FDYjtHQUNBLEtBQUssZUFBZTtJQUNsQixNQUFNLEVBQUUsY0FBYztJQUN0QixVQUFVLFNBQVMsTUFBTSxFQUFFLE1BQU0sU0FBUyxDQUFDO0lBQzNDLElBQUlDLFNBQUFBLFFBQVEsU0FBUyxDQUFDLENBQ25CLFFBQVEsSUFBSSxDQUFDLENBQ2IsU0FBUyxNQUNSLEVBQUUsU0FBUyxLQUFLLEtBQUssQ0FBQyxDQUFDLFVBQVUsTUFBTyxLQUFLLFFBQVEsQ0FBRSxDQUN6RDtJQUNGLElBQUlBLFNBQUFBLFFBQVEsU0FBUyxDQUFDLENBQ25CLFFBQVEsYUFBYSxDQUFDLENBQ3RCLFFBQVEsd0JBQXdCLENBQUMsQ0FDakMsYUFBYSxNQUFNO0tBQ2xCLEVBQUUsU0FBUyxLQUFLLFdBQVcsQ0FBQyxDQUFDLFVBQVUsTUFBTyxLQUFLLGNBQWMsQ0FBRTtLQUNuRSxFQUFFLFFBQVEsT0FBTztJQUNuQixDQUFDO0lBQ0gsSUFBSUEsU0FBQUEsUUFBUSxTQUFTLENBQUMsQ0FDbkIsV0FBVyxNQUNWLEVBQ0csY0FBYyxJQUFJLENBQUMsQ0FDbkIsT0FBTyxDQUFDLENBQ1IsY0FBYyxLQUFLO0tBQUUsT0FBTyxLQUFLO0tBQU8sYUFBYSxLQUFLO0lBQVksQ0FBQyxDQUFDLENBQzdFLENBQUMsQ0FDQSxXQUFXLE1BQU0sRUFBRSxjQUFjLElBQUksQ0FBQyxDQUFDLGNBQWMsS0FBSyxJQUFJLENBQUMsQ0FBQztHQUNyRTtHQUNBLEtBQUssZ0JBQWdCLEtBQUssSUFBSTtHQUM5QixLQUFLLEtBQUs7RUFDWixDQUFDO0NBQ0g7QUFDRjtBQUVBLElBQU0sb0JBQU4sY0FBZ0NDLFNBQUFBLGlCQUFpQjtDQUcvQyxZQUFZLEtBQVUsUUFBdUI7RUFDM0MsTUFBTSxLQUFLLE1BQU07RUFDakIsS0FBSyxTQUFTO0NBQ2hCO0NBRUEsVUFBZ0I7RUFDZCxNQUFNLEVBQUUsZ0JBQWdCO0VBQ3hCLFlBQVksTUFBTTtFQUNsQixJQUFJRCxTQUFBQSxRQUFRLFdBQVcsQ0FBQyxDQUNyQixRQUFRLFFBQVEsQ0FBQyxDQUNqQixRQUFRLHNCQUFzQixDQUFDLENBQy9CLFNBQVMsTUFDUixFQUNHLFNBQVMsS0FBSyxPQUFPLFNBQVMsUUFBUSxDQUFDLENBQ3ZDLFNBQVMsT0FBTyxNQUFNO0dBQ3JCLEtBQUssT0FBTyxTQUFTLFdBQVc7R0FDaEMsTUFBTSxLQUFLLE9BQU8sYUFBYTtFQUNqQyxDQUFDLENBQ0w7RUFDRixJQUFJQSxTQUFBQSxRQUFRLFdBQVcsQ0FBQyxDQUNyQixRQUFRLE1BQU0sQ0FBQyxDQUNmLFFBQVEscUJBQXFCLENBQUMsQ0FDOUIsU0FBUyxNQUNSLEVBQUUsU0FBUyxLQUFLLE9BQU8sU0FBUyxRQUFRLENBQUMsQ0FBQyxTQUFTLE9BQU8sTUFBTTtHQUM5RCxLQUFLLE9BQU8sU0FBUyxXQUFXO0dBQ2hDLE1BQU0sS0FBSyxPQUFPLGFBQWE7RUFDakMsQ0FBQyxDQUNIO0VBQ0YsSUFBSUEsU0FBQUEsUUFBUSxXQUFXLENBQUMsQ0FDckIsUUFBUSxNQUFNLENBQUMsQ0FDZixRQUFRLFNBQVMsQ0FBQyxDQUNsQixTQUFTLE1BQ1IsRUFBRSxTQUFTLEtBQUssT0FBTyxTQUFTLFNBQVMsQ0FBQyxDQUFDLFNBQVMsT0FBTyxNQUFNO0dBQy9ELEtBQUssT0FBTyxTQUFTLFlBQVk7R0FDakMsTUFBTSxLQUFLLE9BQU8sYUFBYTtFQUNqQyxDQUFDLENBQ0g7RUFDRixJQUFJQSxTQUFBQSxRQUFRLFdBQVcsQ0FBQyxDQUNyQixRQUFRLFFBQVEsQ0FBQyxDQUNqQixRQUFRLGdCQUFnQixDQUFDLENBQ3pCLFdBQVcsTUFDVixFQUFFLFNBQVMsS0FBSyxPQUFPLFNBQVMsVUFBVSxDQUFDLENBQUMsU0FBUyxPQUFPLE1BQU07R0FDaEUsS0FBSyxPQUFPLFNBQVMsYUFBYTtHQUNsQyxNQUFNLEtBQUssT0FBTyxhQUFhO0VBQ2pDLENBQUMsQ0FDSDtDQUNKO0FBQ0YifQ==