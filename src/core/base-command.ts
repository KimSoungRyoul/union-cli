import {Command, Flags} from '@oclif/core'
import {prompt, isNoInput} from './prompt.js'

/**
 * 누락된 required flag 정보. base-command 의 누락 검출에서 사용.
 */
interface MissingFlag {
  name: string
  description?: string
  hidden?: boolean
}

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
    'no-input': Flags.boolean({
      description: '대화형 prompt 비활성화 (CI/스크립트용)',
      helpGroup: 'GLOBAL',
    }),
  }

  protected parsedFlags!: Record<string, unknown>
  protected parsedArgs!: Record<string, unknown>

  async init(): Promise<void> {
    await super.init()
    // --no-input 또는 비-TTY 환경이 아니면, 누락된 required flag 를 prompt 로 채운다.
    await this.maybePromptMissingRequiredFlags()
    const {flags, args} = await this.parse(this.constructor as T)
    this.parsedFlags = flags as Record<string, unknown>
    this.parsedArgs = args as Record<string, unknown>
  }

  /**
   * 누락된 required flag 를 감지하고, TTY 인 경우 prompt 로 입력값을 받아
   * this.argv 에 주입한다. non-TTY/--no-input/NO_INPUT 인 경우엔 아무 것도 하지 않고,
   * oclif 의 기본 누락 에러가 동작하도록 둔다.
   */
  protected async maybePromptMissingRequiredFlags(): Promise<void> {
    // --no-input 플래그가 직접 들어왔는지 (parse 전이므로 argv 검사)
    if (this.argv.includes('--no-input')) return
    if (isNoInput()) return

    const missing = this.findMissingRequiredFlags()
    if (missing.length === 0) return

    for (const flag of missing) {
      const value = await prompt({
        message: flag.description ? `${flag.name} (${flag.description})` : flag.name,
        hidden: flag.hidden ?? false,
        validate: input => (input.trim() === '' ? `${flag.name} is required` : true),
      })
      // argv 에 주입 → 이후 super.parse() 가 정상 동작
      this.argv.push(`--${flag.name}`, value)
    }
  }

  /**
   * static flags 중 required: true 이면서 argv 에 등장하지 않은 항목을 반환.
   */
  protected findMissingRequiredFlags(): MissingFlag[] {
    const ctor = this.constructor as typeof Command
    // ctor.flags 와 ctor.baseFlags 모두 검사 — baseFlags 는 일반적으로 required 가 없지만 안전하게.
    const allFlags: Record<string, unknown> = {
      ...((ctor.baseFlags ?? {}) as Record<string, unknown>),
      ...((ctor.flags ?? {}) as Record<string, unknown>),
    }
    const missing: MissingFlag[] = []
    for (const [name, def] of Object.entries(allFlags)) {
      const flagDef = def as {
        required?: boolean
        description?: string
        char?: string
        type?: string
        hidden?: boolean
      } | undefined
      if (!flagDef?.required) continue
      if (this.flagPresentInArgv(name, flagDef.char)) continue
      // boolean flag 는 prompt 대상이 아님 (require + boolean 조합은 비일반적)
      if (flagDef.type === 'boolean') continue
      missing.push({
        name,
        description: flagDef.description,
        // 이름이 password/secret 류면 자동으로 hidden 처리
        hidden: isSecretLikeName(name),
      })
    }
    return missing
  }

  /**
   * --foo, --foo=bar, -f, -f=bar 형태 모두 검사.
   */
  protected flagPresentInArgv(name: string, char?: string): boolean {
    const long = `--${name}`
    const longEq = `--${name}=`
    const short = char ? `-${char}` : undefined
    const shortEq = char ? `-${char}=` : undefined
    for (const arg of this.argv) {
      if (arg === long) return true
      if (arg.startsWith(longEq)) return true
      if (short && arg === short) return true
      if (shortEq && arg.startsWith(shortEq)) return true
    }
    return false
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

/**
 * 이름이 password/secret/token 류면 prompt 시 입력을 가린다.
 */
function isSecretLikeName(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower.includes('password') ||
    lower.includes('passwd') ||
    lower.includes('secret') ||
    lower === 'pwd'
  )
}
