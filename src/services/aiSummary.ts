interface OpsSummaryInput {
  alertCount: number
  severeCount: number
  reportCount: number
  tornadoCount: number
  outlookFeatureCount: number
}

export interface OpsAiSummaryResult {
  summary: string
  model: string
  generatedAt: string
  error?: string
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
  model?: string
}

function buildPrompt(input: OpsSummaryInput): string {
  return [
    'You are a weather operations analyst for a public dashboard.',
    'Write a concise live operations summary in 2-4 sentences.',
    'Focus on immediate situational awareness and operator actionability.',
    'Do not invent data. Use only the provided metrics.',
    `Metrics: alerts=${input.alertCount}, severe_or_extreme_alerts=${input.severeCount}, spc_reports=${input.reportCount}, tornado_reports=${input.tornadoCount}, outlook_features=${input.outlookFeatureCount}.`,
  ].join(' ')
}

export async function fetchOpsAiSummary(input: OpsSummaryInput): Promise<OpsAiSummaryResult> {
  const endpoint = (import.meta.env.VITE_LLM_API_ENDPOINT as string | undefined)?.trim()
  const model = (import.meta.env.VITE_LLM_MODEL as string | undefined) ?? 'openai/gpt-4o-mini'

  if (!endpoint) {
    return {
      summary: 'AI summary unavailable: configure VITE_LLM_API_ENDPOINT to a non-secret proxy endpoint to enable model-generated summaries.',
      model: 'unconfigured',
      generatedAt: new Date().toISOString(),
      error: 'missing_endpoint',
    }
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 220,
        messages: [
          { role: 'system', content: 'You produce concise, factual weather operations summaries.' },
          { role: 'user', content: buildPrompt(input) },
        ],
      }),
    })

    const text = await response.text()
    if (!response.ok) {
      return {
        summary: `AI summary request failed (${response.status}).`,
        model,
        generatedAt: new Date().toISOString(),
        error: text.slice(0, 200),
      }
    }

    const payload = JSON.parse(text) as ChatCompletionResponse
    const content = payload.choices?.[0]?.message?.content?.trim()

    if (!content) {
      return {
        summary: 'AI summary unavailable: empty response content.',
        model: payload.model ?? model,
        generatedAt: new Date().toISOString(),
        error: 'empty_response',
      }
    }

    return {
      summary: content,
      model: payload.model ?? model,
      generatedAt: new Date().toISOString(),
    }
  } catch (error) {
    return {
      summary: 'AI summary unavailable due to network/model error.',
      model,
      generatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'unknown_error',
    }
  }
}
