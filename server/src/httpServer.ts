import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import type { AssetCache, SetHooksEnabledSideEffect } from './clientMessageHandler.js';
import { handleClientMessage } from './clientMessageHandler.js';
import { HOOK_API_PREFIX, MAX_HOOK_BODY_SIZE } from './constants.js';
import { projectPreviewManager } from './projectPreview.js';
import { getTeamDiagnostics, TeamOrchestrator } from './teamOrchestrator.js';
import {
  archiveTask,
  clearInactiveTeamStatuses,
  createProject,
  createTask,
  deleteProject,
  readWorkspace,
  type TaskPriority,
  updateTask,
} from './teamWorkspaceStore.js';
import type { AgentState } from './types.js';

/** Options for creating the HTTP + WebSocket server. */
export interface HttpServerOptions {
  /** true = VS Code embedded mode (ephemeral port, no static, quiet logging) */
  embedded: boolean;
  /** Host to bind to. Default: '127.0.0.1' */
  host?: string;
  /** Port to listen on. Default: 0 (auto-assign) */
  port?: number;
  /** Bearer auth token for hook and WebSocket endpoints */
  token: string;
  /** AgentStateStore for WebSocket broadcast piping */
  store: AgentStateStore;
  /** Shared agent lifecycle core (for toggle side effects + standalone restore). Optional in embedded mode. */
  runtime?: AgentRuntime;
  /** Path to SPA dist directory for static serving (standalone only) */
  staticDir?: string;
  /** Cached assets loaded at startup (standalone only) */
  assetCache?: AssetCache;
  /** Callback when a hook event is received */
  onHookEvent?: (providerId: string, event: Record<string, unknown>) => void;
  /** Invoked when setHooksEnabled is toggled via WebSocket. Standalone installs/uninstalls hooks here. */
  onSetHooksEnabled?: SetHooksEnabledSideEffect;
  orchestrator?: TeamOrchestrator;
}

/** Result of createHttpServer(). */
export interface HttpServerHandle {
  app: FastifyInstance;
  port: number;
}

const startTime = Date.now();

/**
 * Create a Fastify server with hook endpoint, health check, and WebSocket support.
 *
 * All Fastify-specific code lives in this file. The rest of the server layer is
 * framework-agnostic. If Fastify is ever replaced, only this file changes.
 */
export async function createHttpServer(options: HttpServerOptions): Promise<HttpServerHandle> {
  const app = Fastify({
    logger: !options.embedded,
    bodyLimit: MAX_HOOK_BODY_SIZE,
  });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  // Static SPA serving (standalone mode only)
  if (!options.embedded && options.staticDir) {
    await app.register(fastifyStatic, {
      root: options.staticDir,
      prefix: '/',
    });
    // HTML5 history fallback: serve index.html for unmatched routes
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html');
    });
  }

  // ── Routes ──────────────────────────────────────────────────

  registerHealthRoute(app);
  registerTeamRoutes(app, options.orchestrator ?? new TeamOrchestrator());
  registerHookRoute(app, options);
  registerWebSocketRoute(app, options);

  // ── Listen ──────────────────────────────────────────────────

  await app.listen({ host: options.host ?? '127.0.0.1', port: options.port ?? 0 });
  const address = app.server.address();
  const port = typeof address === 'object' ? (address?.port ?? 0) : 0;

  return { app, port };
}

// ── Health ──────────────────────────────────────────────────────

function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    pid: process.pid,
  }));
}

