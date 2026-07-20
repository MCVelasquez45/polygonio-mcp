import { agentChat, type AiRequestMeta } from '../agentClient';
import { getAgentById, type AgentDefinition } from './agents';
import { CONTEXT_BUILDERS, type AgentParams, type ContextSection } from './contextBuilders';

// AI orchestration: gather the agent's declared context sections in parallel,
// assemble a grounded prompt (data first, reasoning second), and run it
// through the existing guarded LLM path. One provider failing never fails the
// report — it is listed under Sources Unavailable instead.

export type AgentRunResult = {
  agentId: string;
  agentLabel: string;
  reply: string;
  sourcesUsed: string[];
  sourcesUnavailable: { source: string; note: string }[];
};

const MAX_PROMPT_CHARS = Math.max(8_000, Number(process.env.AI_AGENT_MAX_PROMPT_CHARS ?? 28_000));

export async function runAgent(
  agentId: string,
  params: AgentParams,
  meta: AiRequestMeta & { sessionName?: string }
): Promise<AgentRunResult> {
  const agent = getAgentById(agentId);
  if (!agent) {
    throw Object.assign(new Error(`Unknown AI agent '${agentId}'`), { status: 400 });
  }
  if (!params.symbol || typeof params.symbol !== 'string') {
    throw Object.assign(new Error('symbol is required to run an AI agent'), { status: 400 });
  }

  const sections = await gatherContexts(agent, params);
  const prompt = buildPrompt(agent, params, sections);

  const data = await agentChat(prompt, meta.sessionName, undefined, {
    userKey: meta.userKey,
    feature: `ai.agent.${agent.id}`,
  });

  const sourcesUsed = sections.filter(s => s.status === 'ok').map(s => s.source);
  const sourcesUnavailable = sections
    .filter(s => s.status !== 'ok')
    .map(s => ({ source: s.source, note: s.note ?? s.status }));

  return {
    agentId: agent.id,
    agentLabel: agent.label,
    reply: ensureSourceSections(String(data?.reply ?? ''), sections),
    sourcesUsed,
    sourcesUnavailable,
  };
}

async function gatherContexts(agent: AgentDefinition, params: AgentParams): Promise<ContextSection[]> {
  const builders = agent.contexts
    .map(name => ({ name, builder: CONTEXT_BUILDERS[name] }))
    .filter(entry => Boolean(entry.builder));
  const settled = await Promise.allSettled(builders.map(entry => entry.builder(params)));
  return settled.map((result, index) =>
    result.status === 'fulfilled'
      ? result.value
      : {
          source: builders[index].name,
          label: builders[index].name,
          status: 'error' as const,
          note: String((result.reason as any)?.message ?? result.reason).slice(0, 200),
        }
  );
}

function buildPrompt(agent: AgentDefinition, params: AgentParams, sections: ContextSection[]): string {
  const header = [
    `You are the ${agent.label} on an institutional options trading desk.`,
    `Subject: ${params.symbol}${params.timeframe ? ` · timeframe ${params.timeframe}` : ''}${params.contract ? ` · selected contract ${params.contract}` : ''}.`,
    '',
    'GROUND RULES:',
    '- Reason ONLY from the DATA PACKAGE below. Never invent prices, quotes, events, or filings.',
    '- Sections marked UNAVAILABLE or ERROR are missing: acknowledge the gap, reduce confidence accordingly, and never substitute guesses.',
    '- Prioritize data in this order: platform data, live market data, news, economic data, congressional data, historical reports, then your own reasoning.',
    '- Format the entire response as plain text sections, each starting on its own line as **Section Name**: content. Use bullet lines starting with "- " inside sections where lists help.',
    `- Produce exactly these sections in order: ${agent.sections.join(', ')}.`,
    '- Confidence must be a percentage with one-line justification reflecting data completeness.',
    '',
  ].join('\n');

  const budgetPerSection = Math.floor((MAX_PROMPT_CHARS - header.length - agent.brief.length - 800) / Math.max(sections.length, 1));
  const dataPackage = sections
    .map(section => {
      const status = section.status.toUpperCase();
      const head = `### ${section.label} [${section.source}] — ${status}${section.note ? ` (${section.note})` : ''}`;
      if (section.status !== 'ok') return head;
      let body = '';
      try {
        body = JSON.stringify(section.data);
      } catch {
        body = String(section.data);
      }
      if (body.length > budgetPerSection) body = `${body.slice(0, budgetPerSection)}…[truncated]`;
      return `${head}\n${body}`;
    })
    .join('\n\n');

  return `${header}DATA PACKAGE:\n${dataPackage}\n\nANALYST BRIEF:\n${agent.brief}`;
}

/**
 * Guarantee the report always discloses provenance even if the model skipped
 * those sections: append Sources Used / Sources Unavailable when absent.
 */
function ensureSourceSections(reply: string, sections: ContextSection[]): string {
  let output = reply.trim();
  if (!/\*\*Sources Used\*\*/i.test(output)) {
    const used = sections.filter(s => s.status === 'ok').map(s => s.label);
    output += `\n\n**Sources Used**: ${used.length ? used.join('; ') : 'none'}`;
  }
  if (!/\*\*Sources Unavailable\*\*/i.test(output)) {
    const missing = sections.filter(s => s.status !== 'ok').map(s => `${s.label}${s.note ? ` (${s.note})` : ''}`);
    output += `\n**Sources Unavailable**: ${missing.length ? missing.join('; ') : 'none'}`;
  }
  return output;
}
