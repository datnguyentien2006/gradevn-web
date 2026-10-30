// Phản hồi âm thanh nhẹ (iOS không có navigator.vibrate).
// AudioContext chỉ mở được sau một thao tác chạm — gọi unlockAudio() trong
// handler chạm đầu tiên; mọi lỗi đều bỏ qua để không ảnh hưởng luồng quét.

type Tone = 'ready' | 'capture' | 'success' | 'error';

let audio: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    if (!audio) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      audio = new Ctor();
    }
    void audio.resume();
  } catch {
    audio = null;
  }
}

export function playTone(tone: Tone): void {
  try {
    if (!audio) return;
    const now = audio.currentTime;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const config: Record<Tone, { frequency: number; duration: number; type: OscillatorType }> = {
      ready: { frequency: 880, duration: 0.07, type: 'sine' },
      capture: { frequency: 620, duration: 0.09, type: 'triangle' },
      success: { frequency: 1046, duration: 0.16, type: 'sine' },
      error: { frequency: 220, duration: 0.22, type: 'sawtooth' }
    };
    const { frequency, duration, type } = config[tone];
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  } catch {
    // Thiết bị có thể chặn audio — bỏ qua.
  }
}
