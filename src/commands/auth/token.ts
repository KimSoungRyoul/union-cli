import {Command, Args, Flags} from '@oclif/core'
import {loadTokens} from '../../core/token-store.js'
import {getAuthConfig, getExecutor} from '../../core/auth-utils.js'

export default class AuthToken extends Command {
  static override description = '토큰 출력 (파이프용)'

  static override args = {
    namespace: Args.string({required: true, description: 'Provider namespace'}),
  }

  static override flags = {
    json: Flags.boolean({description: 'JSON 출력'}),
    'no-color': Flags.boolean({description: '색상/이모지 비활성화'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AuthToken)

    const executor = getExecutor()
    const allManifests = executor.registry.getAllManifests()
    const manifest = allManifests.find(m => m.namespace === args.namespace)

    if (!manifest) {
      this.error(`Namespace "${args.namespace}" not found`)
    }

    const auth = getAuthConfig(manifest)
    const authType = auth?.type ?? 'none'

    if (authType === 'none') {
      this.error(`${args.namespace}: 인증이 필요하지 않은 provider입니다.`)
    }

    const authServiceName = auth?.serviceName ?? manifest.namespace
    const tokens = loadTokens()
    const svcTokens = tokens[authServiceName] as {cookies?: string} | undefined

    if (!svcTokens?.cookies) {
      this.error(`${args.namespace}: 저장된 토큰이 없습니다. "auth login ${args.namespace}"을 실행하세요.`)
    }

    // Extract the token value from the cookies string
    const tokenMatch = svcTokens.cookies.match(/_token=([^;]+)/)
    const tokenValue = tokenMatch ? tokenMatch[1] : svcTokens.cookies

    if (flags.json) {
      this.log(JSON.stringify({namespace: args.namespace, token: tokenValue}))
    } else {
      // Output raw token only (suitable for piping)
      this.log(tokenValue)
    }
  }
}
