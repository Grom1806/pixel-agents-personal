import { useEffect, useMemo, useRef, useState } from 'react';

import { CornerResizeHandle } from './CornerResizeHandle';
import { PanelMoveHandle } from './PanelMoveHandle';

type Provider = 'claude' | 'codex';
interface Task {
  id: string;
  status: string;
  phase: string;
  activeAgent?: Provider;
  limitedAgents?: Provider[];
  createdAt: string;
}
interface Message {
  taskId?: string;
  actor: Provider | 'manager' | 'you' | 'system';
  text: string;
  createdAt: string;
}
interface TeamState {
  tasks: Task[];
  messages: Message[];
}
const emptyState: TeamState = { tasks: [], messages: [] };

function activityFor(provider: Provider, task: Task | undefined): string {
  if (!task) return 'Ожидает новую задачу.';
  if (task.limitedAgents?.includes(provider)) return 'Пауза: лимит исчерпан, отдыхает на диване.';
  if (task.activeAgent === provider) {
    if (task.phase === 'plan') return 'Формирует технический план.';
    if (task.phase === 'research') return 'Изучает проект и ограничения.';
    if (task.phase === 'build') return 'Реализует изменения и проверяет результат.';
    if (task.phase === 'review') return 'Проводит независимое ревью и запускает проверки.';
    if (task.phase === 'repair') return 'Исправляет найденные замечания.';
  }
  if (task.status === 'paused') return 'Ожидает, пока работа команды возобновится.';
  if (provider === 'claude' && task.phase === 'review') return 'Ожидает независимое ревью CodeX.';
  if (provider === 'codex' && ['plan', 'research', 'build'].includes(task.phase))
    return 'Готовится принять работу на проверку.';
  return 'Ожидает следующий этап задачи.';
}

function latestReport(provider: Provider, messages: Message[], task?: Task): string | null {
  const message = [...messages]
    .reverse()
    .find((entry) => entry.actor === provider && (!task || entry.taskId === task.id));
  return message ? message.text.replace(/\s+/g, ' ').slice(0, 112) : null;
}

export function AgentActivityPanel() {
  const [state, setState] = useState<TeamState>(emptyState);
  const [collapsed, setCollapsed] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const refresh = async () => {
      try {
        const response = await fetch('/api/team/state');
        if (response.ok) setState((await response.json()) as TeamState);
      } catch {
        /* Main panel shows connection errors. */
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const sync = (event: Event) => setState((event as CustomEvent<TeamState>).detail);
    window.addEventListener('personal-team-workspace', sync);
    return () => window.removeEventListener('personal-team-workspace', sync);
  }, []);
  const task = useMemo(
    () =>
      [...state.tasks]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .find(
          (entry) =>
            entry.status === 'running' ||
            entry.status === 'paused' ||
            entry.status === 'needs_attention',
        ),
    [state.tasks],
  );
  const members: Array<{ provider: Provider; name: string }> = [
    { provider: 'claude', name: 'Cloudy' },
    { provider: 'codex', name: 'CodeX' },
  ];
  return (
    <aside ref={panelRef} className="agent-activity-panel" aria-label="Действия агентов">
      <header>
        <PanelMoveHandle targetRef={panelRef} label="Переместить статус команды" />
        <div>
          <span>СТАТУС КОМАНДЫ</span>
          <strong>{task ? 'Текущая работа' : 'Готова к новой задаче'}</strong>
        </div>
        <button
          type="button"
          className="agent-activity-collapse"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? 'Развернуть статус команды' : 'Свернуть статус команды'}
          title={collapsed ? 'Развернуть статус команды' : 'Свернуть статус команды'}
        >
          {collapsed ? '▾' : '▴'}
        </button>
      </header>
      {!collapsed && (
        <div className="agent-activity-list">
          {members.map(({ provider, name }) => {
            const paused = task?.limitedAgents?.includes(provider) ?? false;
            const report = latestReport(provider, state.messages, task);
            return (
              <article
                key={provider}
                className={`agent-activity ${paused ? 'paused' : task?.activeAgent === provider ? 'active' : ''}`}
              >
                <div>
                  <strong>{name}</strong>
                  <span>
                    {paused ? 'ПАУЗА' : task?.activeAgent === provider ? 'РАБОТАЕТ' : 'ГОТОВ'}
                  </span>
                </div>
                <p>{activityFor(provider, task)}</p>
                {report && <small>{report}</small>}
              </article>
            );
          })}
        </div>
      )}
      <CornerResizeHandle
        targetRef={panelRef}
        anchoredTo="left"
        label="Изменить размер статуса команды"
      />
    </aside>
  );
}
