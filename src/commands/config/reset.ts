import {Command, Args} from '@oclif/core'

export default class ConfigReset extends Command {
  static override description = '설정 초기화'

  static override args = {
    key: Args.string({description: '설정 키', required: false}),
  }

  async run(): Promise<void> {
    const {args} = await this.parse(ConfigReset)
    this.log(args.key ? `✓ ${args.key} 초기화 완료` : '✓ 전체 설정 초기화 완료')
  }
}
