# Continuing Voicible development — handoff prompt

Paste everything below this line into your new Claude Code session on the MacBook Pro, from the project root (the folder containing `package.json`, `server/`, `client/`, `sign_processor/`, `data/`).

---

I'm continuing development on **Voicible**, a real-time speech-to-ASL interpreter that animates a 3D avatar using **real motion-capture sign data** (the SLMocapArchive by Studio Galt, CC0 license) — never AI-generated or synthesized poses. Read `README.md` first for the full architecture, credit, and honest-limitations sections; it's the source of truth and I won't repeat all of it here. Also skim the big header comment in `sign_processor/mocap_indexer.py` — it documents the real (non-obvious) archive folder/file schema in detail.

## Where things stand

**Core pipeline is built and was working end-to-end** against a small real archive subset: STT → LLM gloss conversion (gloss/word-order only, never motion synthesis) → domain vocabulary preprocessing → mocap dictionary/fingerspelling lookup (`sign_processor/mocap_indexer.py`, a Flask microservice) → pose stitching/interpolation across a sign's ordered keyposes (`server/pose/poseStitcher.js`) → WebSocket broadcast → React/Three.js avatar (`client/src/avatar/`).

**Archive data — check this first.** I was mid-way through manually reconstructing full-alphabet fingerspelling data letter-by-letter (via a browser-based non-identity-bone-diff extraction, because the sandboxed environment I was working in couldn't pull the ~130KB pose files directly — hard fetch-size caps everywhere). That workaround should now be **irrelevant on this machine**: I gave instructions to download the real archive folders directly via DownGit or `git sparse-checkout` (full, authoritative files, no reconstruction needed). **First thing to check:** does `data/mocap-archive/SG ASL Fingerspelling/Letters/` and `data/mocap-archive/SG ASL Dictionary/` now contain complete real files for every letter/word, or is it still the partial set from before? As of the last check before the move:
- Complete (ReadMe + ShapeKeys + verified pose JSON): letters A, B, C, D, E, F, G, H, I, K, N, O, T, U, Y, plus dictionary words CHURCH and HELLO.
- Letter J has its docs but not pose data — and **J is not a static handshape** like the others; its ReadMe lists 3 keyposes (it traces a shape in the air), so it needs P1/P2/P3 pose files, not just P1. Watch for other letters/words with this same multi-keypose pattern — don't assume every sign is a single static pose.
- Letters L, M, Q, R, S, V, W, X, Z were still empty stub folders.

If the real files are now in place, just delete/ignore that context — pull whatever's still missing directly with `git`/`curl`/DownGit (you have normal network access here, unlike the sandbox I was in), no clever workarounds needed.

**Vocabulary coverage is thin.** `data/vocabulary/church.json` maps ~24 words, but last I checked the archive itself only actually contained real signs for 3 of them (CHURCH, BIBLE, BLESS) — everything else falls back to fingerspelling. Worth re-checking against whatever's now in `data/mocap-archive/SG ASL Dictionary/` and expanding the vocabulary file to match what's really there, rather than assuming the mapping is accurate.

**`server/pose/fbxConverter.js` is real but deliberately NOT wired into the main pipeline.** It converts each sign's "No Mesh Mixamo" FBX to `.glb` on demand (debug endpoint: `GET /debug/fbx-preview?uploadFolder=...`), useful for consultant preview or retargeting onto a different avatar. It's not part of live playback because: (1) the baked FBX plays at 24fps vs. the JSON pipeline's 60fps assumption, and I never verified a real conversion factor; (2) the lightweight FBX variant has no mesh, so no facial shapekeys — ASL facial grammar only exists in each sign's `ShapeKeys.txt`. Full reasoning is in the file's header comment. Don't wire it into the main pipeline without actually solving both of those.

**Before any real deployment:** `docs/consultant-review-packet.md` is a ready-to-hand-off packet for a Deaf/certified ASL consultant to review the vocabulary and sign choices — the archive's creator is a hearing person, not a certified translator, by his own admission. This hasn't happened yet and is a hard prerequisite before using this for an actual church service.

## Suggested next steps

1. Verify the real archive data landed correctly (see above) and re-run `python3 sign_processor/mocap_indexer.py` — check `/words` and `/health` to see actual current coverage (letters indexed, words indexed).
2. Fill in any still-missing letters/words directly from the repo now that you're not fetch-size-constrained.
3. Reconcile `data/vocabulary/church.json` against what's actually in the archive.
4. Run the full pipeline end-to-end (`npm run dev`) with a real or test utterance and confirm avatar playback looks right, especially for any multi-keypose signs (J, and whatever else turns out to need it).
5. Only after that: consider the consultant review packet handoff before treating this as production-ready.
