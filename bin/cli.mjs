#!/usr/bin/env node
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAME = "ptp-transplant";
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAYLOAD = ["SKILL.md", "reference", "templates"];

const HELP = `用法：npx ${SKILL_NAME} [选项]

把 ${SKILL_NAME} 安装到 Agent 的 Skill 发现路径。

选项：
  --global, -g        安装到用户级 ~/.agents/skills/${SKILL_NAME}
  --dir <path>        安装到指定目录（该目录即 Skill 根，须名为 ${SKILL_NAME}）
  --force, -f         覆盖已安装的同名 Skill；不会覆盖其他目录
  --dry-run           检查目标并打印预期操作，不落盘
  --help, -h          显示本说明

默认：安装到 <当前目录>/.agents/skills/${SKILL_NAME}
安装后重启该项目的 Agent 会话，使 Skill 被发现。
`;

function fail(message) {
  process.stderr.write(`错误：${message}\n`);
  process.exitCode = 1;
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
      if (value === undefined || value.startsWith("-")) throw new Error("--dir 需要一个路径");
      options.dir = value;
      index += 1;
    } else throw new Error(`无法识别的选项：${arg}（用 --help 查看用法）`);
  }
  return options;
}

function resolveTarget(options) {
  if (options.dir !== null) return resolve(options.dir);
  if (options.global) return join(homedir(), ".agents", "skills", SKILL_NAME);
  return resolve(process.cwd(), ".agents", "skills", SKILL_NAME);
}

async function canonicalPath(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await canonicalPath(parent), basename(path));
  }
}

function comparablePath(path) {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function contains(parent, child) {
  const path = relative(comparablePath(parent), comparablePath(child));
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

async function inspectTarget(target, options) {
  if (basename(target) !== SKILL_NAME) {
    throw new Error(`目标目录必须名为 ${SKILL_NAME}：${target}`);
  }

  const [packagePath, targetPath] = await Promise.all([
    canonicalPath(PACKAGE_ROOT),
    canonicalPath(target),
  ]);
  if (contains(packagePath, targetPath) || contains(targetPath, packagePath)) {
    throw new Error(`目标不能是本包自身或其父子目录：${target}`);
  }

  for (const entry of PAYLOAD) {
    await lstat(join(PACKAGE_ROOT, entry));
  }

  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return false;
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`目标已存在且不是普通目录：${target}`);
  }
  if (!options.force) throw new Error(`目标已存在：${target}\n如需覆盖请加 --force`);

  let marker;
  try {
    const markerPath = join(target, "SKILL.md");
    if (!(await lstat(markerPath)).isFile()) throw new Error("SKILL.md 不是普通文件");
    marker = await readFile(markerPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new Error(`拒绝覆盖非 ${SKILL_NAME} 安装：${target} 缺少 SKILL.md`);
  }
  const frontmatter = marker.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter || !/^name:[ \t]*ptp-transplant[ \t]*\r?$/m.test(frontmatter[1])) {
    throw new Error(`拒绝覆盖非 ${SKILL_NAME} 安装：${target}`);
  }
  return true;
}

async function install(target, options) {
  const occupied = await inspectTarget(target, options);
  if (options.dryRun) {
    process.stdout.write(`${occupied ? "将覆盖" : "将安装到"}：${target}\n`);
    for (const entry of PAYLOAD) process.stdout.write(`  ${entry}\n`);
    return;
  }

  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, `.${SKILL_NAME}-`));
  const candidate = join(staging, SKILL_NAME);
  const backup = join(staging, "previous");
  let movedOld = false;
  let installed = false;
  try {
    await mkdir(candidate);
    for (const entry of PAYLOAD) {
      await cp(join(PACKAGE_ROOT, entry), join(candidate, entry), { recursive: true });
    }
    if (occupied) {
      await inspectTarget(target, options);
      await rename(target, backup);
      movedOld = true;
    } else {
      try {
        await lstat(target);
        throw new Error(`目标在准备期间被其他操作占用：${target}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    await rename(candidate, target);
    installed = true;
  } catch (error) {
    if (movedOld) {
      try {
        await rename(backup, target);
        movedOld = false;
      } catch (restoreError) {
        throw new Error(`安装失败，旧安装保留在 ${backup}；恢复失败：${restoreError.message}`, { cause: error });
      }
    }
    throw error;
  } finally {
    if (!movedOld || installed) {
      try {
        await rm(staging, { recursive: true, force: true });
      } catch (error) {
        process.stderr.write(`警告：临时目录清理失败：${staging}（${error.message}）\n`);
      }
    }
  }

  process.stdout.write(`已安装 ${SKILL_NAME} → ${target}\n`);
  process.stdout.write("请重启该项目的 Agent 会话，使 Skill 被发现。\n");
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) process.stdout.write(HELP);
  else {
    if (options.global && options.dir !== null) throw new Error("--global 与 --dir 不能同时使用");
    await install(resolveTarget(options), options);
  }
} catch (error) {
  fail(error.message);
}
