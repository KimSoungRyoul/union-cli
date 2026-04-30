import {Command, Args} from '@oclif/core'
import {ConfigManager} from '../../core/config.js'

export default class ConfigGet extends Command {
  static override description = '설정값 조회'

  static override args = {
    key: Args.string({required: true, description: '설정 키'}),
  }

  async run(): Promise<void> {
    const {args} = await this.parse(ConfigGet)
    const config = new ConfigManager(this.config.bin)
    const value = await config.get(args.key)
    this.log(value !== undefined ? String(value) : `(${args.key} 설정되지 않음)`)
  }
}
