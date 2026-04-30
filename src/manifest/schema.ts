export const manifestSchema = {
  type: 'object' as const,
  required: ['name', 'namespace', 'description', 'provider', 'commands'],
  additionalProperties: false,
  properties: {
    name: {type: 'string', minLength: 1},
    namespace: {type: 'string', pattern: '^[a-z][a-z0-9-]*$'},
    description: {type: 'string'},
    provider: {
      type: 'object',
      required: ['type', 'config'],
      additionalProperties: false,
      properties: {
        type: {type: 'string', enum: ['http', 'cli', 'python', 'js']},
        config: {type: 'object', additionalProperties: true},
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
