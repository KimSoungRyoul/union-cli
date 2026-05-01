export const manifestSchema = {
  type: 'object' as const,
  required: ['name', 'namespace', 'description', 'provider', 'commands'],
  additionalProperties: false,
  properties: {
    /** 부모 manifest 경로 (현재 파일 기준 상대). parser 가 deep-merge 후 검증. */
    extends: {type: 'string', minLength: 1},
    name: {type: 'string', minLength: 1},
    namespace: {type: 'string', pattern: '^[a-z][a-z0-9-]*$'},
    description: {type: 'string'},
    provider: {
      type: 'object',
      required: ['type', 'config'],
      additionalProperties: false,
      properties: {
        type: {type: 'string', enum: ['http', 'cli', 'python', 'js']},
        config: {
          type: 'object',
          additionalProperties: true,
          properties: {
            credentialStore: {type: 'string', enum: ['file', 'keychain', 'env'], default: 'file'},
            pagination: {
              type: 'object',
              additionalProperties: false,
              required: ['style'],
              properties: {
                style: {type: 'string', enum: ['cursor', 'offset', 'link-header']},
                pageParam: {type: 'string'},
                sizeParam: {type: 'string'},
                itemsPath: {type: 'string'},
                nextPath: {type: 'string'},
                maxPages: {type: 'integer', minimum: 1, default: 100},
                perPage: {type: 'integer', minimum: 1},
              },
            },
            retry: {
              type: 'object',
              additionalProperties: false,
              properties: {
                attempts: {type: 'integer', minimum: 1, default: 1},
                initialDelayMs: {type: 'integer', minimum: 0, default: 200},
                maxDelayMs: {type: 'integer', minimum: 0, default: 5000},
                retryOn: {type: 'array', items: {type: 'integer'}, default: [429, 500, 502, 503, 504]},
                respectRetryAfter: {type: 'boolean', default: true},
                jitter: {type: 'string', enum: ['full', 'equal', 'none'], default: 'full'},
                idempotent: {oneOf: [{type: 'boolean'}, {type: 'string', enum: ['auto']}], default: 'auto'},
              },
            },
          },
        },
      },
    },
    commands: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'description'],
        additionalProperties: true,
        properties: {
          id: {type: 'string', pattern: '^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)?$'},
          description: {type: 'string'},
          /** 명령 단위 timeout (ms). provider.config.timeout 보다 우선. 일부 endpoint 가 더 오래 걸리는 경우 사용. */
          timeout: {type: 'integer', minimum: 1},
          outputParser: {type: 'string', enum: ['json', 'line', 'lines', 'table', 'csv', 'yaml']},
          flags: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name'],
              additionalProperties: true,
              properties: {
                name: {type: 'string'},
                httpBodyType: {type: 'string', enum: ['json', 'array', 'number-array', 'json-string-array']},
              },
            },
          },
        },
      },
    },
  },
}
