import {pathToFileURL} from 'node:url'

export type ModuleType = 'esm' | 'cjs'

export async function loadModule(modulePath: string): Promise<Record<string, unknown>> {
  // Try ESM import first, fallback to CJS require
  try {
    const url = pathToFileURL(modulePath).href
    return await import(url)
  } catch {
    // Fallback: try as package name (not file path)
    return await import(modulePath)
  }
}

export async function callFunction(
  mod: Record<string, unknown>,
  functionName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const fn = mod[functionName]
  if (typeof fn !== 'function') {
    throw new Error(
      `Function "${functionName}" not found in module. Available: ${Object.keys(mod).filter((k) => typeof mod[k] === 'function').join(', ')}`,
    )
  }
  return fn(args)
}
