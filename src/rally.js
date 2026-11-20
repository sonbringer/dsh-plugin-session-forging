import { join } from 'node:path';
import { Records, ForgingError } from './records.js';
import { contentRevision } from './source.js';
import { workspaceFor } from './council.js';
import { ForkNotices } from './notices.js';

export class Rally {
  constructor(forging, directory) {
    this.forging = forging;
    this.records = new Records(join(directory, 'rallies'));
    this.roles = new Records(join(directory, 'responsibilities'));
    this.legacyMissions = new Map();
    this.grants = new Records(join(directory, 'rally-workspaces'));
    this.revivals = new Records(join(directory, 'rally-revivals'));
    this.removals = new Records(join(directory, 'rally-removals'));
    this.removed = new Set();
    this.removalNotices = new ForkNotices();
  }

  async loadRemovals() {
    for (const { id, value } of await this.removals.list()) {
      if (typeof value?.sessionId !== 'string' || contentRevision(value.sessionId) !== id)
        throw new ForgingError('CORRUPT_RECORD', '成员移除记录与会话 ID 不匹配。');
      this.removed.add(value.sessionId);
    }
  }

  async remove({ sessionId, targetId, workspaceId, scope }) {
    this.leader(sessionId);
    const group = await this.members(sessionId, scope);
    const f = this.forging;
    // Bind the confirmation to the workspace shown when the dialog opened.
    const { home, granted } = await this.scopes(sessionId);
    if (sessionId === targetId || home.id !== group.workspaceId ||
        (workspaceId !== home.id && !(scope === 'authorized' && granted.includes(workspaceId))) ||
        workspaceFor(f, targetId)?.id !== workspaceId)
      throw new ForgingError('UNKNOWN_MEMBER', '找不到范围内的锻造成员。');
    if (this.removed.has(targetId)) return null;
    const target = group.members.find(m => m.sessionId === targetId && m.workspaceId === workspaceId);
    if (!target) throw new ForgingError('UNKNOWN_MEMBER', '找不到范围内的锻造成员。');
    this.checkDelivery(sessionId, home.id, targetId, workspaceId, false);
    if (!target.archived || !f.ctx.workspaceRegistry.archivedSessionIds.includes(targetId))
      throw new ForgingError('NOT_ARCHIVED', '只能移除当前已归档的成员。');
    try {
      await this.removals.put(contentRevision(targetId), { sessionId: targetId }, { immutable: true });
    } catch (error) {
      if (error.code !== 'RECORD_WRITE_UNCERTAIN') throw error;
      // The file was published. Enforce the decision even if its fsync failed.
      this.removed.add(targetId);
      this.removalNotices.publish('members', null);
      throw error;
    }
    this.removed.add(targetId);
    this.removalNotices.publish('members', null);
    return null;
  }

  async loadLegacyMissions() {
    for (const { id, value } of await this.roles.list()) {
      for (const [sessionId, mission] of Object.entries(value)) {
        const plan = this.forging.known.get(sessionId);
        if (plan && (id === contentRevision(plan.workspaceId) || !this.legacyMissions.has(sessionId)))
          this.legacyMissions.set(sessionId, mission);
      }
    }
  }

  mission(id) {
    return this.forging.known.get(id)?.mission ?? this.legacyMissions.get(id) ?? '';
  }

  leader(id) {
    const f = this.forging;
    if (this.removed.has(id) || !f.known.get(id)?.binding.spark.matrix)
      throw new ForgingError('NOT_LEADER', '只有锻造领袖能执行此操作。');
    if (f.closing || f.ctx.workspaceRegistry.archivedSessionIds.includes(id))
      throw new ForgingError('SESSION_ARCHIVED', '领袖当前不可用。');
  }

  async scopes(id) {
    const home = workspaceFor(this.forging, id);
    if (!home) throw new ForgingError('WORKSPACE_NOT_FOUND', '会话未归属工作区。');
    const granted = await this.grants.get(contentRevision([id, home.id])) ?? [];
    return { home, granted };
  }

  async grant(id, workspaceId, enabled) {
    this.leader(id);
    const { home, granted } = await this.scopes(id);
    if (home.id === workspaceId || !this.forging.ctx.workspaceRegistry.list().some(w => w.id === workspaceId))
      throw new ForgingError('INVALID_WORKSPACE', '请选择其他现有工作区。');
    const ids = new Set(granted);
    if (enabled) ids.add(workspaceId);
    else ids.delete(workspaceId);
    await this.grants.put(contentRevision([id, home.id]), [...ids]);
    return [...ids];
  }

