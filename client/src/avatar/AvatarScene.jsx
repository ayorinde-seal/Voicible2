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
import { createFrameClock } from './poseUtils.js';

const AVATAR_MODEL_URL = import.meta.env.VITE_AVATAR_MODEL_URL || '/models/avatar.glb';

function AvatarModel({ poseSequence, onActiveFrame }) {
  const gltf = useGLTF(AVATAR_MODEL_URL, true, undefined, () => {
    // Silently tolerated — see the fallback placeholder in AvatarScene.
  });
  const groupRef = useRef();
  const boneLookupRef = useRef({});
  const morphMeshesRef = useRef([]);
  const clockRef = useRef(createFrameClock(poseSequence?.fps || 60));

  useEffect(() => {
    if (gltf?.scene) {
      boneLookupRef.current = buildBoneLookup(gltf.scene);
      morphMeshesRef.current = findMorphMeshes(gltf.scene);
    }
  }, [gltf]);

  useEffect(() => {
    clockRef.current.reset();
  }, [poseSequence]);

  useFrame((_state, delta) => {
    if (!poseSequence?.frames?.length) return;

    const { frameIndex } = clockRef.current.tick(delta, poseSequence.frames.length);
    const frame = poseSequence.frames[frameIndex];
    if (!frame) return;

    applyFrameToRig(frame, boneLookupRef.current);
    applyFacialFrame(frame, morphMeshesRef.current);

    if (onActiveFrame) onActiveFrame(frameIndex);
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

export default function AvatarScene({ poseSequence }) {
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
              <AvatarModel poseSequence={poseSequence} onActiveFrame={setActiveFrame} />
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
