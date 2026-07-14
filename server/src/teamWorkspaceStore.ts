import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type TeamActor = 'you' | 'manager' | 'claude' | 'codex' | 'system';
export type TaskStatus =
  | 'queued'
  | 'awaiting_confirmation'
  | 'running'
  | 'approved'
  | 'needs_attention'
  | 'paused'
  | 'failed';
export type TaskPhase = 'plan' | 'research' | 'build' | 'review' | 'repair' | 'done';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface TeamProject {
  id: string;
  name: string;
  path: string;
  description: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface TeamMessage {
  id: string;
  projectId: string | null;
  taskId?: string;
  actor: TeamActor;
  text: string;
  createdAt: string;
}
export interface TeamHandoff {
  from: 'claude' | 'codex';
  to: 'claude' | 'codex';
  reason: string;
  createdAt: string;
}
export interface TeamTask {
  id: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  phase: TaskPhase;
  activeAgent?: 'claude' | 'codex';
  limitedAgents?: Array<'claude' | 'codex'>;
  priority: TaskPriority;
  dueAt?: string;
  tags: string[];
  archived: boolean;
  retryCount: number;
  handoffs: TeamHandoff[];
  contextSnapshot?: string;
  createdAt: string;
  updatedAt: string;
  plan?: string;
  result?: string;
  checks: string[];
}
export interface TeamWorkspace {
  projects: TeamProject[];
  tasks: TeamTask[];
  messages: TeamMessage[];
}

const EMPTY: TeamWorkspace = { projects: [], tasks: [], messages: [] };
const MAX_MESSAGES = 500;

function filePath() {
  return path.join(os.homedir(), '.pixel-agents', 'team-workspace.json');
}
function save(data: TeamWorkspace) {
  const file = filePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
export function readWorkspace(): TeamWorkspace {
  try {
    const value = JSON.parse(fs.readFileSync(filePath(), 'utf8')) as Partial<TeamWorkspace>;
    return {
      projects: Array.isArray(value.projects) ? value.projects : [],
      tasks: Array.isArray(value.tasks)
        ? value.tasks.map((entry) => {
            const task = entry as Partial<TeamTask>;
            return {
              ...task,
              priority: task.priority ?? 'normal',
              tags: task.tags ?? [],
              archived: task.archived ?? false,
              retryCount: task.retryCount ?? 0,
              handoffs: task.handoffs ?? [],
              checks: task.checks ?? [],
            } as TeamTask;
          })
        : [],
      messages: Array.isArray(value.messages) ? value.messages.slice(-MAX_MESSAGES) : [],
    };
  } catch {
    return { ...EMPTY };
  }
}
export function createProject(input: { name: string; path: string; description?: string }) {
  const data = readWorkspace();
  const now = new Date().toISOString();
  const project: TeamProject = {
    id: crypto.randomUUID(),
    name: input.name.trim().slice(0, 80),
    path: input.path.trim(),
    description: input.description?.trim().slice(0, 500) ?? '',
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  data.projects.push(project);
  save(data);
  return project;
}
export function createTask(input: {
  projectId: string;
  title: string;
  priority?: TaskPriority;
  dueAt?: string;
  tags?: string[];
}) {
  const data = readWorkspace();
  const now = new Date().toISOString();
  const task: TeamTask = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    title: input.title.trim().slice(0, 12000),
    status: 'queued',
    phase: 'plan',
    priority: input.priority ?? 'normal',
    dueAt: input.dueAt,
    tags: (input.tags ?? [])
      .map((tag) => tag.trim().slice(0, 30))
      .filter(Boolean)
      .slice(0, 8),
    archived: false,
    retryCount: 0,
    handoffs: [],
    createdAt: now,
    updatedAt: now,
    checks: [],
  };
  data.tasks.push(task);
  addMessageTo(data, {
    projectId: task.projectId,
    taskId: task.id,
    actor: 'you',
    text: task.title,
  });
  save(data);
  return task;
}
export function addMessage(input: Omit<TeamMessage, 'id' | 'createdAt'>) {
  const data = readWorkspace();
  const message = addMessageTo(data, input);
  save(data);
  return message;
}
function addMessageTo(data: TeamWorkspace, input: Omit<TeamMessage, 'id' | 'createdAt'>) {
  const message: TeamMessage = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...input,
    text: input.text.trim().slice(0, 30000),
  };
  data.messages.push(message);
  data.messages = data.messages.slice(-MAX_MESSAGES);
  return message;
}
export function updateTask(id: string, patch: Partial<TeamTask>) {
  const data = readWorkspace();
  const task = data.tasks.find((entry) => entry.id === id);
  if (!task) return null;
  Object.assign(task, patch, { updatedAt: new Date().toISOString() });
  save(data);
  return task;
}
export function archiveTask(id: string, archived: boolean) {
  return updateTask(id, { archived });
}
export function addTaskMessage(task: TeamTask, actor: TeamActor, text: string) {
  return addMessage({ projectId: task.projectId, taskId: task.id, actor, text });
}
