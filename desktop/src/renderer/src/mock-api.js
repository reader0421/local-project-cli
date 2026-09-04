const now = new Date().toISOString();
const scanListeners = new Set();

const registry = {
  schemaVersion: 1,
  projects: [{
    id: 'local-project',
    name: 'Local Project',
    slug: 'local-project',
    webhooks: [
      { id: 'deploy-test', name: '发布测试服', url: 'https://ci.example.com/hooks/deploy-test', createdAt: now, updatedAt: now },
      { id: 'rebuild-docs', name: '重新构建文档', url: 'https://ci.example.com/hooks/rebuild-docs', createdAt: now, updatedAt: now },
    ],
    repositories: [
      { id: 'local-project-cli', name: 'local-project-cli', slug: 'local-project-cli', path: '/Users/demo/Projects/Local Project/local-project-cli', createdAt: now, updatedAt: now },
      { id: 'local-project-desktop', name: 'local-project-desktop', slug: 'local-project-desktop', path: '/Users/demo/Projects/Local Project/local-project-desktop', defaultOpenerId: 'vscode', createdAt: now, updatedAt: now },
      { id: 'docs-site', name: 'docs-site', slug: 'docs-site', path: '/Users/demo/Projects/Local Project/docs-site', createdAt: now, updatedAt: now },
    ],
    createdAt: now,
    updatedAt: now,
  }, {
    id: 'sample-workspace',
    name: 'Sample Workspace',
    slug: 'sample-workspace',
    webhooks: [],
    repositories: [
      { id: 'sample-app', name: 'sample-app', slug: 'sample-app', path: '/Users/demo/Projects/Sample Workspace/sample-app', createdAt: now, updatedAt: now },
    ],
    createdAt: now,
    updatedAt: now,
  }],
  openers: [
    { id: 'vscode', name: 'Visual Studio Code', command: 'open', args: ['-a', 'Visual Studio Code', '{path}'] },
    { id: 'phpstorm', name: 'PhpStorm', command: 'open', args: ['-a', 'PhpStorm', '{path}'] },
    { id: 'finder', name: 'Finder', command: 'open', args: ['{path}'] },
    { id: 'codex-cli', name: 'Codex CLI', command: 'codex', args: ['-C', '{path}'], mode: 'terminal' },
  ],
  settings: { defaultOpenerId: 'vscode' },
};

function gitStatus(path, overrides = {}) {
  const lastCommit = overrides.lastCommit || { hash: 'd4e5f6a', authoredAt: '2026-08-27T01:15:00.000Z', author: 'Local Developer', subject: 'feat: 实现项目-代码库分栏视图' };
  return {
    kind: 'git',
    path,
    branch: 'main',
    oid: 'd4e5f6a',
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    detached: false,
    changes: [],
    dirty: false,
    lastCommit,
    recentCommits: overrides.recentCommits || [lastCommit],
    upstreamCommit: { hash: 'c3b2a1d', authoredAt: '2026-08-26T08:20:00.000Z', author: 'Remote Developer', subject: 'refactor: 优化状态栏组件结构' },
    unpushedCommits: [],
    remoteCommits: [],
    operation: null,
    ...overrides,
  };
}

function entries() {
  return structuredClone(registry.projects).map((project) => ({
    project,
    repositories: project.repositories.map((repository) => {
      if (repository.id === 'local-project-desktop') {
        return {
          repository,
          status: gitStatus(repository.path, {
            branch: 'feature/electron',
            upstream: 'origin/feature/electron',
            ahead: 2,
            changes: [
              { code: '.M', path: 'src/views/RepoListView.tsx' },
              { code: '.M', path: 'src/components/RepoRow.tsx' },
              { code: '??', path: 'package.json' },
            ],
            dirty: true,
            unpushedCommits: [
              { hash: 'd4e5f6a', subject: 'feat: 实现项目-代码库分栏视图' },
              { hash: 'c3b2a1d', subject: 'refactor: 优化状态栏组件结构' },
            ],
          }),
        };
      }
      return { repository, status: gitStatus(repository.path, { lastCommit: { hash: 'a1b2c3d', authoredAt: '2026-08-26T06:00:00.000Z', author: 'Local Developer', subject: repository.id === 'docs-site' ? 'docs: 更新功能说明文档' : 'docs: 更新命令行使用示例' } }) };
    }),
  }));
}

