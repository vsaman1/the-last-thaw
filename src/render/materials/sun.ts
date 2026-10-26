import { Color, DirectionalLight, Fog, FogExp2, type Object3D, type Vector3 } from 'three';

/**
 * Finds the scene's main DirectionalLight (the lighting component may mount after the water)
 * and copies its direction / colour into shader uniforms each frame without allocating.
 */
export class SunTracker {
  private light: DirectionalLight | null = null;
  private nextSearch = 0;
  private readonly onVisit = (o: Object3D): void => {
    if (!(o instanceof DirectionalLight) || !o.visible) return;
    if (!this.light || o.intensity > this.light.intensity) this.light = o;
  };

  /**
   * Returns true when a light was found and the outputs were updated. `clock` (s) may restart from 0
   * (R3F resets its clock when the frameloop mode changes, e.g. on pause / resume).
   */
  update(scene: Object3D, clock: number, outDir: Vector3, outColor?: Color): boolean {
    if (this.light && !this.isAttached(this.light, scene)) this.light = null;
    if (!this.light && (clock >= this.nextSearch || clock < this.nextSearch - 1)) {
      this.nextSearch = clock + 1;
      scene.traverse(this.onVisit);
    }
    const l = this.light;
    if (!l) return false;
    const a = l.matrixWorld.elements;
    const b = l.target.matrixWorld.elements;
    const x = a[12] - b[12];
    const y = a[13] - b[13];
    const z = a[14] - b[14];
    const len = Math.hypot(x, y, z);
    if (len > 1e-6) outDir.set(x / len, y / len, z / len);
    outColor?.copy(l.color);
    return true;
  }

  private isAttached(o: Object3D, root: Object3D): boolean {
    let p: Object3D | null = o;
    while (p) {
      if (p === root) return true;
      p = p.parent;
    }
    return false;
  }
}

const WHITE = new Color(1, 1, 1);

/** Sky tint for fresnel reflections: the scene fog colour lifted toward white, if there is fog. */
export function skyTintFromScene(fog: unknown, out: Color): void {
  if (fog instanceof Fog || fog instanceof FogExp2) out.copy(fog.color).lerp(WHITE, 0.35);
}
