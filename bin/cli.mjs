#!/usr/bin/env node
/**
 * 把 Skill 安装到 Agent 的发现路径。
 *
 * 目标路径（按优先级）：
 *   --dir <path>  显式指定
 *   --global      ~/.agents/skills/ptp-transplant（用户级，所有项目可用）
 *   默认           <当前目录>/.agents/skills/ptp-transplant（项目级）
 */
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAME = "ptp-transplant";
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** 随包发布的 Skill 内容；文档与开发用文件不进入安装结果 */
const PAYLOAD = ["SKILL.md", "reference", "templates"];

const HELP = `用法：npx ${SKILL_NAME} [选项]

把 ${SKILL_NAME} 安装到 Agent 的 Skill 发现路径。

选项：
  --global, -g        安装到用户级 ~/.agents/skills/${SKILL_NAME}
  --dir <path>        安装到指定目录（该目录即 Skill 根，需以 ${SKILL_NAME} 结尾）
  --force, -f         目标已存在时覆盖
  --dry-run           只打印将要写入的位置，不落盘
  --help, -h          显示本说明

默认：安装到 <当前目录>/.agents/skills/${SKILL_NAME}
安装后重启该项目的 Agent 会话，使 Skill 被发现。
`;

function fail(message) {
  process.stderr.write(`错误：${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { global: false, dir: null, force: false, dryRun: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--global" || arg === "-g") options.global = true;
    else if (arg === "--force" || arg === "-f") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--dir") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) fail("--dir 需要一个路径");
      options.dir = value;
      index += 1;
    } else fail(`无法识别的选项：${arg}（用 --help 查看用法）`);
  }
  return options;
}

function resolveTarget(options) {
  if (options.dir !== null) return resolve(options.dir);
  if (options.global) return join(homedir(), ".agents", "skills", SKILL_NAME);
  return resolve(process.cwd(), ".agents", "skills", SKILL_NAME);
}

function isInsidePackage(target) {
  return target === PACKAGE_ROOT || target.startsWith(PACKAGE_ROOT + sep);
}

async function directoryExists(path) {
  if (!existsSync(path)) return false;
  const info = await stat(path);
  if (!info.isDirectory()) fail(`${path} 已存在且不是目录`);
  return true;
}

async function install(target, options) {
  if (isInsidePackage(target)) fail(`目标不能是本包自身（${target}）`);

  for (const entry of PAYLOAD) {
    const source = join(PACKAGE_ROOT, entry);
    if (!existsSync(source)) fail(`安装源缺失：${source}（包内容不完整）`);
  }

  if (options.dryRun) {
    process.stdout.write(`将安装到：${target}\n`);
    for (const entry of PAYLOAD) process.stdout.write(`  ${entry}\n`);
    return;
  }

  const occupied = await directoryExists(target);
  if (occupied && !options.force) {
    fail(`目标已存在：${target}\n如需覆盖请加 --force`);
  }

  if (occupied) await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  for (const entry of PAYLOAD) {
    await cp(join(PACKAGE_ROOT, entry), join(target, entry), { recursive: true });
  }

  process.stdout.write(`已安装 ${SKILL_NAME} → ${target}\n`);
  process.stdout.write("请重启该项目的 Agent 会话，使 Skill 被发现。\n");
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (options.global && options.dir !== null) fail("--global 与 --dir 不能同时使用");

await install(resolveTarget(options), options);
