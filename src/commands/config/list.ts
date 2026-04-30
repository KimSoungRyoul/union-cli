import {Command, Flags} from '@oclif/core'
import {ConfigManager} from '../../core/config.js'

export default class ConfigList extends Command {
  static override description = '전체 설정 출력'

  static override flags = {
    json: Flags.boolean({description: 'JSON 출력'}),
    global: Flags.boolean({description: '글로벌 설정 조회'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ConfigList)
    const config = new ConfigManager(this.config.bin)
    const all = await config.list()
    if (flags.json) {
      this.log(JSON.stringify(all, null, 2))
    } else {
      for (const [key, value] of Object.entries(all)) {
        this.log(`${key} = ${value}`)
      }
    }
  }
}
