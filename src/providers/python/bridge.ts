import {spawn, type ChildProcess} from 'node:child_process'
import {existsSync} from 'node:fs'
import {resolve} from 'node:path'

export interface BridgeOptions {
  pythonPath?: string   // default: 'python3'
  module: string        // Python module to run
  persistent?: boolean  // keep process alive
  idleTimeout?: number  // ms, kill after idle (default 300000 = 5min)
  venv?: string         // virtualenv path — prepend to PATH
}

export interface BridgeCallResult {
  success: boolean
  data: unknown
  error?: string
}

export class PythonBridge {
  private process: ChildProcess | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private options: Required<BridgeOptions>

  constructor(options: BridgeOptions) {
    this.options = {
      pythonPath: options.pythonPath ?? 'python3',
      module: options.module,
      persistent: options.persistent ?? false,
      idleTimeout: options.idleTimeout ?? 300_000,
      venv: options.venv ?? '',
    }
  }

  /**
   * Call a Python function via JSON-RPC over the bridge process.
   *
   * 1. Ensure the bridge process is running (spawn if not).
   * 2. Send a JSON-RPC request via stdin.
   * 3. Read the response line from stdout.
   * 4. If not persistent, kill the process after the call.
   * 5. If persistent, reset the idle timer.
   */
  async call(functionName: string, kwargs: Record<string, unknown>): Promise<BridgeCallResult> {
    const proc = this.ensureProcess()

    const request = JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: {
        function: functionName,
        kwargs,
        module: this.options.module,
      },
      id: 1,
    })

    return new Promise<BridgeCallResult>((resolvePromise, reject) => {
      let responseLine = ''

      const onData = (chunk: Buffer) => {
        responseLine += chunk.toString()
        // Wait until we have a complete line (newline-delimited JSON)
        const newlineIndex = responseLine.indexOf('\n')
        if (newlineIndex === -1) return

        const line = responseLine.slice(0, newlineIndex).trim()
        responseLine = responseLine.slice(newlineIndex + 1)

        // Cleanup listener
        proc.stdout?.off('data', onData)
        proc.stderr?.off('data', onError)

        try {
          const response = JSON.parse(line)

          if (response.error) {
            resolvePromise({
              success: false,
              data: null,
              error: response.error.message ?? String(response.error),
            })
          } else {
            resolvePromise({
              success: true,
              data: response.result,
            })
          }
        } catch {
          reject(new Error(`Failed to parse bridge response: ${line}`))
        }

        // Post-call cleanup
        if (!this.options.persistent) {
          void this.shutdown()
        } else {
          this.resetIdleTimer()
        }
      }

      const onError = (chunk: Buffer) => {
        const stderr = chunk.toString().trim()
        if (stderr) {
          proc.stdout?.off('data', onData)
          proc.stderr?.off('data', onError)
          reject(new Error(`Python bridge stderr: ${stderr}`))
        }
      }

      proc.stdout?.on('data', onData)
      proc.stderr?.on('data', onError)

      proc.on('error', (err) => {
        proc.stdout?.off('data', onData)
        proc.stderr?.off('data', onError)
        reject(new Error(`Python bridge process error: ${err.message}`))
      })

      // Write the request to stdin
      proc.stdin?.write(request + '\n')
    })
  }

  /** Kill the Python bridge process and clear timers. */
  async shutdown(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }

    if (this.process) {
      this.process.stdin?.end()
      this.process.kill()
      this.process = null
    }
  }

  /** Spawn the bridge process if it is not already running. */
  private ensureProcess(): ChildProcess {
    if (this.process && this.process.exitCode === null) {
      return this.process
    }

    const pythonPath = this.options.venv
      ? resolve(this.options.venv, 'bin', 'python3')
      : this.options.pythonPath

    const bridgeScript = resolve(
      import.meta.dirname ?? new URL('.', import.meta.url).pathname,
      '..', '..', '..', 'bridge', 'union_cli_bridge.py',
    )

    if (!existsSync(bridgeScript)) {
      throw new Error(
        `Python bridge script not found at: ${bridgeScript}. ` +
        `Ensure the union-cli package is installed correctly.`,
      )
    }

    const env: Record<string, string> = {...process.env as Record<string, string>}
    if (this.options.venv) {
      env['PATH'] = resolve(this.options.venv, 'bin') + ':' + (env['PATH'] ?? '')
      env['VIRTUAL_ENV'] = this.options.venv
    }

    this.process = spawn(pythonPath, [bridgeScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    })

    this.process.on('error', (err) => {
      this.process = null
      throw new Error(`Failed to spawn Python bridge process: ${err.message}`)
    })

    if (this.options.persistent) {
      this.resetIdleTimer()
    }

    return this.process
  }

  /** Reset the idle timer — shuts down the process after idleTimeout ms. */
  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
    }

    this.idleTimer = setTimeout(() => {
      void this.shutdown()
    }, this.options.idleTimeout)
  }
}
