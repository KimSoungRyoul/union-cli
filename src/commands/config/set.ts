import {Command, Args, Flags} from '@oclif/core'
import {ConfigManager} from '../../core/config.js'

export default class ConfigSet extends Command {
  static override description = '설정값 저장'

  static override args = {
    key: Args.string({required: true, description: '설정 키'}),
    value: Args.string({required: true, description: '설정 값'}),
  }

  static override flags = {
    global: Flags.boolean({description: '글로벌 설정에 저장'}),
  }

  async run(): Promise<void> {
    const {args} = await this.parse(ConfigSet)
    const config = new ConfigManager(this.config.bin)
    await config.set(args.key, args.value)
    this.log(`✓ ${args.key} = ${args.value}`)
  }
}