function registerTeamRoutes(app: FastifyInstance, orchestrator: TeamOrchestrator): void {
  app.get('/api/team/state', async () => readWorkspace());
  app.get('/api/team/diagnostics', async () => ({ diagnostics: getTeamDiagnostics() }));
  app.post('/api/team/status/clear', async () => ({
    cleared: clearInactiveTeamStatuses(),
  }));
  app.get<{ Params: { id: string } }>('/api/team/projects/:id/preview', async (request, reply) => {
    const project = readWorkspace().projects.find((entry) => entry.id === request.params.id);
    if (!project) return reply.code(404).send({ error: 'Проект не найден.' });
    return projectPreviewManager.get(project.id);
  });
  app.post<{ Params: { id: string } }>('/api/team/projects/:id/preview', async (request, reply) => {
    const project = readWorkspace().projects.find((entry) => entry.id === request.params.id);
    if (!project) return reply.code(404).send({ error: 'Проект не найден.' });
    try {
      return await projectPreviewManager.start(project);
    } catch (error) {
      return reply.code(422).send({
        error: error instanceof Error ? error.message : 'Не удалось запустить локальный проект.',
      });
    }
  });
  app.delete<{ Params: { id: string } }>(
    '/api/team/projects/:id/preview',
    async (request, reply) => {
      const project = readWorkspace().projects.find((entry) => entry.id === request.params.id);
      if (!project) return reply.code(404).send({ error: 'Проект не найден.' });
      return projectPreviewManager.stop(project.id);
    },
  );
  app.post('/api/team/browse-folder', async (_request, reply) => {
    try {
      return { path: await chooseProjectFolder() };
    } catch (error) {
      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Не удалось открыть выбор папки.',
      });
    }
  });
  app.post<{ Body: { name?: unknown; path?: unknown; description?: unknown } }>(
    '/api/team/projects',
    async (request, reply) => {
      const name = typeof request.body?.name === 'string' ? request.body.name : '';
      const projectPath = typeof request.body?.path === 'string' ? request.body.path : '';
      if (!name.trim() || !projectPath.trim())
        return reply.code(400).send({ error: 'Укажите название проекта и путь к его папке.' });
      return {
        project: createProject({
          name,
          path: projectPath,
          description:
            typeof request.body?.description === 'string' ? request.body.description : '',
        }),
      };
    },
  );
  app.delete<{ Params: { id: string } }>('/api/team/projects/:id', async (request, reply) => {
    const project = deleteProject(request.params.id);
    if (!project) return reply.code(404).send({ error: 'Project not found.' });
    return { project };
  });
  app.post<{
    Body: {
      projectId?: unknown;
      title?: unknown;
      priority?: unknown;
      dueAt?: unknown;
      tags?: unknown;
    };
  }>('/api/team/tasks', async (request, reply) => {
    const projectId = typeof request.body?.projectId === 'string' ? request.body.projectId : '';
    const title = typeof request.body?.title === 'string' ? request.body.title : '';
    const priorities: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
    const priority = priorities.includes(request.body?.priority as TaskPriority)
      ? (request.body?.priority as TaskPriority)
      : 'normal';
    const dueAt =
      typeof request.body?.dueAt === 'string' && !Number.isNaN(Date.parse(request.body.dueAt))
        ? request.body.dueAt
        : undefined;
    const tags = Array.isArray(request.body?.tags)
      ? request.body.tags.filter((tag): tag is string => typeof tag === 'string')
      : [];
    if (!projectId || !title.trim())
      return reply.code(400).send({ error: 'Выберите проект и опишите задачу.' });
    const task = createTask({ projectId, title, priority, dueAt, tags });
    const project = readWorkspace().projects.find((entry) => entry.id === task.projectId);

    // Normal requests start immediately. Potentially destructive commands still wait for
    // an explicit confirmation in the UI before any agent is launched.
    const started = Boolean(
      project && !needsConfirmation(task.title) && orchestrator.start(task, project),
    );
    return { task, started };
  });
  app.patch<{
    Params: { id: string };
    Body: { archived?: unknown; priority?: unknown; dueAt?: unknown; tags?: unknown };
  }>('/api/team/tasks/:id', async (request, reply) => {
    const current = readWorkspace().tasks.find((task) => task.id === request.params.id);
    if (!current) return reply.code(404).send({ error: 'Задача не найдена.' });
    if (typeof request.body?.archived === 'boolean')
      return { task: archiveTask(current.id, request.body.archived) };
    const priorities: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
    const priority = priorities.includes(request.body?.priority as TaskPriority)
      ? (request.body?.priority as TaskPriority)
      : current.priority;
    const dueAt =
      typeof request.body?.dueAt === 'string' && !Number.isNaN(Date.parse(request.body.dueAt))
        ? request.body.dueAt
        : current.dueAt;
    const tags = Array.isArray(request.body?.tags)
      ? request.body.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 8)
      : current.tags;
    return { task: updateTask(current.id, { priority, dueAt, tags }) };
  });
  app.post<{ Params: { id: string }; Body: { confirmed?: unknown } }>(
    '/api/team/tasks/:id/start',
    async (request, reply) => {
      const state = readWorkspace();
      const task = state.tasks.find((entry) => entry.id === request.params.id);
      const project = task && state.projects.find((entry) => entry.id === task.projectId);
      if (!task || !project)
        return reply.code(404).send({ error: 'Задача или проект не найдены.' });
      if (task.archived)
        return reply.code(409).send({ error: 'Архивную задачу нельзя запускать.' });
      if (needsConfirmation(task.title) && request.body?.confirmed !== true) {
        updateTask(task.id, { status: 'awaiting_confirmation', activeAgent: undefined });
        return reply.code(428).send({
          error: 'Задача может менять или удалять важные данные. Подтвердите запуск.',
          requiresConfirmation: true,
        });
      }
      if (!orchestrator.start(task, project))
        return reply.code(409).send({ error: 'Эта задача уже выполняется.' });
      return { started: true };
    },
  );
}

