// Voicible — Three.js avatar scene
// "Every voice, made visible."
//
// Loads the avatar GLTF (Galtis rig or a retargeted custom avatar) and
// plays back the stitched keyframe stream (real mocap data, blended by
// server/pose/poseStitcher.js) at the archive's native 60fps, including
// FACS facial shapekeys — never synthesized poses.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment } from '@react-three/drei';
import { buildBoneLookup, applyFrameToRig } from './AvatarRig.js';
import { findMorphMeshes, applyFacialFrame } from './FacialBlendshapes.js';
import { createFrameClock, blendFrames, easeInOut } from './poseUtils.js';

const AVATAR_MODEL_URL = import.meta.env.VITE_AVATAR_MODEL_URL || '/models/avatar.glb';
// Cross-fade duration when the queue (App.jsx's poseQueueRef) advances to
// a new sequence — server/pose/poseStitcher.js already blends WORD-to-WORD
// transitions within one stitched sequence, but streaming (server's
// createUtteranceChunker) now regularly splits one utterance into several
// separate sequences that queue up client-side, and nothing blended THOSE
// boundaries: each one hard-cut into the next. This mirrors that same
// blend, just client-side, from whatever frame was actually last applied.
const SEQUENCE_BLEND_DURATION_S = 0.25;

function AvatarModel({ poseSequence, playbackSpeed = 1, onActiveFrame, onSequenceComplete }) {
  const gltf = useGLTF(AVATAR_MODEL_URL, true, undefined, () => {
    // Silently tolerated — see the fallback placeholder in AvatarScene.
  });
  const groupRef = useRef();
  const boneLookupRef = useRef({});
  const morphMeshesRef = useRef([]);
  const clockRef = useRef(createFrameClock(poseSequence?.fps || 60));
  // Guards against calling onSequenceComplete more than once for the same
  // sequence — useFrame keeps ticking every render frame while React's
  // state update (swapping in the next queued sequence) is still async.
  const completedRef = useRef(false);
  // The last frame actually applied to the rig — the cross-fade source
  // for the NEXT sequence, whatever it turns out to be and whenever it
  // arrives (persists across the queue draining to empty, so even a
  // sequence arriving after a pause blends from rather than snaps to).
  const lastFrameRef = useRef(null);
  // null = not currently blending; number = seconds into the blend.
  const blendElapsedRef = useRef(null);

  useEffect(() => {
    if (gltf?.scene) {
      boneLookupRef.current = buildBoneLookup(gltf.scene);
      morphMeshesRef.current = findMorphMeshes(gltf.scene);
      // Debug handle for external inspection (headed-browser verification).
      window.__avatarScene = gltf.scene;
      window.__boneLookup = boneLookupRef.current;
    }
  }, [gltf]);

  useEffect(() => {
    clockRef.current.reset();
    completedRef.current = false;
    // Nothing to blend FROM on the very first sequence ever played.
    blendElapsedRef.current = lastFrameRef.current ? 0 : null;
  }, [poseSequence]);

  useFrame((_state, delta) => {
    if (!poseSequence?.frames?.length) return;

    // Speed control scales elapsed time, not frame indices — playback
    // stays frame-accurate at any rate, and the cross-fade window
    // scales with it so transitions feel identical at every speed.
    const scaledDelta = delta * playbackSpeed;
    const { frameIndex, done } = clockRef.current.tick(scaledDelta, poseSequence.frames.length);
    let frame = poseSequence.frames[frameIndex];
    if (frame) {
      if (blendElapsedRef.current !== null) {
        blendElapsedRef.current += scaledDelta;
        const t = Math.min(1, blendElapsedRef.current / SEQUENCE_BLEND_DURATION_S);
        frame = blendFrames(lastFrameRef.current, frame, easeInOut(t));
        if (t >= 1) blendElapsedRef.current = null;
      }
      applyFrameToRig(frame, boneLookupRef.current);
      applyFacialFrame(frame, morphMeshesRef.current);
      lastFrameRef.current = frame;
      if (onActiveFrame) onActiveFrame(frameIndex);
    }

    if (done && !completedRef.current) {
      completedRef.current = true;
      if (onSequenceComplete) onSequenceComplete();
    }
  });

  if (!gltf?.scene) return null;
  return <primitive ref={groupRef} object={gltf.scene} position={[0, -1, 0]} />;
}

function PlaceholderAvatar() {
  // Shown when no avatar GLTF is present yet at /models/avatar.glb, so
  // the pipeline is still visually verifiable before the final rig is
  // dropped in (see README "Adding the avatar model").
  return (
    <mesh position={[0, 0, 0]}>
      <capsuleGeometry args={[0.4, 1.2, 8, 16]} />
      <meshStandardMaterial color="#2D6BE4" wireframe />
    </mesh>
  );
}

export default function AvatarScene({ poseSequence, playbackSpeed = 1, onSequenceComplete }) {
  const [hasAvatar, setHasAvatar] = useState(true);
  const [, setActiveFrame] = useState(0);

  const errorHandler = useMemo(
    () => () => setHasAvatar(false),
    []
  );

  return (
    <div style={{ width: '100%', height: '100%', background: 'radial-gradient(circle at 50% 30%, #22224a 0%, #1A1A2E 70%)' }}>
      <Canvas camera={{ position: [0, 0.4, 2.4], fov: 40 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[2, 4, 3]} intensity={1.1} color="#ffffff" />
        <pointLight position={[-2, 1, -2]} intensity={0.4} color="#00D4AA" />
        <React.Suspense fallback={<PlaceholderAvatar />}>
          {hasAvatar ? (
            <AvatarErrorBoundary onError={errorHandler}>
              <AvatarModel poseSequence={poseSequence} playbackSpeed={playbackSpeed} onActiveFrame={setActiveFrame} onSequenceComplete={onSequenceComplete} />
            </AvatarErrorBoundary>
          ) : (
            <PlaceholderAvatar />
          )}
        </React.Suspense>
        <OrbitControls enablePan={false} minDistance={1.2} maxDistance={4} target={[0, 0.2, 0]} />
        <Environment preset="city" />
      </Canvas>
    </div>
  );
}

// Minimal error boundary so a missing/broken GLTF falls back to the
// placeholder instead of blanking the whole display during a live service.
class AvatarErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    this.props.onError?.();
  }
  render() {
    if (this.state.hasError) return <PlaceholderAvatar />;
    return this.props.children;
  }
}
