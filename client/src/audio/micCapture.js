// Voicible — microphone capture
// "Every voice, made visible."
//
// Captures the mic, resamples to 16kHz mono (whisper-live's expected
// input rate — see server/speech/providers/whisperLiveProvider.js and
// the whisper-live reference client, both int16 PCM @ 16kHz), and hands
// raw PCM chunks (ArrayBuffer of Int16 samples) to the caller, which
// streams them to the server over the existing WebSocket connection.
// Actual float->int16 conversion + chunking happens in the AudioWorklet
// (public/pcm-worklet-processor.js) so it runs on the audio thread, not
// the main thread.

export async function startMicCapture(onAudioChunk) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });

  // Requesting 16000 directly lets the browser do the resampling from
  // whatever the device's native rate is (usually 44.1/48kHz), so no
  // manual resampling is needed here.
  const audioContext = new AudioContext({ sampleRate: 16000 });
  await audioContext.audioWorklet.addModule('/pcm-worklet-processor.js');

  const source = audioContext.createMediaStreamSource(stream);
  const workletNode = new AudioWorkletNode(audioContext, 'pcm-worklet-processor');

  // TEMPORARY diagnostic — logs actual achieved sample rate plus a peak
  // amplitude reading every ~2s so we can tell silent-input (OS-level mic
  // permission/routing) apart from a real capture bug. Remove once mic
  // capture is confirmed working end-to-end.
  console.log('[micCapture] AudioContext sampleRate:', audioContext.sampleRate, '(requested 16000)');
  console.log('[micCapture] mic track settings:', stream.getAudioTracks()[0]?.getSettings());
  let chunkCount = 0;
  let peakSinceLastLog = 0;
  workletNode.port.onmessage = (event) => {
    chunkCount++;
    const int16 = new Int16Array(event.data);
    for (let i = 0; i < int16.length; i++) {
      const abs = Math.abs(int16[i]);
      if (abs > peakSinceLastLog) peakSinceLastLog = abs;
    }
    if (chunkCount % 8 === 0) {
      console.log(`[micCapture] chunk #${chunkCount}, peak amplitude since last log: ${peakSinceLastLog} / 32767`);
      peakSinceLastLog = 0;
    }
    onAudioChunk(event.data);
  };

  // Deliberately NOT connected to audioContext.destination — this feeds
  // the worklet only, so the mic is never played back through speakers.
  source.connect(workletNode);

  return {
    stop: () => {
      workletNode.port.onmessage = null;
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      audioContext.close();
    },
  };
}

export default { startMicCapture };
