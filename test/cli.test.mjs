import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "bin", "cli.mjs");
const sandbox = await mkdtemp(join(tmpdir(), "ptp-transplant-test-"));
after(() => rm(sandbox, { recursive: true, force: true }));

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

test("rejects arbitrary directories even with --force and --dry-run", async () => {
  const project = join(sandbox, "project");
  await mkdir(project);
  await writeFile(join(project, "keep.txt"), "keep");
  const result = run("--dir", project, "--force", "--dry-run");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /必须名为 ptp-transplant/);
  assert.equal(await readFile(join(project, "keep.txt"), "utf8"), "keep");
});

test("rejects overwriting package itself and its nested path", () => {
  for (const target of [root, join(root, "test", "ptp-transplant")]) {
    const result = run("--dir", target, "--force", "--dry-run");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /不能是本包自身或其父子目录/);
  }
});

test("rejects differently cased aliases of the package on Windows", () => {
  if (process.platform !== "win32") return;
  const alias = join(dirname(root), "PTP-TRANSPLANT");
  const result = run("--dir", alias, "--force", "--dry-run");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /必须名为 ptp-transplant|不能是本包自身/);
});

test("rejects aliases through a parent symlink", async () => {
  const alias = join(sandbox, "alias");
  await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
  const result = run("--dir", join(alias, "test", "ptp-transplant"), "--force", "--dry-run");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /不能是本包自身或其父子目录/);
});

test("installs only payload and requires --force for existing target", async () => {
  const target = join(sandbox, "another-project", "ptp-transplant");
  assert.equal(run("--dir", target, "--dry-run").status, 0);
  assert.equal(run("--dir", target).status, 0);
  assert.deepEqual((await readdir(target)).sort(), ["SKILL.md", "reference", "templates"]);
  const occupied = run("--dir", target, "--dry-run");
  assert.equal(occupied.status, 1);
  assert.match(occupied.stderr, /目标已存在/);
  const overwrite = run("--dir", target, "--force", "--dry-run");
  assert.equal(overwrite.status, 0);
  assert.match(overwrite.stdout, /将覆盖/);
  await writeFile(join(target, "custom.txt"), "old");
  assert.equal(run("--dir", target, "--force").status, 0);
  assert.deepEqual((await readdir(target)).sort(), ["SKILL.md", "reference", "templates"]);
  assert.deepEqual(await readdir(dirname(target)), ["ptp-transplant"]);
});

test("refuses to replace unrelated directory sharing the skill name", async () => {
  const target = join(sandbox, "unrelated", "ptp-transplant");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "keep.txt"), "keep");
  const result = run("--dir", target, "--force");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /拒绝覆盖非 ptp-transplant 安装/);
  assert.equal(await readFile(join(target, "keep.txt"), "utf8"), "keep");
});

test("refuses an unrelated directory even if it has a SKILL.md", async () => {
  const target = join(sandbox, "different-skill", "ptp-transplant");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "SKILL.md"), "---\nname: another-skill\n---\n");
  const result = run("--dir", target, "--force", "--dry-run");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /拒绝覆盖非 ptp-transplant 安装/);
  assert.match(await readFile(join(target, "SKILL.md"), "utf8"), /another-skill/);
});

test("rejects a symbolic-link target without replacing its referent", async () => {
  const destination = join(sandbox, "referent");
  const target = join(sandbox, "symlinks", "ptp-transplant");
  await mkdir(destination);
  await mkdir(dirname(target));
  await writeFile(join(destination, "keep.txt"), "keep");
  await symlink(destination, target, process.platform === "win32" ? "junction" : "dir");
  const result = run("--dir", target, "--force", "--dry-run");
  assert.equal(result.status, 1);
  assert.equal(await readFile(join(destination, "keep.txt"), "utf8"), "keep");
});