function chooseProjectFolder(): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const selectionFile = path.join(os.tmpdir(), `pixel-agents-folder-${crypto.randomUUID()}.txt`);
  const escapedSelectionFile = selectionFile.replace(/'/g, "''");
  const dialogScript = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = 'Выберите папку проекта'",
    `$selectionFile = '${escapedSelectionFile}'`,
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [System.IO.File]::WriteAllText($selectionFile, $dialog.SelectedPath, [System.Text.UTF8Encoding]::new($false)) }',
  ].join('; ');
  const encodedDialogScript = Buffer.from(dialogScript, 'utf16le').toString('base64');
  const launcherScript = [
    '$encoded = ' + `'${encodedDialogScript}'`,
    'Start-Process -FilePath \'powershell.exe\' -ArgumentList "-NoProfile -STA -EncodedCommand $encoded" -Wait -WindowStyle Normal',
  ].join('; ');
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', launcherScript],
      {
        windowsHide: true,
      },
    );
    let errors = '';
    child.stderr.on('data', (chunk) => (errors += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        if (code !== 0)
          return reject(new Error(errors.trim() || 'Диалог выбора папки завершился с ошибкой.'));
        resolve(
          fs.existsSync(selectionFile)
            ? fs.readFileSync(selectionFile, 'utf8').trim() || null
            : null,
        );
      } finally {
        fs.rmSync(selectionFile, { force: true });
      }
    });
  });
}

function needsConfirmation(title: string): boolean {
  return /\b(rm\s+-rf|remove-item|del\s+\/|drop\s+(table|database)|truncate\s+table|format\s+[a-z]:|delete\s+from|production deploy|deploy to prod)\b/i.test(
    title,
  );
}

// ── Hook Events ────────────────────────────────────────────────

function registerHookRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.post<{
    Params: { providerId: string };
    Body: Record<string, unknown>;
  }>(
    `${HOOK_API_PREFIX}/:providerId`,
    {
      preHandler: bearerAuth(options.token),
      schema: {
        params: {
          type: 'object',
          properties: {
            providerId: { type: 'string', pattern: '^[a-z0-9-]+$' },
          },
          required: ['providerId'],
        },
      },
    },
    async (request, reply) => {
      const { providerId } = request.params;
      const event = request.body;

      if (event.session_id && event.hook_event_name) {
        options.onHookEvent?.(providerId, event);
      }

      reply.send('ok');
    },
  );
}

// ── WebSocket ──────────────────────────────────────────────────

function registerWebSocketRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.get('/ws', { websocket: true }, (socket, request) => {
    // In standalone mode (not embedded), skip auth for WebSocket connections.
    // The server binds to 127.0.0.1, so only local clients can connect.
    // In embedded mode (VS Code), require Bearer token for security.
    if (options.embedded) {
      const auth = request.headers.authorization ?? '';
      const expected = `Bearer ${options.token}`;
      const authBuf = Buffer.from(auth);
      const expectedBuf = Buffer.from(expected);
      if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
        socket.close(4001, 'unauthorized');
        return;
      }
    }

    const { store } = options;

    // Pipe store events to WebSocket client
    const onAgentAdded = (id: number, agent: AgentState) => {
      safeSend(socket, {
        type: 'agentCreated',
        id,
        folderName: agent.folderName,
        isExternal: agent.isExternal || undefined,
        isTeammate: agent.leadAgentId !== undefined || undefined,
        teammateName: agent.agentName,
        parentAgentId: agent.leadAgentId,
        teamName: agent.teamName,
        hooksOnly: agent.hooksOnly || undefined,
      });
    };

    const onAgentRemoved = (id: number) => {
      safeSend(socket, { type: 'agentClosed', id });
    };

    const onBroadcast = (message: Record<string, unknown>) => {
      safeSend(socket, message);
    };

    store.on('agentAdded', onAgentAdded);
    store.on('agentRemoved', onAgentRemoved);
    store.on('broadcast', onBroadcast);

    // Handle incoming client messages
    socket.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (!options.embedded && msg.type) {
          console.log('[Pixel Agents] WS client message:', msg.type);
        }
        handleClientMessage(msg, (m) => safeSend(socket, m), {
          store,
          runtime: options.runtime,
          cache: options.assetCache ?? null,
          onSetHooksEnabled: options.onSetHooksEnabled,
        });
      } catch {
        // Malformed JSON, ignore
      }
    });

    socket.on('close', () => {
      store.off('agentAdded', onAgentAdded);
      store.off('agentRemoved', onAgentRemoved);
      store.off('broadcast', onBroadcast);
    });
  });
}

// ── Auth Helper ────────────────────────────────────────────────

function bearerAuth(expectedToken: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.headers.authorization ?? '';
    const expected = `Bearer ${expectedToken}`;
    const authBuf = Buffer.from(auth);
    const expectedBuf = Buffer.from(expected);
    if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
      reply.code(401).send('unauthorized');
    }
  };
}

// ── Utilities ──────────────────────────────────────────────────

function safeSend(
  socket: { send: (data: string) => void; readyState: number },
  message: Record<string, unknown>,
): void {
  // WebSocket.OPEN = 1
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}
