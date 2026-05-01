import {Command, Flags} from '@oclif/core'
import {existsSync, mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {ConfigManager} from '../core/config.js'
import {t} from '../core/i18n.js'

export default class Init extends Command {
  static override description = '프로젝트 초기화'

  static override flags = {
    force: Flags.boolean({char: 'f', description: '기존 설정 덮어쓰기'}),
    endpoint: Flags.string({
      description: 'API 엔드포인트 URL을 ~/.<cli>/config.yaml 의 endpointUrl 키로 저장 (manifest 의 ${@endpointUrl} placeholder 가 이 값을 사용)',
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Init)
    const projectDir = join(process.cwd(), '.union-cli')
    const pluginsDir = join(process.cwd(), 'plugins')
    const projectInitialized = existsSync(projectDir)

    if (projectInitialized && !flags.force && !flags.endpoint) {
      this.log(t('init.alreadyInitialized'))
      return
    }

    // 프로젝트 init: --force 또는 미초기화 상태에서만 mkdir.
    // --endpoint 단독 호출 시에는 글로벌 설정만 저장하고 프로젝트 디렉토리는 건드리지 않는다.
    if (!projectInitialized || flags.force) {
      mkdirSync(projectDir, {recursive: true})
      mkdirSync(pluginsDir, {recursive: true})
      this.log(t('init.projectDone'))
      this.log(t('init.nextStep1'))
      this.log(t('init.nextStep2', {cli: this.config.bin}))
    }

    // 글로벌 사용자 설정 (~/.<bin>/config.yaml)
    if (flags.endpoint) {
      const cfg = new ConfigManager(this.config.bin)
      await cfg.set('endpointUrl', flags.endpoint)
      this.log(t('init.endpointSaved', {url: flags.endpoint}))
      this.log(t('init.endpointPath', {path: cfg.configDir}))
      this.log(t('init.endpointHint'))
    }
  }
}
