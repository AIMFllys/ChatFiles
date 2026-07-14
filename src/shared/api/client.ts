import type { z } from 'zod/v4'

export type ApiClientErrorCode =
  | 'request_failed'
  | 'invalid_content_type'
  | 'invalid_json'
  | 'invalid_response'

export class ApiClientError extends Error {
  constructor(
    public readonly code: ApiClientErrorCode,
    public readonly status?: number,
    public readonly serverCode?: string,
  ) {
    super(code)
    this.name = 'ApiClientError'
  }
}

type ReadJsonOptions = {
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

function serverErrorCode(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const code = (value as Record<string, unknown>).code
  return typeof code === 'string' ? code : undefined
}

export async function readJson<Schema extends z.ZodType>(
  url: string,
  schema: Schema,
  options: ReadJsonOptions = {},
): Promise<z.output<Schema>> {
  const response = await (options.fetchImpl ?? fetch)(url, { signal: options.signal })
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('application/json')) {
    throw new ApiClientError('invalid_content_type', response.status)
  }
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new ApiClientError('invalid_json', response.status)
  }
  if (!response.ok) {
    throw new ApiClientError('request_failed', response.status, serverErrorCode(value))
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new ApiClientError('invalid_response', response.status)
  return parsed.data
}
