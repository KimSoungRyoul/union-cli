import {describe, it, expect} from 'vitest'
import {convertOpenApiToManifests} from '../src/build/openapi-to-manifest.js'

const minimalSpec = {
  openapi: '3.1.0',
  info: {title: 'Foo API', description: 'desc', version: '0.1.0'},
  servers: [{url: 'http://api.example.com'}],
  paths: {
    '/items': {
      get: {
        tags: ['items'],
        summary: 'List items',
        operationId: 'list_items',
        parameters: [{name: 'limit', in: 'query', schema: {type: 'integer', default: 25}}],
      },
      post: {
        tags: ['items'],
        summary: 'Create item',
        operationId: 'create_item',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: {type: 'string', description: 'item name'},
                  qty: {type: 'integer', default: 1},
                  tags: {type: 'array', items: {type: 'string'}},
                },
              },
            },
          },
        },
      },
    },
    '/items/{id}': {
      get: {
        tags: ['items'],
        operationId: 'get_item',
        parameters: [{name: 'id', in: 'path', required: true, schema: {type: 'string'}}],
      },
      delete: {
        tags: ['items'],
        operationId: 'delete_item',
        parameters: [{name: 'id', in: 'path', required: true, schema: {type: 'string'}}],
      },
    },
    '/items/{id}/health': {
      get: {
        tags: ['items'],
        operationId: 'health_item',
        parameters: [{name: 'id', in: 'path', required: true, schema: {type: 'string'}}],
      },
    },
    '/admin/{conn_id}/users': {
      get: {tags: ['admin'], operationId: 'list_users', parameters: [{name: 'conn_id', in: 'path', required: true, schema: {type: 'string'}}]},
      post: {tags: ['admin'], operationId: 'create_user', parameters: [{name: 'conn_id', in: 'path', required: true, schema: {type: 'string'}}]},
      delete: {tags: ['admin'], operationId: 'delete_user', parameters: [{name: 'conn_id', in: 'path', required: true, schema: {type: 'string'}}]},
    },
  },
}

describe('convertOpenApiToManifests', () => {
  it('tag 별로 manifest 생성 (split=default)', () => {
    const {manifests} = convertOpenApiToManifests(minimalSpec as never)
    expect(manifests.map((m) => m.namespace).sort()).toEqual(['admin', 'items'])
  })

  it('command id heuristic — collection vs item vs sub-resource', () => {
    const {manifests} = convertOpenApiToManifests(minimalSpec as never)
    const items = manifests.find((m) => m.namespace === 'items')!
    const ids = items.commands.map((c) => c.id).sort()
    // GET /items=list, POST /items=create, GET /items/{id}=get, DELETE /items/{id}=delete, GET /items/{id}/health=health
    expect(ids).toEqual(['create', 'delete', 'get', 'health', 'list'])
  })

  it('sub-resource collection — POST/DELETE 는 method-prefix 로 collision 회피', () => {
    const {manifests} = convertOpenApiToManifests(minimalSpec as never)
    const admin = manifests.find((m) => m.namespace === 'admin')!
    const ids = admin.commands.map((c) => c.id).sort()
    // GET /admin/{conn_id}/users=users (action 그대로), POST=create-users, DELETE=delete-users
    expect(ids).toEqual(['create-users', 'delete-users', 'users'])
  })

  it('path param → args, query param → flags(query)', () => {
    const {manifests} = convertOpenApiToManifests(minimalSpec as never)
    const items = manifests.find((m) => m.namespace === 'items')!
    const list = items.commands.find((c) => c.id === 'list')!
    expect(list.flags?.find((f) => f.name === 'limit')?.httpMap).toBe('query')
    expect(list.flags?.find((f) => f.name === 'limit')?.type).toBe('number')
    expect(list.flags?.find((f) => f.name === 'limit')?.default).toBe(25)

    const get = items.commands.find((c) => c.id === 'get')!
    expect(get.args?.[0]?.name).toBe('id')
    expect(get.args?.[0]?.required).toBe(true)
  })

  it('request body 의 properties → flags(body) flatten, required 보존', () => {
    const {manifests} = convertOpenApiToManifests(minimalSpec as never)
    const items = manifests.find((m) => m.namespace === 'items')!
    const create = items.commands.find((c) => c.id === 'create')!
    const flags = create.flags!
    const name = flags.find((f) => f.name === 'name')!
    expect(name.httpMap).toBe('body')
    expect(name.required).toBe(true)
    expect(name.description).toBe('item name')
    const qty = flags.find((f) => f.name === 'qty')!
    expect(qty.type).toBe('number')
    expect(qty.default).toBe(1)
    const tags = flags.find((f) => f.name === 'tags')!
    expect(tags.httpBodyType).toBe('array')
  })

  it('DELETE 는 dangerous=true 로 마크', () => {
    const {manifests} = convertOpenApiToManifests(minimalSpec as never)
    const items = manifests.find((m) => m.namespace === 'items')!
    const del = items.commands.find((c) => c.id === 'delete')!
    expect((del as unknown as {dangerous?: boolean}).dangerous).toBe(true)
  })

  it('--single 모드에서는 단일 manifest, namespace=namePrefix', () => {
    const {manifests} = convertOpenApiToManifests(minimalSpec as never, {split: false, namePrefix: 'mycli'})
    expect(manifests.length).toBe(1)
    expect(manifests[0].namespace).toBe('mycli')
    expect(manifests[0].commands.length).toBe(8)
  })

  it('baseUrl 옵션 우선 (servers[0].url 보다)', () => {
    const {manifests} = convertOpenApiToManifests(minimalSpec as never, {baseUrl: '${MYAPI:-http://x}'})
    const config = manifests[0].provider.config as {baseUrl: string}
    expect(config.baseUrl).toBe('${MYAPI:-http://x}')
  })

  it('빈 paths 도 처리 (manifest 0개)', () => {
    const {manifests} = convertOpenApiToManifests({openapi: '3.1.0', paths: {}} as never)
    expect(manifests).toEqual([])
  })
})
