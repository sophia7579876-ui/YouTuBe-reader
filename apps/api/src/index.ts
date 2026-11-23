import { createApp } from './app.ts'

const app = createApp({logger: true})
const stop = () => { void app.close().then(() => { process.exitCode = 0 }) }
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
await app.listen({port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '127.0.0.1'})
