import { fetchRepository, getGitStatus } from './git.js';

async function runWithConcurrency(items, concurrency, worker) {
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  }
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}

export async function scanRegistry(registry, {
  fetch = false,
  projects = registry.projects,
  concurrency = 6,
  onProgress,
  getStatus = getGitStatus,
  fetchStatus = fetchRepository,
} = {}) {
  const tasks = projects.flatMap((project, projectIndex) => (
    project.repositories.map((repository, repositoryIndex) => ({
      projectIndex,
      repositoryIndex,
      repository,
    }))
  ));
  const results = projects.map((project) => ({
    project,
    repositories: Array(project.repositories.length),
  }));
  let completed = 0;
  onProgress?.({ completed, total: tasks.length });
  await runWithConcurrency(tasks, concurrency, async ({ projectIndex, repositoryIndex, repository }) => {
    let fetchError;
    if (fetch) {
      try { await fetchStatus(repository.path); } catch (error) { fetchError = String(error.message || error); }
    }
    let status;
    try {
      status = await getStatus(repository.path);
    } catch (error) {
      status = { kind: 'error', path: repository.path, error: error.message };
    }
    if (fetchError) status = { ...status, fetchError };
    results[projectIndex].repositories[repositoryIndex] = { repository, status };
    completed += 1;
    onProgress?.({
      completed,
      total: tasks.length,
      project: projects[projectIndex],
      repository,
      status,
      projectIndex,
      repositoryIndex,
    });
  });
  return results;
}
