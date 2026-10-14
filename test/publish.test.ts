import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { linkifyBareUrls, planPublish, stripFrontmatter } from "../src/publish";

const EXISTING_POST = `---
title: 人类示范数据对具身智能有用吗
description: 旧的描述
date: "2026-10-14"
updated: "2026-10-14"
permalink: /human-data-contribution
---

# 人类示范数据对具身智能有用吗

旧正文。

![Nature Well 灵巧手](/images/human-data-contribution-nature-well.png)
`;

test("新建：生成 frontmatter、补 H1、转换图片与裸链", () => {
  const plan = planPublish({
    slug: "my-post",
    sourceBody: `第一段。

https://fidelity-gap.github.io/

![[CleanShot 2026-10-14 at 16.13.05@2x.png]]

再一段 https://example.com/inline 不转换。
`,
    imageLinks: ["CleanShot 2026-10-14 at 16.13.05@2x.png"],
    existingPost: null,
    today: "2026-10-14",
    newTitle: "我的标题",
    newDescription: "一两句话。",
  });

  assert.equal(plan.isNew, true);
  assert.equal(plan.title, "我的标题");
  assert.deepEqual(plan.imageNames, ["my-post-1.png"]);
  assert.match(plan.postContent, /^title: 我的标题$/m);
  assert.match(plan.postContent, /^permalink: \/my-post$/m);
  assert.match(plan.postContent, /^# 我的标题$/m);
  assert.match(
    plan.postContent,
    /!\[\]\(\/images\/my-post-1\.png\)/,
  );
  assert.match(plan.postContent, /\[fidelity-gap\.github\.io\]\(https:\/\/fidelity-gap\.github\.io\/\)/);
  assert.match(plan.postContent, /inline 不转换/);
  assert.equal(plan.readmeEntry, "- [我的标题](/my-post)");
});

test("新建：标题缺省时回退 slug", () => {
  const plan = planPublish({
    slug: "no-title",
    sourceBody: "正文。",
    imageLinks: [],
    existingPost: null,
    today: "2026-10-14",
  });
  assert.equal(plan.title, "no-title");
  assert.match(plan.postContent, /^# no-title$/m);
});

test("更新：保留原 frontmatter 与图片名，只换 updated 和正文", () => {
  const plan = planPublish({
    slug: "human-data-contribution",
    sourceBody: `新正文。

![[CleanShot 2026-10-14 at 16.13.05@2x.png]]

结尾。`,
    imageLinks: ["CleanShot 2026-10-14 at 16.13.05@2x.png"],
    existingPost: EXISTING_POST,
    today: "2026-10-15",
  });

  assert.equal(plan.isNew, false);
  assert.equal(plan.readmeEntry, null);
  assert.equal(plan.title, "人类示范数据对具身智能有用吗");
  // date/description 不动，updated 更新
  assert.match(plan.postContent, /^date: "2026-10-14"$/m);
  assert.match(plan.postContent, /^updated: "2026-10-15"$/m);
  assert.match(plan.postContent, /^description: 旧的描述$/m);
  // 沿用旧图片名与 alt
  assert.deepEqual(plan.imageNames, ["human-data-contribution-nature-well.png"]);
  assert.match(
    plan.postContent,
    /!\[Nature Well 灵巧手\]\(\/images\/human-data-contribution-nature-well\.png\)/,
  );
  assert.doesNotMatch(plan.postContent, /旧正文/);
  assert.match(plan.postContent, /新正文/);
});

test("更新：图片数量变化时用序号重命名", () => {
  const plan = planPublish({
    slug: "human-data-contribution",
    sourceBody: "![[a.png]]\n\n![[b.png]]",
    imageLinks: ["a.png", "b.png"],
    existingPost: EXISTING_POST,
    today: "2026-10-15",
  });
  assert.deepEqual(plan.imageNames, [
    "human-data-contribution-1.png",
    "human-data-contribution-2.png",
  ]);
});

test("已有 H1 时不重复补标题", () => {
  const plan = planPublish({
    slug: "has-h1",
    sourceBody: "# 自己起的标题\n\n正文。",
    imageLinks: [],
    existingPost: null,
    today: "2026-10-14",
    newTitle: "别的标题",
  });
  assert.equal((plan.postContent.match(/^# /gm) ?? []).length, 1);
  assert.match(plan.postContent, /^# 自己起的标题$/m);
});

test("linkifyBareUrls：www 前缀与带路径域名", () => {
  const out = linkifyBareUrls(
    "https://www.naturewill.com/blog/natura-1?lang=en#subsection-model\n" +
      "  https://example.com/a/b  \n" +
      "前面 https://example.com 不转换",
  );
  assert.equal(
    out.split("\n")[0],
    "[naturewill.com](https://www.naturewill.com/blog/natura-1?lang=en#subsection-model)",
  );
  assert.equal(out.split("\n")[1], "[example.com](https://example.com/a/b)");
  assert.equal(out.split("\n")[2], "前面 https://example.com 不转换");
});

test("stripFrontmatter", () => {
  assert.equal(stripFrontmatter("---\ntitle: x\n---\n\n正文\n"), "正文\n");
  assert.equal(stripFrontmatter("没有 frontmatter"), "没有 frontmatter");
});
