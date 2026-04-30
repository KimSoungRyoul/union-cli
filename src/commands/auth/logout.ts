import {Command, Args, Flags} from '@oclif/core'
import {deleteTokenForNamespace, deleteAllTokens} from '../../core/token-store.js'
import {getAuthConfig, getExecutor, isNoColor} from '../../core/auth-utils.js'

export default class AuthLogout extends Command {
  static override description = '인증 로그아웃'

  static override args = {
    namespace: Args.string({description: 'Provider namespace (생략 시 전체 로그아웃)', required: false}),
  }

  static override flags = {
    json: Flags.boolean({description: 'JSON 출력'}),
    'no-color': Flags.boolean({description: '색상/이모지 비활성화'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(AuthLogout)
    const noColor = isNoColor(flags)

    if (!args.namespace) {
      // Logout all
      const deleted = deleteAllTokens()
      if (deleted) {
        this.logToStderr(`${noColor ? '[OK]' : '✅'} 전체 로그아웃 완료`)
      } else {
        this.logToStderr('로그인 정보가 없습니다.')
      }
      if (flags.json) this.log(JSON.stringify({action: 'logout_all'}))
      return
    }

    // Logout specific namespace
    const executor = getExecutor()
    const allManifests = executor.registry.getAllManifests()
    const manifest = allManifests.find(m => m.namespace === args.namespace)

    if (!manifest) {
      this.error(`Namespace "${args.namespace}" not found`)
    }

    const auth = getAuthConfig(manifest)
    const authServiceName = auth?.serviceName ?? manifest.namespace
    const deleted = deleteTokenForNamespace(authServiceName)

    if (deleted) {
      this.logToStderr(`${noColor ? '[OK]' : '✅'} ${args.namespace} 로그아웃 완료`)
    } else {
      this.logToStderr(`${args.namespace}: 저장된 토큰이 없습니다.`)
    }

    if (flags.json) this.log(JSON.stringify({action: 'logout', namespace: args.namespace}))
  }
}
