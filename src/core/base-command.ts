import {Command, Flags} from '@oclif/core'

export abstract class BaseCommand<T extends typeof Command = typeof Command> extends Command {
  static baseFlags = {
    json: Flags.boolean({
      description: 'JSON 출력',
      helpGroup: 'GLOBAL',
    }),
    debug: Flags.boolean({
      description: '디버그 출력',
      helpGroup: 'GLOBAL',
    }),
    quiet: Flags.boolean({
      char: 'q',
      description: '최소 출력',
      helpGroup: 'GLOBAL',
    }),
    'no-color': Flags.boolean({
      description: '색상 비활성화',
      helpGroup: 'GLOBAL',
    }),
    format: Flags.string({
      description: '출력 형식',
      options: ['table', 'json', 'yaml', 'csv'],
      helpGroup: 'GLOBAL',
    }),
  }

  protected parsedFlags!: Record<string, unknown>
  protected parsedArgs!: Record<string, unknown>

  async init(): Promise<void> {
    await super.init()
    const {flags, args} = await this.parse(this.constructor as T)
    this.parsedFlags = flags as Record<string, unknown>
    this.parsedArgs = args as Record<string, unknown>
  }

  protected get outputFormat(): string {
    if (this.parsedFlags.json) return 'json'
    return (this.parsedFlags.format as string) ?? 'table'
  }

  protected get isDebug(): boolean {
    return this.parsedFlags.debug as boolean ?? false
  }

  protected get isQuiet(): boolean {
    return this.parsedFlags.quiet as boolean ?? false
  }
}
