// Single model collection for Planes.
// This project intentionally removes Monolith's multi-set switching and keeps
// one ordered list of models plus the appearance rules for that collection.

export const MODEL_SET_DEF = {
  models: [
    {
      key: '1',
      name: 'SR-71',
      path: '/set3/Meshy_AI_sr71_0404124235_texture.glb',
      engineShimmers: [
        { x: 6.13, y: 0.41, z: 1.4 },
        { x: 6.13, y: 0.41, z: -1.26 },
      ],
    },
    {
      key: '2',
      name: 'Apache',
      path: '/set3/Meshy_AI_Apache_0405134217_texture.glb',
    },
    {
      key: '3',
      name: 'Concorde',
      path: '/set3/Meshy_AI_Concorde_in_Flight_ov_0404140408_texture.glb',
      engineShimmers: [
        { x: 4.4, y: -0.64, z: 1.35 },
        { x: 4.4, y: -0.64, z: 1.12 },
        { x: 4.4, y: -0.64, z: -1.2 },
        { x: 4.4, y: -0.64, z: -0.97 },


      ],
    },
    { key: '4', name: 'F-16', path: '/set3/Meshy_AI_Desert_Thunder_0404141103_texture.glb',
         engineShimmers: [
        { x: 5.52, y: -0.64, z: 0 },
         ],
     },
    { key: '5', name: 'F-35', path: '/set3/Meshy_AI_F_22_Raptor_in_flight_0404140400_texture.glb',
               engineShimmers: [
        { x: 5.52, y: -0.36, z: 0 },
         ],
     },
    {
      key: '6',
      name: 'Osprey',
      path: '/set3/Meshy_AI_Osprey_0405140308_texture.glb',
    },
    { key: '7', name: 'F/A-18 Super Hornet', path: '/set3/Meshy_AI_F_A_18_Hornet_in_Flig_0404140344_texture.glb',
            engineShimmers: [
        { x: 4.96, y: -0.36, z: -0.29 },
        { x: 4.96, y: -0.36, z: 0.29 },

      ],
     },
    { key: '8', name: 'B-2', path: '/set3/Meshy_AI_b2_0404140608_texture.glb' },
    { key: '9', name: 'U-2', path: '/set3/Meshy_AI_B_52_Stratofortress_i_0404142231_texture.glb' },
    {
      key: '0',
      name: 'Black Hawk',
      path: '/set3/Meshy_AI_blackhawk_0405135622_texture.glb',
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
