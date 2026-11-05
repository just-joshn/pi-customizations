// Cursor Projects: a coordinator chat with a persistent home, a tracker and a store every agent shares, and related chats
// added as context for every agent in it. Here a Project is a folder of the workspace (`projects/<slug>/`: notes.md,
// store/, project.json); a chat joins one with /project, and the subagents it starts belong to it too.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { childIdentity } from './child-env.ts';
import { projectsDir } from './paths.ts';

export const PROJECT_ENTRY = 'pstack-project';
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface ProjectChat {
  sessionFile: string;
  addedAt: string;
  title: string;
}

export interface Project {
  slug: string;
  name: string;
  createdAt: string;
  chats: ProjectChat[];
}

export const projectSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63) || 'project';

const projectFile = (cwd: string, slug: string) => join(projectsDir(cwd), slug, 'project.json');

export function readProject(cwd: string, slug: string): Project | undefined {
  const file = projectFile(cwd, slug);
  if (!existsSync(file)) return existsSync(join(projectsDir(cwd), slug, 'notes.md')) ? { slug, name: slug, createdAt: '', chats: [] } : undefined;
  const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<Project>;
  return { slug, name: typeof value.name === 'string' ? value.name : slug, createdAt: typeof value.createdAt === 'string' ? value.createdAt : '', chats: Array.isArray(value.chats) ? value.chats : [] };
}

function writeProject(cwd: string, project: Project): void {
  const dir = join(projectsDir(cwd), project.slug);
  mkdirSync(join(dir, 'store'), { recursive: true, mode: 0o700 });
  if (!existsSync(join(dir, 'notes.md'))) writeFileSync(join(dir, 'notes.md'), `# ${project.name}\n\nProject tracker. Every agent in this Project reads and updates it.\n`);
  const file = projectFile(cwd, project.slug);
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(project, null, 2)}\n`);
  renameSync(temporary, file);
}

export function listProjects(cwd: string): Project[] {
  const dir = projectsDir(cwd);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((slug) => SLUG.test(slug))
    .flatMap((slug) => readProject(cwd, slug) ?? []);
}

function chatTitle(ctx: ExtensionContext): string {
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== 'message' || entry.message.role !== 'user') continue;
    const content = entry.message.content;
    const text = typeof content === 'string' ? content : content.map((part) => (part.type === 'text' ? part.text : '')).join(' ');
    return text.replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  return ctx.sessionManager.getSessionName() ?? 'untitled chat';
}

/** Adds this chat to the project (idempotent: a chat appears once). */
function join_(cwd: string, project: Project, ctx: ExtensionContext): Project {
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (sessionFile === undefined || project.chats.some((chat) => chat.sessionFile === sessionFile)) return project;
  const next = { ...project, chats: [...project.chats, { sessionFile, addedAt: new Date().toISOString(), title: chatTitle(ctx) }] };
  writeProject(cwd, next);
  return next;
}

/** The host-section line for the chat's Project: its tracker, store, and the chats that are context for its agents. */
export function projectSection(cwd: string, slug: string | undefined): string | undefined {
  if (slug === undefined) return undefined;
  const project = readProject(cwd, slug);
  if (project === undefined) return undefined;
  const dir = join(projectsDir(cwd), slug);
  const chats = project.chats.map((chat) => `- ${chat.title} (${chat.sessionFile})`);
  return [
    `This chat belongs to the Project "${project.name}". Its tracker is ${join(dir, 'notes.md')} and its store is ${join(dir, 'store')}/; read the tracker at the start of each task and keep it current. Subagents you start belong to this Project too.`,
    ...(chats.length === 0 ? [] : ['Chats in this Project, finished ones included, are context for every agent in it. Read a transcript when its work bears on yours:', ...chats]),
  ].join('\n');
}

export function registerProjects(pi: ExtensionAPI): { slug: () => string | undefined } {
  let slug: string | undefined = childIdentity.project;

  pi.on('session_start', (_event, ctx) => {
    if (childIdentity.depth > 0) return;
    slug = undefined;
    for (const entry of ctx.sessionManager.getBranch()) if (entry.type === 'custom' && entry.customType === PROJECT_ENTRY) slug = (entry.data as { slug?: string } | null)?.slug ?? undefined;
    if (ctx.hasUI) ctx.ui.setStatus('pstack-project', slug === undefined ? undefined : `project: ${slug}`);
  });

  const set = (ctx: ExtensionContext, next: string | undefined) => {
    slug = next;
    pi.appendEntry(PROJECT_ENTRY, next === undefined ? null : { slug: next });
    ctx.ui.setStatus('pstack-project', next === undefined ? undefined : `project: ${next}`);
  };

  pi.registerCommand('project', {
    description: 'Projects: /project lists them, /project new <name> starts one with this chat as coordinator, /project add <slug> adds this chat, /project leave',
    getArgumentCompletions: (prefix) => ['new', 'add', 'leave'].filter((verb) => verb.startsWith(prefix.trim())).map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const [verb = '', ...rest] = args.trim().split(/\s+/);
      const arg = rest.join(' ').trim();
      try {
        if (verb === 'new' && arg !== '') {
          const created: Project = { slug: projectSlug(arg), name: arg, createdAt: new Date().toISOString(), chats: [] };
          if (readProject(ctx.cwd, created.slug) !== undefined) throw new Error(`A Project "${created.slug}" exists already; /project add ${created.slug} joins it.`);
          writeProject(ctx.cwd, created);
          join_(ctx.cwd, created, ctx);
          set(ctx, created.slug);
          return ctx.ui.notify(`Started the Project "${arg}" (${join(projectsDir(ctx.cwd), created.slug)}). This chat is its coordinator.`, 'info');
        }
        if (verb === 'add' && arg !== '') {
          const project = readProject(ctx.cwd, arg);
          if (project === undefined) throw new Error(`No Project "${arg}" in this workspace. /project lists them.`);
          join_(ctx.cwd, project, ctx);
          set(ctx, project.slug);
          return ctx.ui.notify(`This chat is now part of the Project "${project.name}".`, 'info');
        }
        if (verb === 'leave') {
          set(ctx, undefined);
          return ctx.ui.notify('This chat left its Project.', 'info');
        }
        if (verb !== '') throw new Error('Usage: /project, /project new <name>, /project add <slug>, /project leave');
        const projects = listProjects(ctx.cwd);
        const lines = projects.map((project) => `${project.slug === slug ? '* ' : '  '}${project.slug}: ${project.name} (${project.chats.length} chat${project.chats.length === 1 ? '' : 's'})`);
        return ctx.ui.notify(projects.length === 0 ? 'No Projects in this workspace. /project new <name> starts one.' : ["Projects (* is this chat's):", ...lines].join('\n'), 'info');
      } catch (error) {
        return ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error');
      }
    },
  });

  return { slug: () => slug };
}
