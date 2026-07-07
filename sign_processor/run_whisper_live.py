"""Voicible — local whisper-live server launcher.

Starts the whisper-live WebSocket server (collabora/WhisperLive,
faster-whisper backend) on the host/port Voicible's Node server expects
by default (see .env: WHISPER_LIVE_URL=ws://localhost:9090). The model
itself is chosen per-connection by the client (server/speech/providers/
whisperLiveProvider.js sends WHISPER_LIVE_MODEL in its init message), so
nothing model-specific needs to be configured here.

Run with the project venv: .venv/bin/python3 sign_processor/run_whisper_live.py
"""

from whisper_live.server import TranscriptionServer

if __name__ == "__main__":
    server = TranscriptionServer()
    server.run("0.0.0.0", port=9090, backend="faster_whisper")
