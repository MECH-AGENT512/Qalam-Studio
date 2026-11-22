import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Box, Download, RotateCcw } from 'lucide-react';
import type { ThreeConceptScene, ThreePrimitivePart } from '../types';

interface ThreeConceptViewerProps {
  sceneData: ThreeConceptScene;
}

export const ThreeConceptViewer: React.FC<ThreeConceptViewerProps> = ({ sceneData }) => {
  const parts = Array.isArray(sceneData?.parts) ? sceneData.parts : [];
  const engineeringNotes = Array.isArray(sceneData?.engineeringNotes)
    ? sceneData.engineeringNotes
    : [];

  const containerRef = useRef<HTMLDivElement | null>(null);
  const meshesRef = useRef<THREE.Mesh[]>([]);
  const wireframeRef = useRef(false);
  const [wireframe, setWireframe] = useState(false);
  const [selectedPart, setSelectedPart] = useState<ThreePrimitivePart | null>(
    parts[0] ?? null
  );
  const cameraResetRef = useRef<() => void>(() => {});

  useEffect(() => {
    setSelectedPart((Array.isArray(sceneData?.parts) ? sceneData.parts[0] : null) ?? null);
  }, [sceneData]);

  useEffect(() => {
    wireframeRef.current = wireframe;
    for (const m of meshesRef.current) {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.wireframe = wireframe;
      mat.needsUpdate = true;
    }
  }, [wireframe]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 380;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0F172A');

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    let theta = 0.7;
    let phi = 1.1;
    let radius = 8.5;

    const updateCamera = () => {
      camera.position.x = radius * Math.sin(phi) * Math.cos(theta);
      camera.position.y = radius * Math.cos(phi);
      camera.position.z = radius * Math.sin(phi) * Math.sin(theta);
      camera.lookAt(0, 0, 0);
    };
    updateCamera();

    cameraResetRef.current = () => {
      theta = 0.7;
      phi = 1.1;
      radius = 8.5;
      updateCamera();
    };

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const grid = new THREE.GridHelper(12, 12, '#334155', '#1E293B');
    grid.position.y = -2.2;
    scene.add(grid);

    const ambient = new THREE.AmbientLight('#FFFFFF', 0.75);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight('#FFFFFF', 1.4);
    keyLight.position.set(6, 10, 8);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#60A5FA', 0.65);
    rimLight.position.set(-6, 4, -6);
    scene.add(rimLight);

    const group = new THREE.Group();
    const meshes: THREE.Mesh[] = [];
    const safeParts = Array.isArray(sceneData?.parts) ? sceneData.parts : [];

    for (const part of safeParts) {
      let geometry: THREE.BufferGeometry;
      switch (part.shape) {
        case 'cylinder':
          geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 28);
          break;
        case 'sphere':
          geometry = new THREE.SphereGeometry(0.55, 28, 20);
          break;
        case 'cone':
          geometry = new THREE.ConeGeometry(0.55, 1, 28);
          break;
        case 'torus':
          geometry = new THREE.TorusGeometry(0.5, 0.18, 16, 36);
          break;
        case 'box':
        default:
          geometry = new THREE.BoxGeometry(1, 1, 1);
          break;
      }

      const material = new THREE.MeshStandardMaterial({
        color: part.color || '#3B82F6',
        metalness: typeof part.metalness === 'number' ? Math.min(1, Math.max(0, part.metalness)) : 0.3,
        roughness: typeof part.roughness === 'number' ? Math.min(1, Math.max(0, part.roughness)) : 0.5,
        wireframe: wireframeRef.current,
      });

      const mesh = new THREE.Mesh(geometry, material);
      const pos = part.position?.length === 3 ? part.position : [0, 0, 0];
      const rot = part.rotation?.length === 3 ? part.rotation : [0, 0, 0];
      const scl = part.scale?.length === 3 ? part.scale : [1, 1, 1];

      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.rotation.set(rot[0], rot[1], rot[2]);
      mesh.scale.set(
        Math.max(0.08, scl[0]),
        Math.max(0.08, scl[1]),
        Math.max(0.08, scl[2])
      );
      mesh.userData = { part };
      meshes.push(mesh);
      group.add(mesh);
    }

    meshesRef.current = meshes;
    scene.add(group);

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      theta -= dx * 0.008;
      phi = Math.max(0.25, Math.min(Math.PI - 0.25, phi - dy * 0.008));
      updateCamera();
    };
    const onPointerUp = () => {
      dragging = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      radius = Math.max(3.2, Math.min(18, radius + e.deltaY * 0.005));
      updateCamera();
    };

    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('wheel', onWheel, { passive: false });

    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth || 640;
      const h = container.clientHeight || 380;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      if (!dragging) {
        group.rotation.y += 0.0025;
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('wheel', onWheel);
      meshesRef.current = [];
      for (const m of meshes) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      renderer.dispose();
    };
  }, [sceneData]);

  const downloadSceneJson = () => {
    const blob = new Blob([JSON.stringify(sceneData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(sceneData?.title || '3d-concept').toLowerCase().replace(/[^a-z0-9]+/g, '-') || '3d-concept'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {sceneData?.title || '3D Concept Model'}
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Drag to orbit · Scroll to zoom · {parts.length} parametric components
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWireframe((w) => !w)}
            className={`px-3 py-1.5 min-h-[38px] text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
              wireframe
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            Wireframe
          </button>
          <button
            type="button"
            onClick={() => cameraResetRef.current()}
            className="flex items-center gap-1.5 px-3 py-1.5 min-h-[38px] text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset View</span>
          </button>
          <button
            type="button"
            onClick={downloadSceneJson}
            className="flex items-center gap-1.5 px-3 py-1.5 min-h-[38px] text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export JSON</span>
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="w-full h-[340px] sm:h-[400px] rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 cursor-grab active:cursor-grabbing touch-none"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 p-4">
          <h5 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2.5">
            Assembly Components
          </h5>
          <div className="flex flex-wrap gap-1.5">
            {parts.map((part, idx) => (
              <button
                key={`${part.name}-${idx}`}
                type="button"
                onClick={() => setSelectedPart(part)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                  selectedPart?.name === part.name
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                }`}
              >
                <Box className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[140px]">{part.name}</span>
              </button>
            ))}
          </div>
          {selectedPart && (
            <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 space-y-1">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                {selectedPart.name} ({selectedPart.shape})
              </div>
              <p>{selectedPart.annotation}</p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 p-4">
          <h5 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
            Engineering & Spatial Notes
          </h5>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mb-2">
            {sceneData?.summary}
          </p>
          <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-400 list-disc pl-4">
            {engineeringNotes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
