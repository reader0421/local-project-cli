// 先 pnpm build，再用 Electron 运行本文件。所有数据和 opener 输出只写临时目录。
import { app, BrowserWindow, dialog, nativeImage, Tray } from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { createEmptyRegistry } from '../../src/constants.js';
import { addProject, addRepository, addProjectWebhook, saveRegistry } from '../../src/registry.js';
import { UsageStore } from '../src/main/usage-store.js';

async function smoke() {
  const root = await mkdtemp(join(tmpdir(), 'localproject-usage-smoke-'));
  app.setPath('userData', root);
  const registryPath = join(root, 'registry.json');
  process.env.LOCAL_PROJECT_CLI_REGISTRY = registryPath;
  const registry = createEmptyRegistry();
  const a = addProject(registry, { name: '验证项目 A' });
  const b = addProject(registry, { name: '验证项目 B' });
  const r1 = await addRepository(registry, a, { name: '验证 Repo A', path: root });
  const r2 = await addRepository(registry, b, { name: '验证 Repo B', path: tmpdir() });
  const marker = join(root, 'opened.txt');
  registry.openers.push({ id: 'smoke', name: '验证打开工具', command: '/bin/sh', args: ['-c', 'printf "%s" "$1" > "$2"', 'smoke', '{path}', marker] });
  r1.defaultOpenerId = 'smoke';
  r1.openTarget = join(root, '示例.code-workspace');
  await writeFile(r1.openTarget, '{}');
  r1.commands = [{ id: 'test-command', name: '验证失败计数', command: 'true' }];
  const server = createServer((_request, response) => { response.writeHead(200); response.end('{}'); });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const webhook = addProjectWebhook(registry, a.id, { name: '本机验证', url: `http://127.0.0.1:${server.address().port}` });
  await saveRegistry(registryPath, registry);
  const usage = new UsageStore(join(root, 'usage'));
  await usage.record(registryPath, b.id, r2.id);
  let tray;
  let menu;
  const originalTooltip = Tray.prototype.setToolTip;
  Tray.prototype.setToolTip = function (...args) { tray = this; return originalTooltip.apply(this, args); };
  Tray.prototype.popUpContextMenu = function (value) { menu = value; };
  dialog.showErrorBox = (title, message) => { throw new Error(`${title}: ${message}`); };
  const until = async (action) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await action()) return;
      await new Promise((done) => setTimeout(done, 50));
    }
    throw new Error('等待验证状态超时');
  };
  let window;
  let exitCode = 0;
  const evaluate = (source) => window.webContents.executeJavaScript(source);
  const projectNames = () => evaluate("Array.from(document.querySelectorAll('.project-list strong'), el => el.textContent)");
  const currentRepo = () => evaluate("document.querySelector('.repo-title h1')?.textContent");
  const readUsage = async () => JSON.parse(await readFile(join(root, 'usage', (await readdir(join(root, 'usage'))).find((name) => name.endsWith('.json'))), 'utf8'));
  try {
    await import('../out/main/index.js');
    await until(() => { window = BrowserWindow.getAllWindows()[0]; return window && tray && !window.webContents.isLoading(); });
    await until(async () => (await currentRepo()) === '验证 Repo B');
    assert.deepEqual(await projectNames(), ['验证项目 B', '验证项目 A']);
    await evaluate("Array.from(document.querySelectorAll('.project-list button')).find(el => el.textContent.includes('验证项目 A')).click()");
    await until(async () => (await readUsage()).recent.length === 2);
    // 根目录缺失使命令在打开终端前失败，确认失败尝试仍计数且不启动用户终端。
    const originalPath = r1.path;
    r1.path = join(root, 'missing-command-directory');
    await saveRegistry(registryPath, registry);
    await assert.rejects(evaluate(`window.localProject.runRepositoryCommand(${JSON.stringify(r1.id)}, 'test-command')`));
    r1.path = originalPath;
    await saveRegistry(registryPath, registry);
    // 真正请求本机测试服务，验证 webhook 只增加项目次数。
    const response = await evaluate(`window.localProject.triggerProjectWebhook(${JSON.stringify(a.id)}, ${JSON.stringify(webhook.id)})`);
    assert.equal(response.status, 200);
    let data = await readUsage();
    assert.equal(Object.values(data.days)[0].projects[a.id], 3);
    assert.equal(data.recent.length, 3);
    assert.deepEqual(await projectNames(), ['验证项目 B', '验证项目 A']);
    tray.emit('click');
    await until(() => menu);
    assert.equal(menu.items[1].label, '验证项目 A / 验证 Repo A');
    await evaluate("document.querySelector('[aria-label=\"更多操作\"]').click()");
    window.minimize();
    await menu.items[1].click();
    await until(async () => (await readUsage()).recent.length === 4);
    assert.ok(window.isVisible());
    assert.ok(!window.isMinimized());
    await until(async () => (await readFile(marker, 'utf8').catch(() => '')) === r1.openTarget);
    assert.equal(await currentRepo(), '验证 Repo A');
    assert.equal(await evaluate("document.querySelectorAll('[role=\"dialog\"]').length"), 0);
    window.close();
    await until(() => BrowserWindow.getAllWindows().length === 0);
    assert.ok(!tray.isDestroyed());
    await menu.items[1].click();
    await until(() => { window = BrowserWindow.getAllWindows()[0]; return window && !window.webContents.isLoading(); });
    await until(async () => (await currentRepo()) === '验证 Repo A');
    await until(async () => (await readUsage()).recent.length === 5);
    assert.deepEqual(await projectNames(), ['验证项目 B', '验证项目 A']);
    assert.deepEqual((await new UsageStore(join(root, 'usage')).projectOrder(registryPath, registry.projects)), [a.id, b.id]);
    const icon = nativeImage.createFromPath(resolve(import.meta.dirname, '../resources/TrayTemplate.png'));
    assert.ok(!icon.isEmpty());
    const pixels = icon.toBitmap();
    const original = nativeImage.createFromPath(resolve(import.meta.dirname, '../resources/TraySource.png')).toBitmap();
    assert.equal(pixels.length, original.length);
    let transparent = 0;
    let opaque = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] === 0) transparent += 1;
      if (pixels[i] >= 240) opaque += 1;
      if (pixels[i] !== original[i]) throw new Error('反色不得改变源图透明通道');
    }
    assert.ok(transparent > pixels.length / 4 * 0.2, '图标必须有透明背景与镂空');
    assert.ok(opaque > pixels.length / 4 * 0.1, '图标必须有可见前景');
    console.log('PASS: Electron 启动排序、详情/命令/Webhook 计数、菜单栏刷新、最小化恢复、关闭重建、默认 opener/openTarget、重启重排、透明图标');
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    server.closeAllConnections();
    server.close();
    for (const item of BrowserWindow.getAllWindows()) item.destroy();
    tray?.destroy();
    await rm(root, { recursive: true, force: true });
    app.exit(exitCode);
  }
}

smoke().catch((error) => { console.error(error); app.exit(1); });
