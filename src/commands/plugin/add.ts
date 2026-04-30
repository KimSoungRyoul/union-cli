import {Command, Args} from '@oclif/core'

export default class PluginAdd extends Command {
  static override description = '플러그인 추가'

  static override args = {
    source: Args.string({required: true, description: '플러그인 경로 또는 npm 패키지'}),
  }

  async run(): Promise<void> {
    const {args} = await this.parse(PluginAdd)
    this.log(`플러그인 추가: ${args.source} (구현 예정)`)
  }
}
