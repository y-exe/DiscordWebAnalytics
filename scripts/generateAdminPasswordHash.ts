import crypto from 'node:crypto'
import readline from 'node:readline'
import { Writable } from 'node:stream'

const ITERATIONS = 600_000
const SALT_LENGTH = 16

async function main(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: new Writable({
      write(_chunk, _encoding, callback) {
        callback()
      },
    }),
    prompt: '',
  })

  process.stdout.write('管理者パスワード: ')
  const password = await new Promise<string>((resolve) => {
    rl.once('line', (line) => resolve(line))
  })
  rl.close()

  if (!password) {
    console.error('パスワードを空にはできません。')
    process.exit(1)
  }

  const salt = crypto.randomBytes(SALT_LENGTH)
  const passwordHash = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256')
  console.log(
    `pbkdf2-sha256$${ITERATIONS}$${salt.toString('base64url')}$${passwordHash.toString('base64url')}`,
  )
}

void main()
