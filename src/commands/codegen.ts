import {Command, Args} from '@oclif/core'

export default class Codegen extends Command {
  static override description = 'TypeScript 코드 생성'

  static override args = {
    plugin: Args.string({required: true, description: '플러그인 이름'}),
  }

  async run(): Promise<void> {
    const {args} = await this.parse(Codegen)
    this.log(`${args.plugin} 코드 생성 (구현 예정)`)
  }
}
