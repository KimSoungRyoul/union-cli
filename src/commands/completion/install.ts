import {Command, Args} from '@oclif/core'

export default class CompletionInstall extends Command {
  static override description = '셸 자동완성 설치'

  static override args = {
    shell: Args.string({required: false, description: '셸 (bash/zsh/fish)', default: 'zsh'}),
  }

  async run(): Promise<void> {
    const {args} = await this.parse(CompletionInstall)
    this.log(`${args.shell} 자동완성 설치 (구현 예정)`)
  }
}
