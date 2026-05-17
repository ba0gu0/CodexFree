import { Duplex } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { safeSocketWrite } from './transport-utils'

class CallbackFailingSocket extends Duplex {
  destroyedWith: Error | undefined

  _read(): void {}

  _write(
    _chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    callback()
  }

  override write(
    _chunk: string | Uint8Array,
    callback?: (error: Error | null | undefined) => void
  ): boolean
  override write(
    _chunk: string | Uint8Array,
    _encoding: BufferEncoding,
    callback?: (error: Error | null | undefined) => void
  ): boolean
  override write(
    _chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error: Error | null | undefined) => void),
    maybeCallback?: (error: Error | null | undefined) => void
  ): boolean {
    let callback = maybeCallback
    if (typeof encodingOrCallback === 'function') {
      callback = encodingOrCallback
    }
    callback?.(new Error('write EPIPE'))
    return true
  }

  override destroy(error?: Error): this {
    this.destroyedWith = error
    return super.destroy()
  }
}

describe('transport socket utilities', () => {
  it('closes sockets after async write failures without re-emitting the write error', () => {
    const socket = new CallbackFailingSocket()

    expect(safeSocketWrite(socket, Buffer.from('late frame'))).toBe(true)

    expect(socket.destroyed).toBe(true)
    expect(socket.destroyedWith).toBeUndefined()
  })
})
