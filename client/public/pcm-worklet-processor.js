// Voicible — mic capture AudioWorklet processor
// "Every voice, made visible."
//
// Runs on the audio render thread. Buffers incoming Float32 mic samples
// (mono) and posts them to the main thread as Int16 PCM once enough have
// accumulated — the format whisper-live's server expects raw over the
// wire (see server/speech/providers/whisperLiveProvider.js and
// client/src/audio/micCapture.js for the rest of the chain).

const CHUNK_SAMPLES = 4096; // matches whisper-live's own reference client chunk size

class PCMWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
  }

  process(inputs) {
    const channelData = inputs[0]?.[0];
    if (channelData) {
      for (let i = 0; i < channelData.length; i++) {
        this.buffer.push(channelData[i]);
      }
      while (this.buffer.length >= CHUNK_SAMPLES) {
        const samples = this.buffer.splice(0, CHUNK_SAMPLES);
        const int16 = new Int16Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
          const s = Math.max(-1, Math.min(1, samples[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage(int16.buffer, [int16.buffer]);
      }
    }
    return true;
  }
}

registerProcessor('pcm-worklet-processor', PCMWorkletProcessor);
