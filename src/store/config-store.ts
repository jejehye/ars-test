import baked from '../assets/ars-config.json';
import type { ArsConfig } from '../domain/types';
import { storage } from './safe-storage';

const KEY = 'ars-test.config';

/**
 * 기본값은 빌드 시 구워진 설정에서 온다(`config/ars.config.json` → `src/assets/ars-config.json`).
 * 저장소에는 플레이스홀더만 들어 있고, 실제 번호는 로컬 설정 파일에서만 주입된다.
 * 단말에 저장된 값이 있으면 그쪽이 우선한다.
 */
export function loadConfig(): ArsConfig {
  const base = baked as unknown as ArsConfig;
  try {
    const saved = storage.get(KEY);
    return saved ? { ...base, ...(JSON.parse(saved) as Partial<ArsConfig>) } : base;
  } catch {
    return base;
  }
}

export function saveConfig(cfg: ArsConfig) {
  storage.set(KEY, JSON.stringify(cfg));
}

export const isConfigured = (cfg: ArsConfig) =>
  /^[0-9]{8,}$/.test(cfg.number.replace(/[^0-9]/g, ''));
