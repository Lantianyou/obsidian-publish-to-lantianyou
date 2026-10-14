/**
 * 发布流程的纯转换逻辑（不依赖 Obsidian API，可单测）。
 * 规则与 opencode skill「publish-obsidian-to-blog」一致：
 * - slug = 源文件名（一字不改）
 * - 更新：保留原 frontmatter，只改 updated；新建：生成模板 frontmatter
 * - ![[img]] → ![alt](/images/<slug>-<n>.png)，更新时若图片数量不变则沿用旧名与旧 alt
 * - 独占一行的裸 URL → [域名](url)
 * - 没有一级标题时补 `# <title>`
 */

export interface PublishPlanInput {
  /** 源文件名去扩展名，即 slug / permalink */
  slug: string;
  /** 源正文（frontmatter 已剥离） */
  sourceBody: string;
  /** 正文中按出现顺序排列的图片 wikilink（不含 ! 和 [[]]） */
  imageLinks: string[];
  /** 博客现有文章全文；null 表示新建 */
  existingPost: string | null;
  /** 当天日期 YYYY-MM-DD */
  today: string;
  /** 仅新建时必填：文章标题 */
  newTitle?: string;
  /** 仅新建时必填：description */
  newDescription?: string;
}

export interface PublishPlan {
  isNew: boolean;
  title: string;
  /** 写入 $BLOG/docs/<slug>.md 的完整内容 */
  postContent: string;
  /** 与 imageLinks 一一对应的 public/images/ 下的文件名 */
  imageNames: string[];
  /** 与 imageLinks 一一对应的 alt 文本 */
  imageAlts: string[];
  /** 新建时要插到首页链接列表的一行；更新时为 null */
  readmeEntry: string | null;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

/** 从全文剥掉 frontmatter，返回正文 */
export function stripFrontmatter(raw: string): string {
  const m = raw.match(FRONTMATTER_RE);
  return m ? raw.slice(m[0].length).replace(/^\n+/, "") : raw;
}

interface ParsedPost {
  frontmatter: string;
  body: string;
}

function parsePost(raw: string): ParsedPost {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: "", body: raw };
  return { frontmatter: m[1], body: raw.slice(m[0].length) };
}

function parseFlatYaml(fm: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of fm.split("\n")) {
    const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

function replaceUpdated(frontmatter: string, today: string): string {
  if (/^updated:/m.test(frontmatter)) {
    return frontmatter.replace(/^updated:.*$/m, `updated: "${today}"`);
  }
  return `${frontmatter.trimEnd()}\nupdated: "${today}"`;
}

/** 沿用旧图的判定：旧正文里的图片引用按顺序解析 */
function existingImageRefs(body: string, slug: string): { alt: string; name: string }[] {
  const refs: { alt: string; name: string }[] = [];
  const re = /!\[([^\]]*)\]\(\/images\/([^\s)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[2].startsWith(`${slug}-`)) refs.push({ alt: m[1], name: m[2] });
  }
  return refs;
}

/** 独占一行的裸 URL → [域名](url)（去掉 www. 前缀） */
export function linkifyBareUrls(body: string): string {
  return body
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!/^https?:\/\/\S+$/.test(t)) return line;
      let host = t.replace(/^https?:\/\//, "").split("/")[0];
      host = host.replace(/^www\./, "");
      return `[${host}](${t})`;
    })
    .join("\n");
}

export function planPublish(input: PublishPlanInput): PublishPlan {
  const { slug, sourceBody, imageLinks, existingPost, today } = input;
  const isNew = existingPost === null;

  // ---- 标题与 frontmatter ----
  let frontmatter: string;
  let title: string;
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
      "---",
    ].join("\n");
  } else {
    const parsed = parsePost(existingPost as string);
    const meta = parseFlatYaml(parsed.frontmatter);
    title = meta.title ?? slug;
    frontmatter = `---\n${replaceUpdated(parsed.frontmatter, today)}\n---`;
  }

  // ---- 图片命名 ----
  const imageNames: string[] = [];
  const imageAlts: string[] = [];
  const oldRefs = isNew
    ? []
    : existingImageRefs(parsePost(existingPost as string).body, slug);
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

  // ---- 正文转换 ----
  let body = linkifyBareUrls(sourceBody.trim());
  imageLinks.forEach((link, i) => {
    // 每次只替换第一个匹配，保持顺序对应
    body = body.replace(`![[${link}]]`, `![${imageAlts[i]}](/images/${imageNames[i]})`);
  });
  if (!/^# [^\n]/m.test(body)) {
    body = `# ${title}\n\n${body}`;
  }

  const postContent = `${frontmatter}\n\n${body.trimEnd()}\n`;

  return {
    isNew,
    title,
    postContent,
    imageNames,
    imageAlts,
    readmeEntry: isNew ? `- [${title}](/${slug})` : null,
  };
}
