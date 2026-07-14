import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { CornerResizeHandle } from './CornerResizeHandle';
import { PanelMoveHandle } from './PanelMoveHandle';

type Actor = 'you' | 'manager' | 'claude' | 'codex' | 'system';
interface Project {
  id: string;
  name: string;
  path: string;
  description: string;
  archived: boolean;
}
interface Handoff {
  from: 'claude' | 'codex';
  to: 'claude' | 'codex';
  reason: string;
  createdAt: string;
}
interface Task {
  id: string;
  projectId: string;
  title: string;
  status: string;
  phase: string;
  activeAgent?: string;
  limitedAgents?: Array<'claude' | 'codex'>;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  dueAt?: string;
  tags?: string[];
  archived?: boolean;
  retryCount?: number;
  handoffs?: Handoff[];
  plan?: string;
  result?: string;
  checks?: string[];
  createdAt: string;
}
interface Message {
  id: string;
  projectId: string | null;
  taskId?: string;
  actor: Actor;
  text: string;
  createdAt: string;
}
interface State {
  projects: Project[];
  tasks: Task[];
  messages: Message[];
}
interface Diagnostic {
  id: string;
  name: string;
  ready: boolean;
  detail: string;
}
interface ProjectPreview {
  status: 'stopped' | 'starting' | 'running' | 'error';
  url?: string;
  detail: string;
}

const initial: State = { projects: [], tasks: [], messages: [] };
const actorNames: Record<Actor, string> = {
  you: 'ВЫ',
  manager: 'МЕНЕДЖЕР',
  claude: 'CLAUDE',
  codex: 'CODEX',
  system: 'СИСТЕМА',
};
const phaseNames: Record<string, string> = {
  plan: 'План',
  research: 'Исследование',
  build: 'Реализация',
  review: 'Ревью',
  repair: 'Исправления',
  done: 'Готово',
};
const statusNames: Record<string, string> = {
  queued: 'В очереди',
  awaiting_confirmation: 'Нужно подтверждение',
  running: 'В работе',
  approved: 'Одобрено',
  needs_attention: 'Нужно внимание',
  paused: 'Приостановлено',
  failed: 'Ошибка',
};
const priorityNames: Record<string, string> = {
  low: 'Низкий',
  normal: 'Обычный',
  high: 'Высокий',
  urgent: 'Срочный',
};

function inlineFormat(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s<>()]+)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**'))
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('`') && part.endsWith('`'))
        return <code key={index}>{part.slice(1, -1)}</code>;
      if (/^https?:\/\//.test(part))
        return (
          <a key={index} href={part} target="_blank" rel="noreferrer">
            {part}
          </a>
        );
      return part;
    });
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="code-block">
      <div>
        <span>КОД</span>
        <button type="button" onClick={() => void copy()}>
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
      <pre>
        <code>{code.trim()}</code>
      </pre>
    </div>
  );
}

