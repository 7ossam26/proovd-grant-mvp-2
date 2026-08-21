import { afterEach, describe, expect, it, vi } from 'vitest';
import { speechSupported, startSpeech } from './speech.js';

type FakeRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onaudiostart: (() => void) | null;
};

const originalSpeechRecognition = Object.getOwnPropertyDescriptor(window, 'SpeechRecognition');

afterEach(() => {
  vi.useRealTimers();
  if (originalSpeechRecognition) {
    Object.defineProperty(window, 'SpeechRecognition', originalSpeechRecognition);
  } else {
    delete (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition;
  }
});

function installRecognition(
  behavior: (instance: FakeRecognitionInstance) => { start: () => void; stop: () => void; abort: () => void },
) {
  let latest: FakeRecognitionInstance | null = null;
  class FakeRecognition {
    continuous = false;
    interimResults = false;
    lang = '';
    onresult: ((event: unknown) => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    onaudiostart: (() => void) | null = null;
    start: () => void;
    stop: () => void;
    abort: () => void;

    constructor() {
      latest = this;
      const actions = behavior(this);
      this.start = actions.start;
      this.stop = actions.stop;
      this.abort = actions.abort;
    }
  }
  Object.defineProperty(window, 'SpeechRecognition', {
    configurable: true,
    writable: true,
    value: FakeRecognition,
  });
  return () => latest;
}

describe('speech recognition adapter', () => {
  it('reports support and forwards final/interim text', () => {
    const getRecognition = installRecognition((instance) => ({
      start: () => instance.onaudiostart?.(),
      stop: () => instance.onend?.(),
      abort: () => instance.onend?.(),
    }));
    const text: string[] = [];
    const ended = vi.fn();

    const session = startSpeech({
      onListening: vi.fn(),
      onText: (value) => text.push(value),
      onRefused: vi.fn(),
      onEnded: ended,
    });

    expect(speechSupported()).toBe(true);
    expect(session).not.toBeNull();
    const recognition = getRecognition()!;
    recognition.onresult?.({
      resultIndex: 0,
      results: [
        { isFinal: true, length: 1, 0: { transcript: 'hello' } },
        { isFinal: false, length: 1, 0: { transcript: 'world' } },
      ],
    });
    expect(text).toEqual(['hello world']);

    session!.stop();
    expect(ended).toHaveBeenCalledOnce();
  });

  it('returns no session when the initial start is rejected', () => {
    const getRecognition = installRecognition((instance) => ({
      start: () => {
        throw new Error('recognition unavailable');
      },
      stop: () => instance.onend?.(),
      abort: () => instance.onend?.(),
    }));

    expect(startSpeech({
      onListening: vi.fn(),
      onText: vi.fn(),
      onRefused: vi.fn(),
      onEnded: vi.fn(),
    })).toBeNull();
    expect(getRecognition()).not.toBeNull();
  });

  it('defers an automatic restart until the previous run has ended', () => {
    vi.useFakeTimers();
    let starts = 0;
    const getRecognition = installRecognition((instance) => ({
      start: () => {
        starts += 1;
      },
      stop: () => instance.onend?.(),
      abort: () => instance.onend?.(),
    }));
    const refused = vi.fn();
    const session = startSpeech({
      onListening: vi.fn(),
      onText: vi.fn(),
      onRefused: refused,
      onEnded: vi.fn(),
    });
    expect(session).not.toBeNull();
    expect(starts).toBe(1);

    getRecognition()!.onend?.();
    expect(starts).toBe(1);
    vi.runOnlyPendingTimers();
    expect(starts).toBe(2);
    expect(refused).not.toHaveBeenCalled();

    session!.abandon();
  });
});
