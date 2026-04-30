import {Command, Flags} from '@oclif/core'
import {build} from '../build/builder.js'

export default class Build extends Command {
  static override description = 'YAML manifest → CLI 빌드'

  static override flags = {
    codegen: Flags.boolean({description: 'TypeScript 코드 생성 모드'}),
    watch: Flags.boolean({description: '파일 변경 감지 모드'}),
  }

  static override examples = [
    '<%= config.bin %> build',
    '<%= config.bin %> build --codegen',
  ]

  async run(): Promise<void> {
    const {flags: _flags} = await this.parse(Build)

    this.log('Building...')
    const result = await build()

    for (const warning of result.warnings) {
      this.warn(warning)
    }

    for (const error of result.errors) {
      this.warn(error)
    }

    if (result.manifests.length > 0) {
      this.log(`${result.manifests.length}개 manifest에서 빌드 완료`)
      this.log(`  캐시: ${result.cachePath}`)
      const totalCmds = result.manifests.reduce((sum, m) => sum + m.commands.length, 0)
      this.log(`  명령: ${totalCmds}개`)
    }

    if (result.errors.length > 0 && result.manifests.length === 0) {
      this.error('빌드 실패')
    }
  }
}
