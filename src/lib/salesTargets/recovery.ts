import { TargetTransportError, assertReceiptBinding } from './transport'
import type { TargetTransport } from './transport'
import type { CommandReceipt, ReconcileReceipt, TargetCommand } from './contracts'
export type RecoverySnapshot = { phase: 'idle' | 'sending' | 'uncertain' | 'checking' | 'retryable'; command: TargetCommand | null }
/** One in-memory request per actor/adapter draft session, with no automatic mutation retries. */
export class TargetCommandRecovery {
  private transport: TargetTransport
  snapshot: RecoverySnapshot = { phase: 'idle', command: null }
  constructor(transport: TargetTransport) { this.transport = transport }
  private async send(command: TargetCommand): Promise<CommandReceipt> {
    this.snapshot = { phase: 'sending', command }
    try {
      const result = await this.transport.command(command)
      this.snapshot = { phase: 'idle', command: null }
      return result
    } catch (error) {
      this.snapshot = error instanceof TargetTransportError && error.outcome === 'rejected' ? { phase: 'idle', command: null } : { phase: 'uncertain', command }
      throw error
    }
  }
  execute(command: TargetCommand): Promise<CommandReceipt> {
    if (this.snapshot.phase !== 'idle') return Promise.reject(new Error('Periksa hasil permintaan sebelumnya dahulu.'))
    return this.send(structuredClone(command))
  }
  async reconcile(): Promise<ReconcileReceipt> {
    const command = this.snapshot.command
    if (!command || this.snapshot.phase !== 'uncertain') throw new Error('Tidak ada hasil yang perlu diperiksa.')
    this.snapshot = { phase: 'checking', command }
    try {
      const result = await this.transport.reconcile(command.requestId)
      if (result.status === 'committed') {
        assertReceiptBinding(command, result)
        this.snapshot = { phase: 'idle', command: null }
      } else this.snapshot = { phase: 'retryable', command }
      return result
    } catch (error) { this.snapshot = { phase: 'uncertain', command }; throw error }
  }
  retry(): Promise<CommandReceipt> {
    if (!this.snapshot.command || this.snapshot.phase !== 'retryable') return Promise.reject(new Error('Periksa hasil sebelum mencoba lagi.'))
    return this.send(this.snapshot.command)
  }
}
