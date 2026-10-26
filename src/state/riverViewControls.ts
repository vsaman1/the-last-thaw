/**
 * Commands from the river-view UI (the chip's buttons, keyboard shortcuts) to the camera rig that
 * owns the orbit camera. The rig registers while it is mounted; calls are no-ops otherwise.
 */
export interface RiverViewControls {
  /** Back to the whole-river framing. */
  reset(): void;
  /** Zoom about the spot at the screen centre: factor < 1 moves closer. */
  zoom(factor: number): void;
  /** Orbit (rad): +azimuth moves the camera to its right, +elevation raises it. */
  rotate(dAzimuth: number, dElevation: number): void;
  /** Move the view across the ground by fractions of the screen height (+right, +forward). */
  pan(right: number, forward: number): void;
}

let target: RiverViewControls | null = null;

/** The camera rig registers here; returns an unregister function. */
export function registerRiverViewControls(controls: RiverViewControls): () => void {
  target = controls;
  return () => {
    if (target === controls) target = null;
  };
}

export const riverViewControls: RiverViewControls = {
  reset: () => target?.reset(),
  zoom: (factor) => target?.zoom(factor),
  rotate: (dAzimuth, dElevation) => target?.rotate(dAzimuth, dElevation),
  pan: (right, forward) => target?.pan(right, forward),
};
