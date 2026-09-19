import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // _archive 에 보관한 이전 버전의 테스트까지 끌어오지 않도록 대상을 못박는다.
    include: ['test/**/*.test.ts'],
  },
});
