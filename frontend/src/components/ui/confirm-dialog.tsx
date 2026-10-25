"use client"

// window.confirm() 대체. dialog 위에 얹은 확인 대화상자다.
//   * 초기 포커스는 항상 안전한 쪽(취소 버튼)에 둔다. Esc 와 바깥 클릭은 취소.
//   * 닫으면 열기 전에 포커스가 있던 요소로 돌아간다 (base-ui dialog 기본 동작).
//   * 900px 이하에서는 dialog 가 하단 시트로 바뀐다 (DialogContent 의 반응형 클래스).
//
// 사용법 1) 선언형: <ConfirmDialog open onOpenChange title description onConfirm />
// 사용법 2) 명령형: const { confirm, confirmDialog } = useConfirm();
//                  if (!(await confirm({ title, description, confirmLabel, destructive: true }))) return;
//                  return (<>... {confirmDialog}</>);

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useT } from "@/lib/i18n/client"

export interface ConfirmOptions {
  title: React.ReactNode
  description?: React.ReactNode
  // 동작을 드러내는 문구("초기화" 등)를 호출 쪽이 정한다.
  confirmLabel: string
  // 비우면 common.cancel.
  cancelLabel?: string
  // true 면 확인 버튼이 destructive 스타일이 된다.
  destructive?: boolean
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean
  onOpenChange: (open: boolean) => void
  // 확인 버튼을 눌렀을 때. 대화상자는 이 뒤에 닫힌다.
  onConfirm: () => void
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  const t = useT()
  const cancelRef = React.useRef<HTMLButtonElement>(null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} initialFocus={cancelRef} role="alertdialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Promise 기반 훅. confirm() 을 부르면 대화상자가 열리고, 확인이면 true, 그 외 닫힘은 false 로 resolve.
function useConfirm() {
  const [state, setState] = React.useState<{ options: ConfirmOptions; open: boolean } | null>(null)
  const resolverRef = React.useRef<((value: boolean) => void) | null>(null)

  const settle = React.useCallback((value: boolean) => {
    resolverRef.current?.(value)
    resolverRef.current = null
  }, [])

  const confirm = React.useCallback(
    (options: ConfirmOptions) => {
      // 이미 열려 있으면 앞선 요청은 취소로 끝낸다.
      settle(false)
      return new Promise<boolean>((resolve) => {
        resolverRef.current = resolve
        setState({ options, open: true })
      })
    },
    [settle]
  )

  const confirmDialog = state ? (
    <ConfirmDialog
      {...state.options}
      open={state.open}
      onOpenChange={(open) => {
        if (!open) {
          // onConfirm 이 먼저 true 로 settle 하므로 여기서는 취소 경로만 false 가 된다.
          settle(false)
          setState((prev) => (prev ? { ...prev, open: false } : prev))
        }
      }}
      onConfirm={() => settle(true)}
    />
  ) : null

  return { confirm, confirmDialog }
}

export { ConfirmDialog, useConfirm }
