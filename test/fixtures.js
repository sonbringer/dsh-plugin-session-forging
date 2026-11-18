export function manifest() {
  return {
    schemaVersion: 1, id: 'test-source', name: 'Test source', description: '',
    sparks: [{
      id: 'test-spark', name: 'Test spark', description: '', persona: '', soul: '',
      cog: { provider: '', model: '', reasoningEffort: '' },
      components: { tools: [], skills: [] }, matrix: false,
      energon: {
        maxTokens: null, tokenLimit: null, maxTurnDurationMs: null, wrapUpLeadTimeMs: 0,
        steps: { maxStepsPerTurn: null, wrapUpSteps: 0, finalReplySteps: 0 },
        web: { searchMaxQueries: null, searchMaxResults: null, searchSummaryMaxChars: null },
      },
    }],
  };
}
