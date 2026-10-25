// 일시적 피드백(저장됨, 복사됨, 지움)을 sonner 토스트로 통일하는 얇은 래퍼.
// Toaster 는 루트 레이아웃에 한 번만 마운트돼 있고 aria-live="polite" 영역으로 읽힌다.
// 문구는 호출하는 쪽에서 t() 로 번역해서 넘긴다.

import { toast } from "sonner";

export interface NotifyOptions {
  // 보조 문구. 길어질 때만 쓴다.
  description?: string;
  // 기본 3초. 오류는 조금 더 오래 둔다.
  duration?: number;
}

export const notify = {
  success: (message: string, options?: NotifyOptions) => toast.success(message, { duration: 3000, ...options }),
  info: (message: string, options?: NotifyOptions) => toast.info(message, { duration: 3000, ...options }),
  warning: (message: string, options?: NotifyOptions) => toast.warning(message, { duration: 5000, ...options }),
  error: (message: string, options?: NotifyOptions) => toast.error(message, { duration: 5000, ...options }),
};
