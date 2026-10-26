import type { PartDef, StructureDef } from './kit';

/**
 * A traffic light: a 5.2 m galvanised steel pole on a small plinth with a 2.6 m mast arm over the
 * lane; one signal head hangs at the arm's end (seen from far back) and one is on the pole at
 * eye height. Each head has red, amber and green lamps (PartDef.lamp) that the renderer lights from
 * the signal the light is bound to (BodySpec.signal: its junction and phase in the traffic
 * network), so the lamps always show what the vehicles obey.
 *
 * Placed automatically by the traffic system at the right kerb of every approach to a signalised
 * junction, facing the traffic (local +z), the arm reaching over the lane (local −x: the driver's
 * left). Designers may place one too; it binds to the nearest signalised approach within 30 m, else
 * it cycles on its own.
 *
 * One anchored body (0.3 t), breaks like a lamp post: a 30 t iceberg knocks it over at 4 m/s
 * (UPROOT: it topples as one body, its lamps go dark). Proxy: the pole's trunk.
 */

const POLE_H = 5.2;
const POLE_D = 0.16;
const ARM_L = 2.6;
const ARM_Y = POLE_H - 0.25;
const HEAD: [number, number, number] = [0.36, 1.0, 0.26];
const LAMP_D = 0.24;
const LAMP_STEP = 0.31;
const LAMPS = ['red', 'amber', 'green'] as const;
/** Unlit lamp tints (the renderer replaces them with the lit/dim colours). */
const DIM = { red: 0x3a0e0c, amber: 0x3a2a0a, green: 0x0c3a1e } as const;

/** One signal head centred at (x, y, z), lamps on its +z face. */
function head(x: number, y: number, z: number): PartDef[] {
  const parts: PartDef[] = [
    { shape: 'box', at: [x, y, z], size: HEAD, color: 'housing', decor: true },
    // Back plate with a light border reads at a distance.
    {
      shape: 'box',
      at: [x, y, z - HEAD[2] / 2 - 0.02],
      size: [0.62, 1.24, 0.03],
      color: 0x1a1c1e,
      decor: true,
    },
  ];
  LAMPS.forEach((lamp, k) => {
    const ly = y + (1 - k) * LAMP_STEP;
    parts.push(
      {
        shape: { type: 'cylinder', segments: 10 },
        at: [x, ly, z + HEAD[2] / 2 + 0.015],
        size: [LAMP_D, 0.03, LAMP_D],
        rot: [Math.PI / 2, 0, 0],
        color: DIM[lamp],
        decor: true,
        lamp,
      },
      // Visor over the lamp.
      {
        shape: 'box',
        at: [x, ly + LAMP_D / 2 + 0.02, z + HEAD[2] / 2 + 0.09],
        size: [LAMP_D + 0.06, 0.025, 0.17],
        color: 'housing',
        decor: true,
      },
    );
  });
  return parts;
}

const trafficLight: StructureDef = {
  kind: 'trafficLight',
  label: 'Traffic light',
  material: 'metal',
  footprint: 2.8,
  palettes: {
    pole: [0x8a8f93, 0x6c7277],
    housing: [0x23272a, 0x2b2f26],
    plinth: [0xa39f97],
  },
  build: () => [
    {
      part: 'trafficLight',
      stand: 'anchored',
      mass: 0.3,
      breakSpeed: 4,
      breakMode: 'uproot',
      proxy: 'trunk',
      trunkRadius: 0.12,
      shake: 'tilt',
      parts: [
        {
          shape: { type: 'cylinder', segments: 8 },
          name: 'pole',
          at: [0, POLE_H / 2, 0],
          size: [POLE_D, POLE_H, POLE_D],
          color: 'pole',
          weight: 0.75,
        },
        {
          shape: 'box',
          name: 'pole',
          at: [-ARM_L / 2, ARM_Y, 0],
          size: [ARM_L, 0.11, 0.11],
          color: 'pole',
          weight: 0.25,
        },
        {
          shape: { type: 'cylinder', segments: 8 },
          at: [0, 0.15, 0],
          size: [0.5, 0.3, 0.5],
          color: 'plinth',
          decor: true,
        },
        ...head(-ARM_L + 0.15, ARM_Y - HEAD[1] / 2 - 0.1, 0),
        ...head(0, 2.6, POLE_D / 2 + HEAD[2] / 2 + 0.02),
      ],
    },
  ],
};

export default trafficLight;
