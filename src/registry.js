import { access, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { createEmptyRegistry, SCHEMA_VERSION } from './constants.js';

export function resolveRegistryPath(explicitPath, environment = process.env) {
  const selected = explicitPath || environment.LOCAL_PROJECT_CLI_REGISTRY;
  return resolve(selected || `${homedir()}/.local-project-cli/registry.json`);
}

export async function loadRegistry(path, { create = true } = {}) {
  try {
    const source = await readFile(path, 'utf8');
    const registry = JSON.parse(source);
    const changed = normalizeRegistry(registry);
    validateRegistry(registry);
    if (changed) await saveRegistry(path, registry);
    return registry;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!create) throw error;
    const registry = createEmptyRegistry();
    await saveRegistry(path, registry);
    return registry;
  }
}

function normalizeRegistry(registry) {
  if (!registry || typeof registry !== 'object') return false;
  let changed = false;
  if (!registry.settings || typeof registry.settings !== 'object') {
    registry.settings = {};
    changed = true;
  }
  if (!registry.settings.defaultOpenerId) {
    registry.settings.defaultOpenerId = 'vscode';
    changed = true;
  }
  if (Object.hasOwn(registry.settings, 'lastOpenerId')) {
    delete registry.settings.lastOpenerId;
    changed = true;
  }
  if (Array.isArray(registry.projects)) {
    for (const project of registry.projects) {
      if (Object.hasOwn(project, 'defaultOpenerId')) {
        delete project.defaultOpenerId;
        changed = true;
      }
    }
  }
  return changed;
}

export async function saveRegistry(path, registry) {
  validateRegistry(registry);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, path);
}

export function validateRegistry(registry) {
  if (!registry || typeof registry !== 'object') throw new Error('注册表必须是 JSON 对象');
  if (registry.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`不支持的 schemaVersion：${registry.schemaVersion ?? '缺失'}`);
  }
  if (!Array.isArray(registry.projects)) throw new Error('projects 必须是数组');
  if (!Array.isArray(registry.openers)) throw new Error('openers 必须是数组');
  if (!registry.settings || typeof registry.settings !== 'object') throw new Error('settings 必须是对象');

  const projectIds = new Set();
  const projectSlugs = new Set();
  const physicalPaths = new Set();
  for (const project of registry.projects) {
    if (!project.id || !project.name || !project.slug || !Array.isArray(project.repositories)) {
      throw new Error('项目缺少 id、name、slug 或 repositories');
    }
    if (projectIds.has(project.id) || projectSlugs.has(project.slug)) throw new Error(`项目重复：${project.name}`);
    projectIds.add(project.id);
    projectSlugs.add(project.slug);
    const repoSlugs = new Set();
    for (const repo of project.repositories) {
      if (!repo.id || !repo.name || !repo.slug || !repo.path) throw new Error(`代码库格式无效：${project.name}`);
      if (repoSlugs.has(repo.slug)) throw new Error(`项目 ${project.name} 中代码库名称重复：${repo.name}`);
      if (physicalPaths.has(repo.path)) throw new Error(`代码库路径重复：${repo.path}`);
      repoSlugs.add(repo.slug);
      physicalPaths.add(repo.path);
    }
  }
  const openerIds = new Set();
  for (const opener of registry.openers) {
    if (!opener.id || !opener.name || !opener.command || !Array.isArray(opener.args)) {
      throw new Error('打开工具缺少 id、name、command 或 args');
    }
    if (opener.mode !== undefined && opener.mode !== 'terminal') {
      throw new Error(`打开工具 mode 无效：${opener.id}`);
    }
    if (openerIds.has(opener.id)) throw new Error(`打开工具 id 重复：${opener.id}`);
    openerIds.add(opener.id);
  }
  if (!registry.settings.defaultOpenerId || !openerIds.has(registry.settings.defaultOpenerId)) {
    throw new Error(`默认打开工具无效：${registry.settings.defaultOpenerId || '未设置'}`);
  }
}

export function toSlug(value) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, '-').replace(/[\\/]+/g, '-');
}

export function addProject(registry, { name, workspacePath } = {}) {
  const trimmedName = name?.trim();
  if (!trimmedName) throw new Error('项目名称不能为空');
  const slug = toSlug(trimmedName);
  if (registry.projects.some((project) => project.slug === slug)) throw new Error(`项目已存在：${trimmedName}`);
  const now = new Date().toISOString();
  const project = {
    id: randomUUID(),
    name: trimmedName,
    slug,
    repositories: [],
    createdAt: now,
    updatedAt: now,
  };
  if (workspacePath) project.workspacePath = resolve(workspacePath);
  registry.projects.push(project);
  return project;
}

export function findProject(registry, reference) {
  const normalized = toSlug(reference || '');
  return registry.projects.find((project) => project.id === reference || project.slug === normalized || project.name === reference);
}

export function findRepository(registry, reference) {
  const normalized = String(reference || '').trim();
  const slash = normalized.indexOf('/');
  if (slash > 0) {
    const project = findProject(registry, normalized.slice(0, slash));
    if (!project) return null;
    const repoRef = normalized.slice(slash + 1);
    const repoSlug = toSlug(repoRef);
    const repository = project.repositories.find((repo) => repo.id === repoRef || repo.slug === repoSlug || repo.name === repoRef);
    return repository ? { project, repository } : null;
  }
  const matches = [];
  const repoSlug = toSlug(normalized);
  for (const project of registry.projects) {
    for (const repository of project.repositories) {
      if (repository.id === normalized || repository.slug === repoSlug || repository.name === normalized) {
        matches.push({ project, repository });
      }
    }
  }
  if (matches.length > 1) throw new Error(`代码库名称不唯一，请使用 project/repo：${reference}`);
  return matches[0] || null;
}

async function existingDirectory(path) {
  const absolutePath = resolve(path);
  await access(absolutePath, fsConstants.R_OK);
  return realpath(absolutePath);
}

export async function addRepository(registry, project, { name, path, openerId, openTarget } = {}) {
  if (!project) throw new Error('请选择项目');
  const physicalPath = await existingDirectory(path || '.');
  const trimmedName = name?.trim();
  if (!trimmedName) throw new Error('代码库名称不能为空');
  const slug = toSlug(trimmedName);
  if (project.repositories.some((repo) => repo.slug === slug)) throw new Error(`代码库名称已存在：${trimmedName}`);
  for (const candidate of registry.projects.flatMap((item) => item.repositories)) {
    if (candidate.path === physicalPath) throw new Error(`该目录已加入索引：${physicalPath}`);
  }
  const now = new Date().toISOString();
  const repository = {
    id: randomUUID(),
    name: trimmedName,
    slug,
    path: physicalPath,
    createdAt: now,
    updatedAt: now,
  };
  if (openerId) repository.lastOpenerId = openerId;
  if (openTarget) repository.openTarget = resolve(physicalPath, openTarget);
  project.repositories.push(repository);
  project.updatedAt = now;
  return repository;
}

export function removeProject(registry, reference) {
  const project = findProject(registry, reference);
  if (!project) throw new Error(`找不到项目：${reference}`);
  registry.projects = registry.projects.filter((item) => item.id !== project.id);
  return project;
}

export function removeRepository(registry, reference) {
  const found = findRepository(registry, reference);
  if (!found) throw new Error(`找不到代码库：${reference}`);
  found.project.repositories = found.project.repositories.filter((item) => item.id !== found.repository.id);
  found.project.updatedAt = new Date().toISOString();
  return found;
}
