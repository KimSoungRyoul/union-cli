import {Command, Args} from '@oclif/core'

export default class PluginRemove extends Command {
  static override description = '플러그인 제거'

  static override args = {
    name: Args.string({required: true, description: '플러그인 이름'}),
  }

  async run(): Promise<void> {
    const {args} = await this.parse(PluginRemove)
    this.log(`플러그인 제거: ${args.name} (구현 예정)`)
  }
}
