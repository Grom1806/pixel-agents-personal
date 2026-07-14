import { type ChildProcess, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import type { TeamProject } from './teamWorkspaceStore.js';

export interface ProjectPreview {
  status: 'stopped' | 'starting' | 'running' | 'error';
  url?: string;
  detail: string;
}

interface PreviewEntry extends ProjectPreview {
  process?: ChildProcess;
}

export class ProjectPreviewManager {
  private readonly entries = new Map<string, PreviewEntry>();

  get(projectId: string): ProjectPreview {
    const entry = this.entries.get(projectId);
    return entry
      ? { status: entry.status, url: entry.url, detail: entry.detail }
      : { status: 'stopped', detail: 'Предпросмотр не запущен.' };
  }

  async start(project: TeamProject): Promise<ProjectPreview> {
    const existing = this.entries.get(project.id);
    if (existing?.status === 'running' || existing?.status === 'starting')
      return this.get(project.id);
    if (!fs.existsSync(project.path)) throw new Error('Папка проекта не существует.');

    const manifestPath = path.join(project.path, 'package.json');
    if (!fs.existsSync(manifestPath))
      throw new Error('В проекте нет package.json. Команде нечего запускать.');

    let manifest: { scripts?: Record<string, unknown> };
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        scripts?: Record<string, unknown>;
      };
    } catch {
      throw new Error('Не удалось прочитать package.json проекта.');
    }
    const script =
      typeof manifest.scripts?.dev === 'string'
        ? 'dev'
        : typeof manifest.scripts?.start === 'string'
          ? 'start'
          : null;
    if (!script) throw new Error('В package.json нет скрипта dev или start.');

    this.entries.set(project.id, {
      status: 'starting',
      detail: 'Подготавливаю зависимости и локальный сервер.',
    });
    if (!fs.existsSync(path.join(project.path, 'node_modules')))
      await this.runNpm(project.path, ['install'], 'Не удалось установить зависимости проекта.');

    return new Promise<ProjectPreview>((resolve, reject) => {
      const child = spawn(this.npmCommand(), ['run', script, '--', '--host', '127.0.0.1'], {
        cwd: project.path,
        shell: process.platform === 'win32',
        windowsHide: true,
      });
      const entry: PreviewEntry = {
        status: 'starting',
        detail: `Запускаю npm run ${script}.`,
        process: child,
      };
      this.entries.set(project.id, entry);
      let output = '';
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback();
      };
      const inspect = (chunk: Buffer | string) => {
        output = `${output}${chunk.toString()}`.slice(-6000);
        const match = output.match(
          /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)(?:\/[^\s]*)?/i,
        );
        if (!match) return;
        entry.status = 'running';
        entry.url = `http://127.0.0.1:${match[1]}`;
        entry.detail = 'Локальный сервер готов.';
        finish(() => resolve(this.get(project.id)));
      };
      const timeout = setTimeout(() => {
        entry.status = 'error';
        entry.detail = `Сервер не сообщил локальный URL за 30 секунд.\n${output.slice(-1000)}`;
        finish(() => reject(new Error(entry.detail)));
      }, 30000);
      child.stdout?.on('data', inspect);
      child.stderr?.on('data', inspect);
      child.on('error', (error) => {
        entry.status = 'error';
        entry.detail = error.message;
        finish(() => reject(error));
      });
      child.on('close', (code) => {
        if (settled) return;
        entry.status = 'error';
        entry.detail = output.trim() || `Локальный сервер завершился с кодом ${code ?? 'unknown'}.`;
        finish(() => reject(new Error(entry.detail)));
      });
    });
  }

  stop(projectId: string): ProjectPreview {
    const entry = this.entries.get(projectId);
    if (entry?.process?.pid) {
      if (process.platform === 'win32')
        spawnSync('taskkill.exe', ['/pid', String(entry.process.pid), '/t', '/f'], {
          windowsHide: true,
        });
      else entry.process.kill('SIGTERM');
    }
    this.entries.set(projectId, { status: 'stopped', detail: 'Предпросмотр остановлен.' });
    return this.get(projectId);
  }

  private npmCommand() {
    return process.platform === 'win32' ? 'npm.cmd' : 'npm';
  }

  private runNpm(cwd: string, args: string[], failureMessage: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.npmCommand(), args, {
        cwd,
        shell: process.platform === 'win32',
        windowsHide: true,
      });
      let output = '';
      child.stdout?.on('data', (data) => (output += data));
      child.stderr?.on('data', (data) => (output += data));
      child.on('error', (error) => reject(error));
      child.on('close', (code) => {
        if (code === 0) return resolve();
        reject(new Error(`${failureMessage}\n${output.slice(-2000)}`));
      });
    });
  }
}

export const projectPreviewManager = new ProjectPreviewManager();
