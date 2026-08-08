import { useVoiceTest } from './useVoiceTest';

export function useTest() {
  const voiceTest = useVoiceTest();

  const test = voiceTest?.test
// test

  return 'test';
}