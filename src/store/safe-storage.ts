/**
 * localStorage 가 없거나 막혀도 앱이 멈추지 않게 한다.
 *
 * iOS 에서 파일(`file://`)로 연 페이지, 사파리 프라이빗 모드, 파일 앱 미리보기 등에서는
 * localStorage 접근이 예외를 던지거나 값이 유지되지 않는다.
 * 그런 환경에서는 메모리에만 담고, 화면에 "이 세션에서만 유지됨"을 알린다.
 */
const memory = new Map<string, string>();

let persistent: boolean | null = null;

export function isPersistent(): boolean {
  if (persistent !== null) return persistent;
  try {
    const probe = '__ars_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    persistent = true;
  } catch {
    persistent = false;
  }
  return persistent;
}

export const storage = {
  get(key: string): string | null {
    if (isPersistent()) {
      try {
        return localStorage.getItem(key);
      } catch {
        /* 아래 메모리로 떨어진다 */
      }
    }
    return memory.get(key) ?? null;
  },

  set(key: string, value: string) {
    memory.set(key, value);
    if (!isPersistent()) return;
    try {
      localStorage.setItem(key, value);
    } catch {
      persistent = false;
    }
  },

  remove(key: string) {
    memory.delete(key);
    if (!isPersistent()) return;
    try {
      localStorage.removeItem(key);
    } catch {
      persistent = false;
    }
  },
};
