// Single model collection for Planes.
// This project intentionally removes Monolith's multi-set switching and keeps
// one ordered list of models plus the appearance rules for that collection.

export const MODEL_SET_DEF = {
  models: [
    {
      key: '1',
      name: 'SR-71',
      path: '/set3/Meshy_AI_sr71_0404124235_texture.glb',
      // SR-71 cruise: Mach 3.2 ≈ 980 m/s at 85,000 ft
      speedMps: 980,
      realisticBoostSpeedMps: 980,
      altitudeM: 25900,
      engineShimmers: [
        { x: 6.13, y: 0.41, z: 1.4 },
        { x: 6.13, y: 0.41, z: -1.26 },
      ],
    },
    {
      key: '2',
      name: 'Apache',
      path: '/set3/Meshy_AI_Apache_0405134217_texture.glb',
      // AH-64 Apache cruise: ~70 m/s (135 kts)
      speedMps: 70,
      altitudeM: 500,
      engineShimmers: [],
    },
    {
      key: '3',
      name: 'Concorde',
      path: '/set3/Meshy_AI_Concorde_in_Flight_ov_0404140408_texture.glb',
      // Concorde cruise: Mach 2.04 ≈ 600 m/s at 60,000 ft
      speedMps: 600,
      altitudeM: 18300,
      engineShimmers: [
        { x: 4.4, y: -0.64, z: 1.35 },
        { x: 4.4, y: -0.64, z: 1.12 },
        { x: 4.4, y: -0.64, z: -1.2 },
        { x: 4.4, y: -0.64, z: -0.97 },


      ],
    },
    { key: '4', name: 'F-16', path: '/set3/Meshy_AI_Desert_Thunder_0404141103_texture.glb',
         // F-16 cruise: ~250 m/s (Mach 0.85)
         speedMps: 250,
         altitudeM: 9000,
         engineShimmers: [
        { x: 5.52, y: -0.64, z: 0 },
         ],
     },
    { key: '5', name: 'F-35', path: '/set3/Meshy_AI_F_22_Raptor_in_flight_0404140400_texture.glb',
               // F-22 cruise: ~460 m/s (supercruise Mach 1.5)
               speedMps: 460,
               altitudeM: 15000,
               engineShimmers: [
        { x: 5.52, y: -0.36, z: 0 },
         ],
     },
    {
      key: '6',
      name: 'Osprey',
      path: '/set3/Meshy_AI_Osprey_0405140308_texture.glb',
      // V-22 Osprey cruise: ~130 m/s (250 kts)
      speedMps: 130,
      altitudeM: 3000,
    },
    { key: '7', name: 'F/A-18 Super Hornet', path: '/set3/Meshy_AI_F_A_18_Hornet_in_Flig_0404140344_texture.glb',
            // F/A-18 cruise: ~260 m/s (Mach 0.87)
            speedMps: 260,
            altitudeM: 10000,
            engineShimmers: [
        { x: 4.96, y: -0.36, z: -0.29 },
        { x: 4.96, y: -0.36, z: 0.29 },

      ],
     },
    { key: '8', name: 'B-2', path: '/set3/Meshy_AI_b2_0404140608_texture.glb',
      // B-2 cruise: ~270 m/s (Mach 0.9)
      speedMps: 270,
      altitudeM: 15000,
    },
    { key: '9', name: 'U-2', path: '/set3/Meshy_AI_B_52_Stratofortress_i_0404142231_texture.glb',
      // U-2 cruise: ~220 m/s (410 kts) at 70,000 ft
      speedMps: 220,
      altitudeM: 21000,
    },
    {
      key: '0',
      name: 'Black Hawk',
      path: '/set3/Meshy_AI_blackhawk_0405135622_texture.glb',
      // UH-60 Black Hawk cruise: ~80 m/s (150 kts)
      speedMps: 80,
      altitudeM: 500,
      engineShimmers: [],
    },
  ],
  defaultModel: 0,
  defaultLighting: 1, // 1 is B (Particles)
  lightingStyle: 'pointRing',
  nullBackground: true,
  positionYOffset: 0.8,
  rotationOverride: { x: -0.0215, y: 0.288, z: 0.288 },
  supportsAnimationSpeedBoost: true,
  xrayDistortionStrength: 1,
  xrayFlickerStrength: 1,
};
