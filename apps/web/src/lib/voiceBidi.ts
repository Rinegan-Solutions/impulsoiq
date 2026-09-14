/** PCM capture/playback for Strands BidiAgent (Nova Sonic) events. */

export const BIDI_INPUT_RATE = 16000;
export const BIDI_OUTPUT_RATE = 16000;

export function pcm16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function downsampleToPcm16(input: Float32Array, sourceRate: number, targetRate: number): Int16Array {
  const ratio = sourceRate / targetRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const sample = input[Math.floor(i * ratio)] ?? 0;
    out[i] = Math.max(-32768, Math.min(32767, sample * 32768));
  }
  return out;
}

export function audioInputEvent(base64: string, sampleRate = BIDI_INPUT_RATE) {
  return {
    type: 'bidi_audio_input' as const,
    audio: base64,
    format: 'pcm' as const,
    sample_rate: sampleRate,
    channels: 1,
  };
}

export function textInputEvent(text: string) {
  return { type: 'bidi_text_input' as const, text, role: 'user' as const };
}

export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private next = 0;
  private sources: AudioBufferSourceNode[] = [];

  constructor(private readonly sampleRate: number) {}

  async push(base64: string) {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: this.sampleRate });
      this.next = this.ctx.currentTime;
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    const buffer = this.ctx.createBuffer(1, float32.length, this.sampleRate);
    buffer.getChannelData(0).set(float32);
    const now = this.ctx.currentTime;
    if (this.next < now) this.next = now;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    source.start(this.next);
    this.next += buffer.duration;
    this.sources.push(source);
    source.onended = () => {
      this.sources = this.sources.filter((s) => s !== source);
    };
  }

  interrupt() {
    for (const source of this.sources) {
      try { source.stop(); } catch { /* already ended */ }
    }
    this.sources = [];
    if (this.ctx) this.next = this.ctx.currentTime;
  }

  close() {
    this.interrupt();
    void this.ctx?.close();
    this.ctx = null;
  }
}

type ProcessorNode = ScriptProcessorNode & { _stream?: MediaStream };

export async function startMicStream(
  send: (payload: object) => void,
): Promise<{ stop: () => void }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1) as ProcessorNode;
  processor._stream = stream;
  processor.onaudioprocess = (ev) => {
    const pcm = downsampleToPcm16(ev.inputBuffer.getChannelData(0), ctx.sampleRate, BIDI_INPUT_RATE);
    send(audioInputEvent(pcm16ToBase64(pcm)));
  };
  source.connect(processor);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  processor.connect(mute);
  mute.connect(ctx.destination);
  return {
    stop: () => {
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
