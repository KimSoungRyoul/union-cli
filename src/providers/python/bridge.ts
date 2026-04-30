import {spawn, type ChildProcess} from 'node:child_process'
import {existsSync} from 'node:fs'
import {resolve} from 'node:path'

export interface BridgeOptions {
  pythonPath?: string         // default: 'python3'
  module: string              // Python module to run
  persistent?: boolean        // keep process alive
  idleTimeout?: number        // ms, kill after idle (default 300000 = 5min)
  venv?: string               // virtualenv path — prepend to PATH
  callTimeoutMs?: number      // ms, reject a single call if no response (default 60_000)
  shutdownGraceMs?: number    // ms, SIGTERM grace period before SIGKILL (default 3_000)
}

export interface BridgeCallResult {
  success: boolean
  data: unknown
  error?: string
  /** stderr captured during the call (warnings, debug output, error tracebacks). */
  stderrLog?: string
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
      callTimeoutMs: options.callTimeoutMs ?? 60_000,
      shutdownGraceMs: options.shutdownGraceMs ?? 3_000,
    }
  }

  /**
   * Call a Python function via JSON-RPC over the bridge process.
   *
   * 1. Ensure the bridge process is running (spawn if not).
   * 2. Send a JSON-RPC request via stdin.
   * 3. Read the response line from stdout.
   *    - stderr is accumulated separately; warnings (DeprecationWarning, etc.)
   *      are NOT treated as errors. Only abnormal exit (code !== 0) before a
   *      response, an 'error' event, or a call timeout will reject.
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
      let responseBuffer = ''
      let stderrBuffer = ''
      let settled = false
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null

      const cleanup = () => {
        proc.stdout?.off('data', onData)
        proc.stderr?.off('data', onStderr)
        proc.off('exit', onExit)
        proc.off('error', onProcError)
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
          timeoutHandle = null
        }
      }

      const settleResolve = (result: BridgeCallResult) => {
        if (settled) return
        settled = true
        cleanup()
        resolvePromise(result)
        // Post-call cleanup
        if (!this.options.persistent) {
          void this.shutdown()
        } else {
          this.resetIdleTimer()
        }
      }

      const settleReject = (err: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(err)
        if (!this.options.persistent) {
          void this.shutdown()
        }
      }

      const onData = (chunk: Buffer) => {
        responseBuffer += chunk.toString()
        // Wait until we have a complete line (newline-delimited JSON)
        const newlineIndex = responseBuffer.indexOf('\n')
        if (newlineIndex === -1) return

        const line = responseBuffer.slice(0, newlineIndex).trim()
        responseBuffer = responseBuffer.slice(newlineIndex + 1)

        try {
          const response = JSON.parse(line)
          const stderrLog = stderrBuffer.trim() || undefined

          if (response.error) {
            settleResolve({
              success: false,
              data: null,
              error: response.error.message ?? String(response.error),
              stderrLog,
            })
          } else {
            settleResolve({
              success: true,
              data: response.result,
              stderrLog,
            })
          }
        } catch {
          settleReject(new Error(`Failed to parse bridge response: ${line}`))
        }
      }

      const onStderr = (chunk: Buffer) => {
        // Accumulate but do NOT reject — Python warnings (DeprecationWarning,
        // FutureWarning, import-time prints) routinely arrive on stderr while
        // the call still succeeds. The buffer is surfaced on the result via
        // `stderrLog`, or used as the reject reason on abnormal exit.
        stderrBuffer += chunk.toString()
      }

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        // Process exited before delivering a response — treat as failure.
        // (If a response had already arrived we would have settled in onData
        // before the exit fires.)
        this.process = null
        const stderrTrim = stderrBuffer.trim()
        const reason = stderrTrim
          ? `Python bridge exited (code=${code}, signal=${signal ?? 'none'}): ${stderrTrim}`
          : `Python bridge exited before response (code=${code}, signal=${signal ?? 'none'})`
        settleReject(new Error(reason))
      }

      const onProcError = (err: Error) => {
        settleReject(new Error(`Python bridge process error: ${err.message}`))
      }

      proc.stdout?.on('data', onData)
      proc.stderr?.on('data', onStderr)
      proc.on('exit', onExit)
      proc.on('error', onProcError)

      // Per-call timeout — guards against a hung Python function that never
      // sends a response on stdout.
      if (this.options.callTimeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          const stderrTrim = stderrBuffer.trim()
          const detail = stderrTrim ? ` stderr: ${stderrTrim}` : ''
          settleReject(new Error(
            `Python bridge call timed out after ${this.options.callTimeoutMs}ms.${detail}`,
          ))
        }, this.options.callTimeoutMs)
      }

      // Write the request to stdin
      proc.stdin?.write(request + '\n')
    })
  }

  /**
   * Kill the Python bridge process and clear timers.
   *
   * Sends SIGTERM first, then waits up to `shutdownGraceMs` for the process
   * to exit gracefully. If it does not, sends SIGKILL.
   */
  async shutdown(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }

    const proc = this.process
    if (!proc) return

    this.process = null

    // Already exited — nothing to do.
    if (proc.exitCode !== null || proc.signalCode !== null) {
      proc.stdin?.end()
      return
    }

    proc.stdin?.end()

    await new Promise<void>((resolvePromise) => {
      let done = false
      const onExit = () => {
        if (done) return
        done = true
        clearTimeout(killTimer)
        resolvePromise()
      }
      proc.once('exit', onExit)

      const killTimer = setTimeout(() => {
        if (done) return
        // Grace period elapsed — force kill.
        try {
          proc.kill('SIGKILL')
        } catch {
          // process may already be dead
        }
      }, this.options.shutdownGraceMs)

      try {
        proc.kill('SIGTERM')
      } catch {
        // process may already be dead — settle immediately
        onExit()
      }
    })
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
