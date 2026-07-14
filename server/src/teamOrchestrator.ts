import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';

import { projectPreviewManager } from './projectPreview.js';
import {
  addTaskMessage,
  readWorkspace,
  type TeamProject,
  type TeamTask,
  updateTask,
} from './teamWorkspaceStore.js';

const LIMIT_PATTERN =
  /rate limit|usage limit|session limit|quota|too many requests|credit balance|limit reached/i;
const TRANSIENT_PATTERN =
  /econnreset|etimedout|network error|socket hang up|temporarily unavailable|service unavailable|502|503|504/i;

export interface TeamDiagnostic {
  id: string;
  name: string;
  ready: boolean;
  detail: string;
}

export function getTeamDiagnostics(): TeamDiagnostic[] {
  const commands: Array<Pick<TeamDiagnostic, 'id' | 'name'> & { command: string }> = [
    { id: 'claude', name: 'Claude Code', command: 'claude.cmd' },
    { id: 'codex', name: 'Codex', command: 'codex.cmd' },
    { id: 'node', name: 'Node.js', command: 'node.exe' },
    { id: 'npm', name: 'npm', command: 'npm.cmd' },
  ];
  return commands.map(({ id, name, command }) => {
    const result = spawnSync(command, ['--version'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      windowsHide: true,
      timeout: 8000,
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    if (!result.error && result.status === 0)
      return { id, name, ready: true, detail: output.split(/\r?\n/)[0] || 'Доступен.' };
    return {
      id,
      name,
      ready: false,
      detail:
        output.slice(-600) ||
        result.error?.message ||
        `Команда ${command} завершилась с кодом ${result.status ?? 'unknown'}.`,
    };
  });
}

export class TeamOrchestrator {
  private running = new Set<string>();

  recoverInterruptedTasks(): void {
    for (const task of readWorkspace().tasks) {
      if (task.status !== 'running') continue;
      const paused = updateTask(task.id, { status: 'paused', activeAgent: undefined }) ?? task;
      addTaskMessage(
        paused,
        'manager',
        'Сервер был перезапущен во время выполнения. Задача сохранена и ожидает продолжения.',
      );
    }
  }

  start(task: TeamTask, project: TeamProject): boolean {
    if (this.running.has(task.id)) return false;
    this.running.add(task.id);
    const resumeWithCodex =
      task.limitedAgents?.includes('claude') && !task.limitedAgents?.includes('codex');
    void (
      resumeWithCodex
        ? this.continueWithSingleAgent(task, project, 'codex')
        : this.run(task, project)
    ).finally(() => this.running.delete(task.id));
    return true;
  }

  private async run(task: TeamTask, project: TeamProject) {
    if (!fs.existsSync(project.path))
      return this.finish(
        task,
        'failed',
        'Папка проекта не существует. Проверьте путь к проекту и запустите задачу снова.',
      );
    let current =
      updateTask(task.id, {
        status: 'running',
        phase: 'plan',
        activeAgent: 'claude',
        limitedAgents: [],
        result: undefined,
      }) ?? task;
    addTaskMessage(
      current,
      'manager',
      'Сначала формирую технический план, и только затем команда начнёт менять код.',
    );
    const plan = await this.agent('claude', project.path, this.prompt('plan', current, project));
    if (!plan.ok && plan.limited) return this.fallback(current, project, 'plan', 'codex');
    if (!plan.ok) return this.finish(current, 'failed', plan.output);
    current =
      updateTask(current.id, { plan: plan.output, phase: 'research', activeAgent: 'claude' }) ??
      current;
    addTaskMessage(current, 'claude', plan.output);

    const research = await this.agent(
      'claude',
      project.path,
      this.prompt('research', current, project),
    );
    if (!research.ok && research.limited)
      return this.fallback(current, project, 'research', 'codex');
    if (!research.ok) return this.finish(current, 'failed', research.output);
    addTaskMessage(current, 'claude', research.output);

    current = updateTask(current.id, { phase: 'build', activeAgent: 'claude' }) ?? current;
    const build = await this.agent('claude', project.path, this.prompt('build', current, project));
    if (!build.ok && build.limited) return this.fallback(current, project, 'build', 'codex');
    if (!build.ok) return this.finish(current, 'failed', build.output);
    addTaskMessage(current, 'claude', build.output);

    current = this.handoff(
      updateTask(current.id, { phase: 'review', activeAgent: 'codex' }) ?? current,
      'claude',
      'codex',
      'Реализация передана на независимое ревью.',
    );
    const review = await this.agent('codex', project.path, this.prompt('review', current, project));
    if (!review.ok && review.limited) return this.fallback(current, project, 'review', 'claude');
    if (!review.ok) return this.finish(current, 'needs_attention', review.output);
    addTaskMessage(current, 'codex', review.output);
    return this.finish(
      current,
      'approved',
      'Реализация и независимое ревью завершены. Подробные отчёты сохранены в этом чате.',
    );
  }

  private async fallback(
    task: TeamTask,
    project: TeamProject,
    phase: TeamTask['phase'],
    agent: 'claude' | 'codex',
  ) {
    const limitedAgent: 'claude' | 'codex' = agent === 'claude' ? 'codex' : 'claude';
    const limitedAgents: Array<'claude' | 'codex'> = [
      ...new Set([...(task.limitedAgents ?? []), limitedAgent]),
    ];
    let current = this.handoff(
      updateTask(task.id, {
        phase,
        activeAgent: agent,
        limitedAgents,
        contextSnapshot: `Этап ${phase}; план: ${task.plan ?? 'не создан'}; лимит второго агента.`,
      }) ?? task,
      limitedAgent,
      agent,
      'Лимит исчерпан, работа передана резервному агенту.',
    );
    addTaskMessage(
      current,
      'manager',
      `${agent === 'claude' ? 'Claude' : 'Codex'} продолжает работу, потому что у второго агента закончился лимит. Контекст задачи сохранён.`,
    );
    const result = await this.agent(agent, project.path, this.prompt(phase, current, project));
    if (!result.ok)
      return this.finish(current, result.limited ? 'paused' : 'needs_attention', result.output);
    current = updateTask(current.id, phase === 'plan' ? { plan: result.output } : {}) ?? current;
    addTaskMessage(current, agent, result.output);
    if (agent === 'codex') return this.continueWithSingleAgent(current, project, 'codex');
    return this.finish(
      current,
      'needs_attention',
      'Резервный агент завершил свой этап. Когда второй агент снова станет доступен, требуется независимое финальное ревью.',
    );
  }

  private async continueWithSingleAgent(
    task: TeamTask,
    project: TeamProject,
    agent: 'claude' | 'codex',
  ) {
    let current =
      updateTask(task.id, { status: 'running', phase: 'build', activeAgent: agent }) ?? task;
    addTaskMessage(
      current,
      'manager',
      `${agent === 'codex' ? 'CodeX' : 'Cloudy'} продолжает оставшиеся этапы задачи, пока второй агент недоступен.`,
    );
    const build = await this.agent(agent, project.path, this.prompt('build', current, project));
    if (!build.ok)
      return this.finish(current, build.limited ? 'paused' : 'needs_attention', build.output);
    addTaskMessage(current, agent, build.output);
    return this.finish(
      current,
      'needs_attention',
      'Один агент завершил реализацию. Финальное независимое ревью будет выполнено, когда второй агент снова станет доступен.',
    );
  }

  private handoff(
    task: TeamTask,
    from: 'claude' | 'codex',
    to: 'claude' | 'codex',
    reason: string,
  ) {
    return (
      updateTask(task.id, {
        handoffs: [
          ...(task.handoffs ?? []),
          { from, to, reason, createdAt: new Date().toISOString() },
        ],
      }) ?? task
    );
  }
  private finish(task: TeamTask, status: TeamTask['status'], result: string) {
    const updated =
      updateTask(task.id, {
        status,
        phase: 'done',
        activeAgent: undefined,
        result,
        checks: [
          ...(task.checks ?? []),
          `Статус: ${status}. Оркестрация завершена ${new Date().toLocaleString('ru-RU')}.`,
        ],
      }) ?? task;
    addTaskMessage(updated, 'manager', result);
    if (status === 'approved') {
      const project = readWorkspace().projects.find((entry) => entry.id === updated.projectId);
      if (project)
        void projectPreviewManager
          .start(project)
          .then((preview) =>
            addTaskMessage(
              updated,
              'manager',
              `Предпросмотр проекта запущен: ${preview.url ?? 'URL не получен.'}`,
            ),
          )
          .catch((error) =>
            addTaskMessage(
              updated,
              'manager',
              `Не удалось запустить предпросмотр: ${error instanceof Error ? error.message : 'неизвестная ошибка.'}`,
            ),
          );
      void this.startNextTask();
    }
  }
  /** Start the next safe task after a completed task or server restart. */
  startNextTask() {
    const state = readWorkspace();
    const priority = { urgent: 0, high: 1, normal: 2, low: 3 };
    const next = state.tasks
      .filter(
        (task) => task.status === 'queued' && !task.archived && !requiresConfirmation(task.title),
      )
      .sort(
        (a, b) =>
          priority[a.priority] - priority[b.priority] || a.createdAt.localeCompare(b.createdAt),
      )[0];
    const project = next && state.projects.find((entry) => entry.id === next.projectId);
    if (next && project) this.start(next, project);
  }
  private prompt(stage: string, task: TeamTask, project: TeamProject) {
    return `Ты работаешь в персональной команде разработки.\nПроект: ${project.name}\nПуть: ${project.path}\nЗадача: ${task.title}\nТекущий план: ${task.plan ?? 'ещё не создан'}\nЭтап: ${stage}\nВсегда отвечай исключительно на русском языке, независимо от языка задачи, файлов или сообщения пользователя. Не переводи код, команды, пути, имена файлов и API-идентификаторы.\nПрочитай инструкции проекта и текущее состояние git. Сохраняй несвязанную работу пользователя.\n${stage === 'plan' ? 'Не изменяй файлы. Составь компактный технический план, критерии приёмки, риски и проверки.' : ''}\n${stage === 'research' ? 'Не изменяй файлы. Найди относящиеся к задаче файлы, ограничения и опиши краткий способ реализации.' : ''}\n${stage === 'build' ? 'Аккуратно реализуй задачу. Запусти подходящие проверки. В конце укажи, что изменено и что проверено.' : ''}\n${stage === 'review' ? 'Независимо проверь реализацию. Где возможно, запусти проверки. Исправляй только небольшие очевидные дефекты, в остальных случаях сообщай конкретные замечания. В конце напиши ОДОБРЕНО или ТРЕБУЮТСЯ_ИЗМЕНЕНИЯ.' : ''}`;
  }
  private async agent(
    agent: 'claude' | 'codex',
    cwd: string,
    prompt: string,
  ): Promise<{ ok: boolean; limited: boolean; output: string }> {
    const first = await this.runAgentCommand(agent, cwd, prompt);
    if (first.ok || first.limited || !TRANSIENT_PATTERN.test(first.output)) return first;
    const retry = await this.runAgentCommand(agent, cwd, prompt);
    return {
      ...retry,
      output: `Первая попытка была повторена из-за временной ошибки.\n\n${retry.output}`,
    };
  }
  private runAgentCommand(
    agent: 'claude' | 'codex',
    cwd: string,
    prompt: string,
  ): Promise<{ ok: boolean; limited: boolean; output: string }> {
    const command = agent === 'claude' ? 'claude.cmd' : 'codex.cmd';
    const args =
      agent === 'claude'
        ? ['-p', '--permission-mode', 'acceptEdits', '--setting-sources', 'project,local']
        : [
            '--ask-for-approval',
            'never',
            'exec',
            '--cd',
            cwd,
            '--sandbox',
            'workspace-write',
            '--skip-git-repo-check',
          ];
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd,
        windowsHide: true,
        shell: process.platform === 'win32',
      });
      let output = '';
      child.stdout.on('data', (data) => {
        output += data;
      });
      child.stderr.on('data', (data) => {
        output += data;
      });
      child.on('error', (error) => resolve({ ok: false, limited: false, output: error.message }));
      child.on('close', (code) => {
        const text = output.trim() || `Агент завершился с кодом ${code}.`;
        resolve({ ok: code === 0, limited: LIMIT_PATTERN.test(text), output: text.slice(-30000) });
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });
  }
}

function requiresConfirmation(title: string): boolean {
  return /\b(rm\s+-rf|remove-item|del\s+\/|drop\s+(table|database)|truncate\s+table|format\s+[a-z]:|delete\s+from|production deploy|deploy to prod)\b/i.test(
    title,
  );
}
