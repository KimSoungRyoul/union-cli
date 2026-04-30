import {spawn} from 'node:child_process'

export interface ProcessOptions {
  binary: string
  args: string[]
  timeout?: number
  cwd?: string
}

export interface ProcessResult {
  stdout: string
  stderr: string
  exitCode: number
}

export async function spawnProcess(options: ProcessOptions): Promise<ProcessResult> {
  const {binary, args, timeout = 30_000, cwd} = options

  return new Promise<ProcessResult>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let killed = false

    const child = spawn(binary, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGKILL')
    }, timeout)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      if (err.code === 'ENOENT') {
        reject(new Error(
          `Command not found: "${binary}". Ensure it is installed and in your PATH.`,
        ))
      } else if (err.code === 'EACCES') {
        reject(new Error(
          `Permission denied: "${binary}". Check file permissions.`,
        ))
      } else {
        reject(err)
      }
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (killed) {
        reject(new Error(
          `Process "${binary}" timed out after ${timeout}ms and was killed.`,
        ))
        return
      }
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      })
    })
  })
}