function RichMessage({ text }: { text: string }) {
  const chunks = text.split(/```(?:[\w+-]+)?\n?([\s\S]*?)```/g);
  return (
    <div className="rich-message">
      {chunks.map((chunk, index) => {
        if (index % 2 === 1) return <CodeBlock key={index} code={chunk} />;
        return chunk
          .split(/\n{2,}/)
          .filter(Boolean)
          .map((paragraph, paragraphIndex) => {
            const lines = paragraph.split('\n');
            const heading = lines.length === 1 ? lines[0].match(/^(#{1,3})\s+(.+)$/) : null;
            if (heading)
              return <h3 key={`${index}-${paragraphIndex}`}>{inlineFormat(heading[2])}</h3>;
            if (lines.every((line) => /^[-*]\s+/.test(line)))
              return (
                <ul key={`${index}-${paragraphIndex}`}>
                  {lines.map((line, lineIndex) => (
                    <li key={lineIndex}>{inlineFormat(line.replace(/^[-*]\s+/, ''))}</li>
                  ))}
                </ul>
              );
            if (lines.every((line) => /^\d+\.\s+/.test(line)))
              return (
                <ol key={`${index}-${paragraphIndex}`}>
                  {lines.map((line, lineIndex) => (
                    <li key={lineIndex}>{inlineFormat(line.replace(/^\d+\.\s+/, ''))}</li>
                  ))}
                </ol>
              );
            return (
              <p key={`${index}-${paragraphIndex}`}>
                {lines.map((line, lineIndex) => (
                  <span key={lineIndex}>
                    {inlineFormat(line)}
                    {lineIndex < lines.length - 1 && <br />}
                  </span>
                ))}
              </p>
            );
          });
      })}
    </div>
  );
}

export function TeamConsole() {
  const [state, setState] = useState<State>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [task, setTask] = useState('');
  const [name, setName] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');
  const [startingTaskId, setStartingTaskId] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [dueAt, setDueAt] = useState('');
  const [tags, setTags] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [detailsTaskId, setDetailsTaskId] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [textCollapsed, setTextCollapsed] = useState(false);
  const [isBrowsingFolder, setIsBrowsingFolder] = useState(false);
  const [preview, setPreview] = useState<ProjectPreview | null>(null);
  const [isStartingPreview, setIsStartingPreview] = useState(false);
  const [lightTheme, setLightTheme] = useState(
    () => localStorage.getItem('personal-team-light-theme') === 'true',
  );
  const [largeText, setLargeText] = useState(
    () => localStorage.getItem('personal-team-large-text') === 'true',
  );
  const taskInput = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const diagnosticsLastChecked = useRef(0);

  const refresh = async () => {
    try {
      const response = await fetch('/api/team/state');
      if (!response.ok) throw new Error('Сервер команды недоступен.');
      const next = (await response.json()) as State;
      if (Date.now() - diagnosticsLastChecked.current > 15000) {
        const diagnosticsResponse = await fetch('/api/team/diagnostics');
        if (!diagnosticsResponse.ok) throw new Error('Не удалось проверить зависимости команды.');
        const payload = (await diagnosticsResponse.json()) as { diagnostics?: Diagnostic[] };
        setDiagnostics(Array.isArray(payload.diagnostics) ? payload.diagnostics : []);
        diagnosticsLastChecked.current = Date.now();
      }
      setState(next);
      setSelected((current) =>
        current && next.projects.some((project) => project.id === current)
          ? current
          : (next.projects[0]?.id ?? null),
      );
      window.dispatchEvent(new CustomEvent('personal-team-workspace', { detail: next }));
      const currentTask = [...next.tasks]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .find(
          (entry) =>
            entry.status === 'running' ||
            entry.status === 'paused' ||
            entry.status === 'needs_attention',
        );
      window.dispatchEvent(
        new CustomEvent('personal-team-state', {
          detail: {
            activeAgent: currentTask?.status === 'running' ? currentTask.activeAgent : undefined,
            limitedAgents: currentTask?.limitedAgents ?? [],
          },
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось загрузить состояние команды.');
    }
  };

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!selected) {
      setPreview(null);
      return;
    }
    let active = true;
    const refreshPreview = async () => {
      try {
        const response = await fetch(`/api/team/projects/${selected}/preview`);
        if (!response.ok) return;
        const next = (await response.json()) as ProjectPreview;
        if (active) setPreview(next);
      } catch {
        // Main diagnostics show server errors.
      }
    };
    void refreshPreview();
    const id = window.setInterval(() => void refreshPreview(), 2500);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [selected]);

  const project = state.projects.find((entry) => entry.id === selected) ?? null;
  const messages = useMemo(
    () => state.messages.filter((entry) => entry.projectId === selected),
    [selected, state.messages],
  );
  const tasks = useMemo(
    () =>
      state.tasks
        .filter((entry) => entry.projectId === selected)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [selected, state.tasks],
  );
  const visibleTasks = tasks.filter((entry) => showArchived || !entry.archived);
  const detailsTask = tasks.find((entry) => entry.id === detailsTaskId) ?? null;
  const activeTask = tasks.find(
    (entry) =>
      entry.status === 'running' || entry.status === 'paused' || entry.status === 'needs_attention',
  );
  const phaseOrder = ['plan', 'research', 'build', 'review', 'repair', 'done'];
  const phaseIndex = activeTask ? phaseOrder.indexOf(activeTask.phase) : -1;
  const progress = activeTask
    ? activeTask.status === 'paused'
      ? Math.max(8, ((Math.max(0, phaseIndex) + 0.5) / 5) * 100)
      : Math.max(8, ((Math.max(0, phaseIndex) + 1) / 5) * 100)
    : 0;
  const taskProblems = tasks.filter((item) =>
    ['failed', 'needs_attention', 'paused', 'awaiting_confirmation'].includes(item.status),
  );
  const unavailableDiagnostics = diagnostics.filter((item) => !item.ready);
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [messages.length, selected]);
  useEffect(() => {
    if (!selected) return;
    setTask(localStorage.getItem(`personal-team-draft:${selected}`) ?? '');
  }, [selected]);
  useEffect(() => {
    if (selected) localStorage.setItem(`personal-team-draft:${selected}`, task);
  }, [selected, task]);
  useEffect(() => {
    localStorage.setItem('personal-team-light-theme', String(lightTheme));
  }, [lightTheme]);
  useEffect(() => {
    localStorage.setItem('personal-team-large-text', String(largeText));
  }, [largeText]);
  const post = async <T,>(url: string, body?: unknown): Promise<T> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Запрос не выполнен.');
    await refresh();
    return data;
  };
  const createProject = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await post('/api/team/projects', { name, path: projectPath });
      setName('');
      setProjectPath('');
      setShowNew(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось создать проект.');
    }
  };
  const browseProjectFolder = async () => {
    setIsBrowsingFolder(true);
    try {
      if (window.pixelAgentsDesktop) {
        const selectedPath = await window.pixelAgentsDesktop.chooseProjectFolder();
        if (selectedPath) setProjectPath(selectedPath);
        return;
      }
      const response = await fetch('/api/team/browse-folder', { method: 'POST' });
      const data = (await response.json()) as { path?: string | null; error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Не удалось открыть выбор папки.');
      if (data.path) setProjectPath(data.path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось открыть выбор папки.');
    } finally {
      setIsBrowsingFolder(false);
    }
  };
  const startPreview = async () => {
    if (!selected) return;
    setIsStartingPreview(true);
    setError('');
    try {
      const next = await post<ProjectPreview>(`/api/team/projects/${selected}/preview`);
      setPreview(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось запустить локальный проект.');
    } finally {
      setIsStartingPreview(false);
    }
  };
  const stopPreview = async () => {
    if (!selected) return;
    try {
      const response = await fetch(`/api/team/projects/${selected}/preview`, { method: 'DELETE' });
      const next = (await response.json()) as ProjectPreview & { error?: string };
      if (!response.ok) throw new Error(next.error ?? 'Не удалось остановить локальный проект.');
      setPreview(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось остановить локальный проект.');
    }
  };
  const clearTeamStatus = async () => {
    try {
      const response = await fetch('/api/team/status/clear', { method: 'POST' });
      const data = (await response.json()) as { cleared?: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Не удалось очистить статус команды.');
      setError('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось очистить статус команды.');
    }
  };
  const deleteProject = async (projectToDelete: Project) => {
    const confirmed = window.confirm(
      `Удалить «${projectToDelete.name}» из Personal Team?\n\nБудут удалены задачи и история этого проекта. Папка проекта на диске останется без изменений.`,
    );
    if (!confirmed) return;
    try {
      const response = await fetch(`/api/team/projects/${projectToDelete.id}`, {
        method: 'DELETE',
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Не удалось удалить проект.');
      if (selected === projectToDelete.id) setSelected(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось удалить проект.');
    }
  };
  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !task.trim()) return;
    try {
      const created = await post<{ task: Task; started: boolean }>('/api/team/tasks', {
        projectId: selected,
        title: task,
        priority,
        dueAt: dueAt || undefined,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      setTask('');
      setPriority('normal');
      setDueAt('');
      setTags('');
      setShowOptions(false);
      if (!created.started) await startTask(created.task.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось поставить задачу в очередь.');
    }
  };
  const startTask = async (taskId: string) => {
    setStartingTaskId(taskId);
    setError('');
    window.dispatchEvent(
      new CustomEvent('personal-team-state', {
        detail: { activeAgent: 'claude', limitedAgents: [] },
      }),
    );
    try {
      await post(`/api/team/tasks/${taskId}/start`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Не удалось запустить задачу.';
      if (message.includes('Подтвердите') && window.confirm(`${message}\n\nЗапустить задачу?`)) {
        try {
          await post(`/api/team/tasks/${taskId}/start`, { confirmed: true });
        } catch (retryCause) {
          setError(
            retryCause instanceof Error ? retryCause.message : 'Не удалось запустить задачу.',
          );
        }
      } else {
        setError(message);
      }
    } finally {
      setStartingTaskId(null);
    }
  };
  const archive = async (taskId: string, archived: boolean) => {
    try {
      const response = await fetch(`/api/team/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      });
      if (!response.ok) throw new Error('Не удалось изменить архив задачи.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось изменить архив задачи.');
    }
  };
  const insertFormat = (before: string, after = before, fallback = 'текст') => {
    const input = taskInput.current;
    if (!input) return;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selectedText = task.slice(start, end) || fallback;
    const next = `${task.slice(0, start)}${before}${selectedText}${after}${task.slice(end)}`;
    setTask(next);
    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + before.length, start + before.length + selectedText.length);
    });
  };
  const agentLabel = tasks.find((entry) => entry.status === 'running')?.activeAgent;

  return (
    <aside
      ref={panelRef}
      className={`team-console modern-chat ${lightTheme ? 'light-theme' : ''} ${largeText ? 'large-text' : ''} ${textCollapsed ? 'text-collapsed' : ''}`}
      aria-label="Персональная команда агентов"
    >
      <header className="team-console-head">
        <PanelMoveHandle targetRef={panelRef} label="Переместить окно команды" />
        <div>
          <span>МОЯ КОМАНДА</span>
          <strong>Проекты, память и запуски</strong>
        </div>
        <div className="team-console-actions">
          <button
            onClick={() => setLargeText((value) => !value)}
            title="Увеличить или уменьшить текст"
          >
            A+
          </button>
          <button onClick={() => setLightTheme((value) => !value)} title="Сменить тему">
            ◐
          </button>
          <button onClick={() => void refresh()} title="Обновить статусы">
            ↻
          </button>
          <button
            type="button"
            onClick={() => void clearTeamStatus()}
            title="Очистить остановленные и ошибочные статусы команды"
            aria-label="Очистить статус команды"
          >
            ⌫
          </button>
          <button
            onClick={() => setTextCollapsed((value) => !value)}
            title={textCollapsed ? 'Развернуть текстовые панели' : 'Скрыть текстовые панели'}
            aria-label={textCollapsed ? 'Развернуть текстовые панели' : 'Скрыть текстовые панели'}
          >
            {textCollapsed ? '▾' : '▴'}
          </button>
          <button onClick={() => setShowNew((value) => !value)} title="Добавить проект">
            +
          </button>
        </div>
      </header>
      {showNew && !textCollapsed && (
        <form className="project-form" onSubmit={createProject}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Название проекта"
            required
          />
          <div className="project-path-picker">
            <input
              value={projectPath}
              onChange={(event) => setProjectPath(event.target.value)}
              placeholder="Путь к папке проекта"
              required
            />
            <button
              type="button"
              onClick={() => void browseProjectFolder()}
              disabled={isBrowsingFolder}
              title="Выбрать файл внутри проекта"
            >
              {isBrowsingFolder ? '…' : 'Обзор'}
            </button>
          </div>
          <button type="submit">Добавить</button>
        </form>
      )}
      {!textCollapsed && (
        <div className="team-console-body">
          <nav className="project-list">
            {state.projects.length === 0 ? (
              <p>Добавьте первый проект, чтобы создать постоянное рабочее пространство команды.</p>
            ) : (
              state.projects
                .filter((item) => !item.archived)
                .map((item) => (
                  <div
                    key={item.id}
                    className={`project-list-item ${item.id === selected ? 'selected' : ''}`}
                  >
                    <button onClick={() => setSelected(item.id)} className="project-select">
                      <strong>{item.name}</strong>
                      <small>{item.path}</small>
                    </button>
                    <button
                      type="button"
                      className="project-delete"
                      onClick={() => void deleteProject(item)}
                      title={`Удалить ${item.name} из списка проектов`}
                      aria-label={`Удалить ${item.name} из списка проектов`}
                    >
                      ×
                    </button>
                  </div>
                ))
            )}
          </nav>
          <section className="team-workspace">
            {project ? (
              <>
                <div className="project-title">
                  <div>
                    <strong>{project.name}</strong>
                    <small>{project.path}</small>
                  </div>
                  <div className="project-actions">
                    {preview?.url ? (
                      <a href={preview.url} target="_blank" rel="noreferrer" title={preview.detail}>
                        Открыть сайт
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void startPreview()}
                        disabled={isStartingPreview}
                      >
                        {isStartingPreview || preview?.status === 'starting'
                          ? 'Запуск...'
                          : 'Запустить сайт'}
                      </button>
                    )}
                    {preview?.status === 'running' && (
                      <button
                        type="button"
                        className="preview-stop"
                        onClick={() => void stopPreview()}
                        title="Остановить сайт"
                      >
                        ■
                      </button>
                    )}
                    <span>
                      {agentLabel === 'claude'
                        ? 'Claude'
                        : agentLabel === 'codex'
                          ? 'Codex'
                          : 'Готова'}
                    </span>
                  </div>
                </div>
                {preview?.status === 'error' && <p className="preview-error">{preview.detail}</p>}
                {activeTask && (
                  <div className="workflow-strip" aria-label="Этапы текущей задачи">
                    <div
                      className="workflow-progress"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(progress)}
                    >
                      <span style={{ width: `${progress}%` }} />
                    </div>
                    {phaseOrder.slice(0, 5).map((phase, index) => (
                      <span key={phase} className={index <= phaseIndex ? 'complete' : ''}>
                        {phaseNames[phase]}
                      </span>
                    ))}
                  </div>
                )}
                {(taskProblems.length > 0 || unavailableDiagnostics.length > 0) && (
                  <section className="team-problems" aria-live="polite">
                    <header>
                      <strong>Ошибки и готовность</strong>
                      <span>{taskProblems.length + unavailableDiagnostics.length}</span>
                    </header>
                    {unavailableDiagnostics.map((item) => (
                      <article key={item.id}>
                        <strong>{item.name} недоступен</strong>
                        <p>{item.detail}</p>
                      </article>
                    ))}
                    {taskProblems.map((item) => (
                      <article key={item.id}>
                        <strong>{item.title}</strong>
                        <p>{item.result ?? statusNames[item.status] ?? item.status}</p>
                      </article>
                    ))}
                  </section>
                )}
                <div ref={feedRef} className="team-feed">
                  {messages.length === 0 ? (
                    <p className="empty">
                      Опишите желаемый результат. Сначала команда составит письменный план, и только
                      потом изменит код.
                    </p>
                  ) : (
                    messages.map((message) => (
                      <article key={message.id} className={`team-message ${message.actor}`}>
                        <small>{actorNames[message.actor]}</small>
                        <RichMessage text={message.text} />
                      </article>
                    ))
                  )}
                </div>
                <form className="team-composer" onSubmit={createTask}>
                  <div className="composer-input">
                    <div className="format-toolbar">
                      <button type="button" title="Жирный текст" onClick={() => insertFormat('**')}>
                        B
                      </button>
                      <button type="button" title="Код" onClick={() => insertFormat('`')}>
                        {'</>'}
                      </button>
                      <button
                        type="button"
                        title="Блок кода"
                        onClick={() => insertFormat('```\n', '\n```', 'код')}
                      >
                        {'{ }'}
                      </button>
                      <button
                        type="button"
                        title="Список"
                        onClick={() => insertFormat('- ', '', 'пункт списка')}
                      >
                        -
                      </button>
                      <button
                        type="button"
                        className="clear-draft"
                        title="Очистить черновик"
                        onClick={() => setTask('')}
                      >
                        ×
                      </button>
                      <button
                        type="button"
                        className="task-options-toggle"
                        title="Параметры задачи"
                        onClick={() => setShowOptions((value) => !value)}
                      >
                        ☷
                      </button>
                    </div>
                    {showOptions && (
                      <div className="task-options">
                        <label>
                          Приоритет
                          <select
                            value={priority}
                            onChange={(event) => setPriority(event.target.value as typeof priority)}
                          >
                            <option value="low">Низкий</option>
                            <option value="normal">Обычный</option>
                            <option value="high">Высокий</option>
                            <option value="urgent">Срочный</option>
                          </select>
                        </label>
                        <label>
                          Срок
                          <input
                            type="date"
                            value={dueAt}
                            onChange={(event) => setDueAt(event.target.value)}
                          />
                        </label>
                        <label>
                          Теги
                          <input
                            value={tags}
                            onChange={(event) => setTags(event.target.value)}
                            placeholder="дизайн, тесты"
                          />
                        </label>
                      </div>
                    )}
                    <textarea
                      ref={taskInput}
                      value={task}
                      onChange={(event) => setTask(event.target.value)}
                      placeholder="Опишите, какой результат нужен..."
                    />
                    <small className="draft-state">
                      Черновик сохраняется автоматически · {task.length} символов
                    </small>
                  </div>
                  <button type="submit" disabled={!task.trim() || !selected}>
                    Создать задачу
                  </button>
                </form>
                <div className="task-list-head">
                  <strong>Задачи</strong>
                  <button type="button" onClick={() => setShowArchived((value) => !value)}>
                    {showArchived ? 'Скрыть архив' : 'Архив'}
                  </button>
                </div>
                <div className="task-list">
                  {visibleTasks.map((item) => (
                    <div key={item.id} className={`task-row priority-${item.priority ?? 'normal'}`}>
                      <span className={`task-status ${item.status}`}>
                        {phaseNames[item.phase] ?? item.phase}
                      </span>
                      <p>
                        <strong>{item.title}</strong>
                        <small>
                          {priorityNames[item.priority ?? 'normal']}
                          {item.dueAt
                            ? ` · до ${new Date(item.dueAt).toLocaleDateString('ru-RU')}`
                            : ''}
                          {item.tags?.length ? ` · #${item.tags.join(' #')}` : ''}
                        </small>
                      </p>
                      <small>{statusNames[item.status] ?? item.status}</small>
                      <button
                        type="button"
                        title="Открыть отчёт"
                        onClick={() => setDetailsTaskId(item.id)}
                      >
                        i
                      </button>
                      {[
                        'queued',
                        'awaiting_confirmation',
                        'paused',
                        'needs_attention',
                        'failed',
                      ].includes(item.status) && (
                        <button
                          type="button"
                          disabled={startingTaskId === item.id}
                          onClick={() => void startTask(item.id)}
                        >
                          {startingTaskId === item.id
                            ? '…'
                            : item.status === 'queued'
                              ? 'Запуск'
                              : 'Продолжить'}
                        </button>
                      )}
                      <button
                        type="button"
                        title={item.archived ? 'Вернуть из архива' : 'Архивировать'}
                        onClick={() => void archive(item.id, !item.archived)}
                      >
                        {item.archived ? '↶' : '⌫'}
                      </button>
                    </div>
                  ))}
                </div>
                {detailsTask && (
                  <section className="task-details">
                    <header>
                      <div>
                        <span>ОТЧЁТ ЗАДАЧИ</span>
                        <strong>{detailsTask.title}</strong>
                      </div>
                      <button type="button" onClick={() => setDetailsTaskId(null)}>
                        ×
                      </button>
                    </header>
                    <div>
                      <h3>Статус</h3>
                      <p>
                        {statusNames[detailsTask.status] ?? detailsTask.status} ·{' '}
                        {phaseNames[detailsTask.phase] ?? detailsTask.phase}
                      </p>
                      {detailsTask.plan && (
                        <>
                          <h3>План</h3>
                          <RichMessage text={detailsTask.plan} />
                        </>
                      )}
                      {detailsTask.result && (
                        <>
                          <h3>Результат</h3>
                          <RichMessage text={detailsTask.result} />
                        </>
                      )}
                      {detailsTask.handoffs?.length ? (
                        <>
                          <h3>Передача работы</h3>
                          <ul>
                            {detailsTask.handoffs.map((handoff, index) => (
                              <li key={index}>
                                {handoff.from === 'claude' ? 'Cloudy' : 'CodeX'} →{' '}
                                {handoff.to === 'claude' ? 'Cloudy' : 'CodeX'}: {handoff.reason}
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                      {detailsTask.checks?.length ? (
                        <>
                          <h3>Проверки</h3>
                          <ul>
                            {detailsTask.checks.map((check, index) => (
                              <li key={index}>{check}</li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                    </div>
                  </section>
                )}
              </>
            ) : (
              <div className="no-project">
                Создайте или выберите проект. Его чат, решения, задачи и отчёты сохраняются после
                перезапуска.
              </div>
            )}
          </section>
        </div>
      )}
      {error && <p className="team-error">{error}</p>}
      {!textCollapsed && (
        <CornerResizeHandle
          targetRef={panelRef}
          anchoredTo="right"
          label="Изменить размер окна команды"
        />
      )}
    </aside>
  );
}
