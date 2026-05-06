import React, { useState } from 'react'
import ConfirmModal, { ModalConfig } from '../components/ConfirmModal'

type ModalState = Omit<ModalConfig, 'onConfirm' | 'onCancel'> & { resolve: (v: boolean) => void }

export function useConfirm() {
  const [state, setState] = useState<ModalState | null>(null)

  const show = (cfg: Omit<ModalConfig, 'onConfirm' | 'onCancel'>): Promise<boolean> =>
    new Promise(resolve => setState({ ...cfg, resolve }))

  const close = (v: boolean) => { state?.resolve(v); setState(null) }

  const showConfirm = (message: string, detail?: string, confirmLabel?: string) =>
    show({ message, detail, confirmLabel, type: 'confirm' })

  const showDanger = (message: string, detail?: string, confirmLabel?: string) =>
    show({ message, detail, confirmLabel: confirmLabel || 'Delete', type: 'danger' })

  const showAlert = (message: string, detail?: string) =>
    show({ message, detail, type: 'alert' })

  const modal = state ? (
    <ConfirmModal {...state} onConfirm={() => close(true)} onCancel={() => close(false)} />
  ) : null

  return { modal, showConfirm, showDanger, showAlert }
}
