import { isAbsolute, join } from 'node:path';
import { SessionForging } from './src/forging.js';
import { registerView } from './src/remote.js';
export const name = 'session-forging';
export const inject = ['loader', 'agentPresets', 'agents', 'sessions', 'sessionQuery', 'sessionPersistence', 'sessionController', 'workspaceRegistry', 'tools', 'skills', 'llm', 'typert', 'fileUploads', 'attachments'];

export async function apply(ctx, config = {}) {
  const { resolveDshHome } = await ctx.loader.import('@deepseek-ai/dsh-home-paths');
  const directory = config.directory ?? join(resolveDshHome(), 'session-forging');
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw new TypeError('Forging directory must be absolute.');
  const forging = new SessionForging(ctx, directory);
  ctx.effect(() => () => forging.stop());
  await forging.start();
  ctx.provide('sessionForging', forging);
  await registerView(ctx, forging);
}
