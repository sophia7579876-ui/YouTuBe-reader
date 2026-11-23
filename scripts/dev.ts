import { spawn } from 'node:child_process'

const children = [
  spawn(process.execPath, ['--use-env-proxy', '--import', 'tsx', 'apps/api/src/index.ts'],
    {stdio: 'inherit', env: {...process.env, PORT: process.env.API_PORT ?? '3000'}}),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'apps/web/vite.config.ts'],
    {stdio: 'inherit'}),
]
let stopping = false
function stop(code: number) {
  if (stopping) return
  stopping = true
  children.forEach(child => child.kill())
  process.exitCode = code
}
for (const child of children) {
  child.on('exit', code => stop(code ?? 0))
  child.on('error', error => { console.error(error); stop(1) })
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
