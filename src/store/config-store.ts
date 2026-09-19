import sample from '../../config/ars.config.sample.json';
import type { ArsConfig } from '../domain/types';

const KEY = 'ars-test.config';

/**
 * 실제 발신 번호는 저장소에 커밋하지 않는다.
 * 샘플 설정을 기본값으로 두고, 단말에 저장된 값으로 덮어쓴다.
 */
export function loadConfig(): ArsConfig {
  const base = sample as unknown as ArsConfig;
  try {
    const saved = localStorage.getItem(KEY);
    return saved ? { ...base, ...(JSON.parse(saved) as Partial<ArsConfig>) } : base;
  } catch {
    return base;
  }
}

export function saveConfig(cfg: ArsConfig) {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}

export const isConfigured = (cfg: ArsConfig) =>
  /^[0-9]{8,}$/.test(cfg.number.replace(/[^0-9]/g, ''));
