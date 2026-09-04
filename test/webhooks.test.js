import test from 'node:test';
import assert from 'node:assert/strict';
import { addProject, addProjectWebhook, removeProjectWebhook, updateProjectWebhook, validateRegistry } from '../src/registry.js';
import { triggerWebhook, validateWebhookUrl } from '../src/webhooks.js';
import { createEmptyRegistry } from '../src/constants.js';

test('project webhooks can be added, updated and removed', () => {
  const registry = createEmptyRegistry();
  const project = addProject(registry, { name: '演示项目' });
  const webhook = addProjectWebhook(registry, project.id, {
    name: '发布测试服',
    url: 'https://ci.example.com/hooks/deploy?token=secret',
  });

  assert.equal(project.webhooks[0].id, webhook.id);
  assert.equal(project.webhooks[0].name, '发布测试服');
  updateProjectWebhook(registry, project.id, webhook.id, { name: '重新发布测试服' });
  assert.equal(project.webhooks[0].name, '重新发布测试服');
  validateRegistry(registry);

  const removed = removeProjectWebhook(registry, project.id, webhook.id);
  assert.equal(removed.id, webhook.id);
  assert.deepEqual(project.webhooks, []);
});

test('project webhook names are unique per project and URLs only allow HTTP(S)', () => {
  const registry = createEmptyRegistry();
  const project = addProject(registry, { name: '演示项目' });
  addProjectWebhook(registry, project.id, { name: '测试服', url: 'https://ci.example.com/trigger' });

  assert.throws(
    () => addProjectWebhook(registry, project.id, { name: ' 测试服 ', url: 'https://ci.example.com/other' }),
    /名称已存在/,
  );
  assert.throws(() => validateWebhookUrl('file:///tmp/trigger'), /只支持 http 或 https/);
  assert.throws(() => validateWebhookUrl('not-a-url'), /格式无效/);
});

test('triggerWebhook sends an empty JSON object and returns the response body', async () => {
  const calls = [];
  const result = await triggerWebhook({ url: 'https://ci.example.com/hooks/deploy' }, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 202,
        statusText: 'Accepted',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => '{"success":true,"message":"pipeline queued"}',
      };
    },
  });

  assert.equal(calls[0].url, 'https://ci.example.com/hooks/deploy');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.headers['content-type'], 'application/json');
  assert.equal(calls[0].options.body, '{}');
  assert.equal(result.ok, true);
  assert.equal(result.status, 202);
  assert.equal(result.contentType, 'application/json');
  assert.equal(result.body, '{"success":true,"message":"pipeline queued"}');
  assert.equal(result.truncated, false);
  assert.ok(result.durationMs >= 0);
});

test('triggerWebhook returns non-success HTTP responses for inspection', async () => {
  const result = await triggerWebhook({ url: 'https://ci.example.com/hooks/deploy' }, {
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => '{"success":false,"message":"invalid request"}',
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.match(result.body, /invalid request/);
});

test('triggerWebhook limits oversized response bodies', async () => {
  const result = await triggerWebhook({ url: 'https://ci.example.com/hooks/deploy' }, {
    fetchImpl: async () => new Response('x'.repeat(70 * 1024), {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    }),
  });

  assert.equal(result.body.length, 64 * 1024);
  assert.equal(result.truncated, true);
});

test('triggerWebhook returns a stable message for network failures', async () => {
  await assert.rejects(
    triggerWebhook({ url: 'https://ci.example.com/hooks/deploy' }, {
      fetchImpl: async () => {
        const error = new TypeError('fetch failed');
        error.cause = { code: 'ECONNREFUSED' };
        throw error;
      },
    }),
    /Webhook 请求失败：ECONNREFUSED/,
  );
});