  async members(id, scope = 'workspace') {
    const f = this.forging;
    if (this.removed.has(id)) throw new ForgingError('UNKNOWN_MEMBER', '此会话已退出召集令。');
    if (!(await f.view(id))) throw new ForgingError('NOT_FORGED', 'Select a forged Session.');
    const { home, granted } = await this.scopes(id);
    if (!['workspace', 'authorized'].includes(scope)) throw new ForgingError('INVALID_SCOPE', '未知召集范围。');
    if (scope === 'authorized') this.leader(id);
    const workspaces = f.ctx.workspaceRegistry.list().filter(w =>
      w.id === home.id || (scope === 'authorized' && granted.includes(w.id)));
    const { items } = await f.ctx.sessionController.list({}, new AbortController().signal);
    const summaries = new Map(items.map(item => [item.sessionId, item]));
    const members = [];
    for (const workspace of workspaces) {
      for (const sessionId of workspace.sessionIds) {
        const plan = f.known.get(sessionId), summary = summaries.get(sessionId);
        if (!plan || !summary || summary.blank || this.removed.has(sessionId)) continue;
        const state = await f.states.get(sessionId);
        if (!state?.ready || state.suspended) continue;
        const archived = f.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId);
        let name = summary.projections?.values?.title;
        // A cold cache miss can be marked nonblank until its history is observed.
        if (!summary.projections?.values?.sessionListMetadata && !summary.agentAvailable) {
          const observed = await f.observe(sessionId);
          try {
            if (!observed?.events.some(e => e.type === 'turn/start')) continue;
            name ??= observed.events.findLast(e => e.type === 'session/title')?.data.title;
          } finally { observed?.[Symbol.dispose](); }
        }
        members.push({ sessionId, workspaceId: workspace.id, workspaceName: workspace.title || workspace.path || workspace.id,
          name: name || '未命名会话', responsibility: this.mission(sessionId),
          leader: plan.binding.spark.matrix, archived, running: summary.running === true });
      }
    }
    // Read-only queries can overlap an operator removal while awaiting native metadata.
    const visible = members.filter(m => !this.removed.has(m.sessionId));
    const revision = contentRevision(visible.map(m => [m.workspaceId, m.sessionId, m.name, m.archived, m.responsibility]).sort((a,b) => a[1].localeCompare(b[1])));
    return { workspaceId: home.id, members: visible, revision };
  }

  async revive({ sessionId, targetId, requestId, scope = 'workspace' }) {
    this.leader(sessionId);
    if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 256)
      throw new ForgingError('INVALID_REQUEST', '恢复操作需要请求 ID。');
    const group = await this.members(sessionId, scope);
    const target = group.members.find(m => m.sessionId === targetId && targetId !== sessionId);
    if (!target) throw new ForgingError('UNKNOWN_MEMBER', '找不到范围内的锻造成员。');
    const key = contentRevision([sessionId, requestId]);
    const prior = await this.revivals.get(key);
    if (prior && (prior.targetId !== targetId || prior.workspaceId !== target.workspaceId))
      throw new ForgingError('RALLY_CONFLICT', '请求 ID 已用于其他目标。');
    if (prior?.completed) return prior;
    if (prior && target.archived) throw new ForgingError('RESTORE_UNCERTAIN', '请重新查询状态，确认后使用新的请求 ID。');
    const result = { targetId, workspaceId: target.workspaceId };
    if (!prior) await this.revivals.put(key, result, { immutable: true });
    if (target.archived) {
      await this.forging.validate(targetId);
      this.checkDelivery(sessionId, group.workspaceId, targetId, target.workspaceId, false);
      await this.forging.ctx.workspaceRegistry.unarchiveSession(targetId);
    }
    result.completed = true;
    await this.revivals.put(key, result);
    return result;
  }

  checkDelivery(sender, home, id, workspaceId, requireActive = true) {
    this.leader(sender);
    const f = this.forging;
    if (this.removed.has(id)) throw new ForgingError('UNKNOWN_MEMBER', '找不到范围内的锻造成员。');
    if (workspaceFor(f, sender)?.id !== home || workspaceFor(f, id)?.id !== workspaceId)
      throw new ForgingError('WORKSPACE_CHANGED', '成员已移动，请重新查询名册。');
    if (requireActive && f.ctx.workspaceRegistry.archivedSessionIds.includes(id))
      throw new ForgingError('SESSION_ARCHIVED', '成员已归档。');
  }
  async list(id) {
    return (await this.records.list())
      .map((r) => r.value)
      .filter((r) => r.sender === id || r.targets.some((t) => t.sessionId === id))
      .map(r => r.sender === id ? r : { id:r.id, sender:r.sender, message:r.message, createdAt:r.createdAt,
        targets:r.targets.filter(target => target.sessionId === id) })
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  async send(input, signal) {
    const { requestId, sessionId, message, responsibilities = {}, membershipRevision } = input;
    if (
      typeof requestId !== 'string' ||
      !requestId.trim() ||
      requestId.length > 256 ||
      typeof message !== 'string' ||
      !message.trim() ||
      message.length > 8000
    )
      throw new ForgingError(
        'INVALID_RALLY',
        'Supply requestId and a change of 1–8000 characters.'
      );
    const f = this.forging;
    this.leader(sessionId);
    await f.restoreOnce(sessionId);
    const group = await this.members(sessionId, input.scope),
      key = contentRevision([sessionId, requestId]);
    const inputRevision = contentRevision(input);
    let record = await this.records.get(key);
    if (record && record.inputRevision !== inputRevision)
      throw new ForgingError('RALLY_CONFLICT', 'Rally requestId already names different inputs.');
    if (record && record.workspaceId !== group.workspaceId)
      throw new ForgingError('WORKSPACE_CHANGED', 'Sender moved to a different Workspace.');
    if (!record) {
      signal?.throwIfAborted();
      if (membershipRevision !== undefined && membershipRevision !== group.revision)
        throw new ForgingError(
          'MEMBERS_CHANGED',
          'Workspace members or responsibilities changed; reload.'
        );
      if (
        !responsibilities ||
        typeof responsibilities !== 'object' ||
        Array.isArray(responsibilities)
      )
        throw new ForgingError('INVALID_RESPONSIBILITY', 'Responsibilities must be a map.');
      const roles = Object.fromEntries(group.members.map((m) => [m.sessionId, m.responsibility]));
      for (const [id, value] of Object.entries(responsibilities)) {
        if (
          !group.members.some((m) => m.sessionId === id) ||
          typeof value !== 'string' ||
          !value.trim() ||
          value.length > 300
        )
          throw new ForgingError(
            'INVALID_RESPONSIBILITY',
            'Supply a responsibility of 1–300 characters for current forged members.'
          );
        roles[id] = value.trim();
      }
      const selected = input.targets, excluded = input.exclude ?? [];
      if ((selected !== undefined && (!Array.isArray(selected) || !selected.length)) ||
          !Array.isArray(excluded) || (selected !== undefined && excluded.length))
        throw new ForgingError('INVALID_TARGETS', '请指定成员，或从全员中排除成员。');
      const others = group.members.filter(m => m.sessionId !== sessionId);
      for (const id of [...(selected ?? []), ...excluded]) {
        const member = others.find(m => m.sessionId === id);
        if (!member) throw new ForgingError('UNKNOWN_MEMBER', '所选成员已离开当前召集范围。');
        if (selected && member.archived) throw new ForgingError('SESSION_ARCHIVED', '所选成员已归档，请先明确恢复。');
      }
      const targets = others.filter(m => !m.archived && (selected ? selected.includes(m.sessionId) : !excluded.includes(m.sessionId)));
      if (!targets.length) throw new ForgingError('NO_RECIPIENTS', '没有可投递成员。');
      record = {
        id: key,
        input: structuredClone(input),
        inputRevision,
        workspaceId: group.workspaceId,
        sender: sessionId,
        message: message.trim(),
        createdAt: Date.now(),
        roles,
        targets: targets.map((m) => ({
            workspaceId: m.workspaceId, sessionId: m.sessionId,
            messageId: 'forging-rally-' + contentRevision([key, m.sessionId]),
            status: 'pending',
          })),
      };
      await this.records.put(key, record, { immutable: true });
    }
    const { freezeMessage } = await f.ctx.loader.import('@deepseek-ai/dsh-llm');
    for (const target of record.targets) {
      if (target.status === 'accepted' || target.status === 'uncertain') continue;
      if (signal?.aborted || f.closing) break;
      let submitting = target.status === 'sending';
      try {
        const workspaceId = target.workspaceId ?? record.workspaceId;
        if (!group.members.some(m => m.sessionId === target.sessionId && m.workspaceId === workspaceId))
          throw new ForgingError('UNKNOWN_MEMBER', '成员已离开授权范围。');
        this.checkDelivery(sessionId, record.workspaceId, target.sessionId, workspaceId);
        await f.restoreOnce(target.sessionId);
        const agent = f.ctx.agents.get(target.sessionId);
        const events = agent.session.snapshotEvents();
        const already = events.some(
          (event) =>
            (event.type === 'user/message' && event.data.id === target.messageId) ||
            (event.type === 'agent/inbox/spliced' &&
              event.data.inserted.some((message) => message.id === target.messageId))
        );
        if (!already && target.status === 'sending') {
          target.status = 'uncertain';
          target.error = 'Previous delivery has no durable evidence; not automatically resent.';
        } else {
          if (!already) {
            target.status = 'sending';
            delete target.error;
            await this.records.put(key, record);
            signal?.throwIfAborted();
            this.checkDelivery(sessionId, record.workspaceId, target.sessionId, workspaceId);
            const notice = freezeMessage({
              role: 'user',
              id: target.messageId,
              content: [
                {
                  type: 'text',
                  text: `召集令 · ${key}\n发送者：${record.sender}${record.roles[target.sessionId] ? '\n分工：' + record.roles[target.sessionId] : ''}\n本次任务：${record.message}`,
                },
              ],
              source: { kind: 'session-forging:rally' },
            });
            submitting = true;
            target.route = agent.status === 'running' ? 'steer' : 'followup';
            agent[target.route](notice);
          }
          await f.ctx.sessions.flush(agent.session);
          target.status = 'accepted';
          delete target.error;
        }
      } catch (error) {
        target.status = submitting ? 'uncertain' : 'failed';
        target.error = error.message;
      }
      await this.records.put(key, record);
    }
    return record;
  }
}