function response(result = null) {
  return { result, registry: structuredClone(registry), registryPath: '/Users/demo/.local-project-cli/registry.json', schemaVersion: 1, desktopVersion: '0.1.1', platform: 'darwin' };
}

export const mockApi = {
  getState: async () => response(),
  startScan: async () => {
    const resultEntries = entries();
    const repositories = resultEntries.flatMap((entry) => entry.repositories.map((item) => ({ project: entry.project, ...item })));
    for (const [index, item] of repositories.entries()) {
      await new Promise((resolve) => window.setTimeout(resolve, 140));
      for (const listener of scanListeners) listener({
        completed: index + 1,
        total: repositories.length,
        project: item.project,
        repository: item.repository,
        status: item.status,
      });
    }
    return { sequence: 1, entries: resultEntries };
  },
  onScanProgress: (listener) => {
    scanListeners.add(listener);
    return () => scanListeners.delete(listener);
  },
  addProject: async (input) => {
    registry.projects.push({ id: crypto.randomUUID(), slug: input.name.toLowerCase().replaceAll(' ', '-'), repositories: [], createdAt: now, updatedAt: now, ...input });
    return response();
  },
  updateProject: async (id, changes) => {
    Object.assign(registry.projects.find((project) => project.id === id), changes);
    return response();
  },
  removeProject: async (id) => {
    registry.projects = registry.projects.filter((project) => project.id !== id);
    return response();
  },
  addProjectWebhook: async (projectId, input) => {
    const project = registry.projects.find((item) => item.id === projectId);
    const webhook = { id: crypto.randomUUID(), ...input, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    project.webhooks ||= [];
    project.webhooks.push(webhook);
    return response(webhook);
  },
  updateProjectWebhook: async (projectId, id, changes) => {
    const project = registry.projects.find((item) => item.id === projectId);
    Object.assign(project.webhooks.find((item) => item.id === id), changes, { updatedAt: new Date().toISOString() });
    return response();
  },
  removeProjectWebhook: async (projectId, id) => {
    const project = registry.projects.find((item) => item.id === projectId);
    project.webhooks = (project.webhooks || []).filter((item) => item.id !== id);
    return response();
  },
  triggerProjectWebhook: async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    contentType: 'application/json; charset=utf-8',
    body: '{"success":true,"message":"Pipeline run created","pipelineRunId":1024}',
    truncated: false,
    durationMs: 86,
  }),
  addRepository: async ({ projectId, name, path, ...rest }) => {
    const project = registry.projects.find((item) => item.id === projectId);
    const { openerId, ...repositoryFields } = rest;
    project.repositories.push({
      id: crypto.randomUUID(),
      name,
      slug: name.toLowerCase(),
      path,
      createdAt: now,
      updatedAt: now,
      ...repositoryFields,
      ...(openerId ? { defaultOpenerId: openerId } : {}),
    });
    return response();
  },
  updateRepository: async (id, changes) => {
    for (const project of registry.projects) {
      const repository = project.repositories.find((item) => item.id === id);
      if (!repository) continue;
      const { defaultOpenerId, ...otherChanges } = changes;
      Object.assign(repository, otherChanges);
      if (defaultOpenerId === null || defaultOpenerId === '') delete repository.defaultOpenerId;
      else if (defaultOpenerId !== undefined) repository.defaultOpenerId = defaultOpenerId;
    }
    return response();
  },
  removeRepository: async (id) => {
    for (const project of registry.projects) project.repositories = project.repositories.filter((repository) => repository.id !== id);
    return response();
  },
  addOpener: async (input) => { registry.openers.push(input); return response(); },
  updateOpener: async (id, changes) => { Object.assign(registry.openers.find((item) => item.id === id), changes); return response(); },
  removeOpener: async (id) => { registry.openers = registry.openers.filter((item) => item.id !== id); return response(); },
  setDefaultOpener: async (id) => { registry.settings.defaultOpenerId = id; return response(); },
  openRepository: async (_id, openerId) => response({ openerId: openerId || 'vscode', openerName: 'Visual Studio Code' }),
  showRepository: async () => true,
  copyRepositoryPath: async () => '/Users/demo/Projects/Local Project/local-project-desktop',
  fetchRepository: async () => true,
  pushRepository: async () => true,
  pullRepository: async () => true,
  chooseDirectory: async () => '/Users/demo/Projects/new-repository',
  chooseRegistry: async () => response(),
  showRegistry: async () => true,
  copyRegistryPath: async () => '/Users/demo/.local-project-cli/registry.json',
};
