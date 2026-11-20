import { ForgingError } from './records.js';

export function checkFirstMessage(text, attachments = []) {
  if (typeof text !== 'string' || (!text.trim() && !attachments.length) || text.length > 131072)
    throw new ForgingError('INVALID_FIRST_MESSAGE', '请填写消息或添加附件。');
}

export async function sendFirstMessage(forging, id, input) {
  const ctx = forging.ctx, requestId = 'first-' + id;
  const observation = await forging.observe(id);
  try {
    // Replaying a successful submission must not require the original upload session.
    if (observation?.events.some(event => {
      const messages = event.type === 'agent/inbox/spliced' ? event.data.inserted
        : event.type === 'user/message' ? [event.data] : [];
      return messages.some(message => message.source?.rpcId === requestId);
    })) return;
  } finally { observation?.[Symbol.dispose](); }
  if (ctx.workspaceRegistry.archivedSessionIds.includes(id))
    throw new ForgingError('SESSION_ARCHIVED', '会话已归档。');
  const { firstMessage, attachments = [], origin } = input;
  const workspace = ctx.workspaceRegistry.get(input.workspaceId);
  const content = [];
  const signal = new AbortController().signal;
  for (const part of attachments) {
    if (part.type === 'image') { content.push(part); continue; }
    const source = workspace?.sessionIds.includes(origin) && ctx.agents.get(origin);
    const file = source && ctx.fileUploads.resolve(source, part.receiptId);
    if (file?.type !== 'file') throw new ForgingError('ATTACHMENT_UNAVAILABLE', '请重新选择要发送的文件。');
    const { receiptId } = await ctx.fileUploads.uploadStream({sessionId:id, name:file.attachment.name,
      data:ctx.attachments.readFileStream(file.attachment, signal), signal});
    content.push({type:'file', receiptId});
  }
  if (firstMessage) content.push({type:'text', text:firstMessage});
  const accepted = await ctx.sessionController.prompt({sessionId:id, requestId, mode:'queue', content}, signal);
  if (!accepted.accepted) throw new ForgingError('PROMPT_REJECTED', 'DSH 尚未接收首条消息。');
  await ctx.sessions.flush(ctx.agents.get(id).session);
}
