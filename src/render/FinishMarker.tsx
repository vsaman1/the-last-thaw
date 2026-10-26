import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useRuntime } from './RuntimeContext';

const BUOY_SPACING = 9;

/** A line of glowing buoys across the course at the finish line, out in open water. */
export function FinishMarker() {
  const rt = useRuntime();
  const ref = useRef<THREE.InstancedMesh>(null);

  const buoys = useMemo(() => {
    const { course, level } = rt.terrain;
    const half = course.sampleAt(level.finishS).halfWidth + 18;
    const out: { x: number; z: number; phase: number }[] = [];
    for (let d = -half; d <= half + 0.01; d += BUOY_SPACING) {
      const p = course.toWorld(level.finishS, d);
      out.push({ x: p.x, z: p.z, phase: out.length * 0.7 });
    }
    return out;
  }, [rt]);

  const geometry = useMemo(() => {
    const body = new THREE.CylinderGeometry(0.55, 0.75, 1.6, 7);
    body.translate(0, 0.5, 0);
    return body;
  }, []);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#C8F04A',
        emissive: '#9BE81A',
        emissiveIntensity: 1.4,
        flatShading: true,
        roughness: 0.5,
      }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const e = useMemo(() => new THREE.Euler(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const one = useMemo(() => new THREE.Vector3(1, 1, 1), []);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = rt.time;
    const sea = rt.level.seaLevel;
    buoys.forEach((b, i) => {
      pos.set(b.x, sea + Math.sin(t * 1.6 + b.phase) * 0.18, b.z);
      e.set(Math.sin(t * 1.1 + b.phase) * 0.08, 0, Math.cos(t * 0.9 + b.phase) * 0.08);
      q.setFromEuler(e);
      m.compose(pos, q, one);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geometry, material, buoys.length]} castShadow frustumCulled={false} />;
}
