import {Command, Flags} from '@oclif/core'

export default class PluginList extends Command {
  static override description = '플러그인 목록'

  static override flags = {
    json: Flags.boolean({description: 'JSON 출력'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(PluginList)
    if (flags.json) {
      this.log(JSON.stringify({plugins: []}, null, 2))
    } else {
      this.log('등록된 플러그인이 없습니다.')
    }
  }
}
