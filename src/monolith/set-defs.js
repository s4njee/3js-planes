// Single model collection for Planes.
// This project intentionally removes Monolith's multi-set switching and keeps
// one ordered list of models plus the appearance rules for that collection.

export const MODEL_SET_DEF = {
  models: [
    { key: '1', name: 'SR-71', path: '/set3/Meshy_AI_sr71_0404124235_texture.glb' },
    { key: '2', name: 'Concorde', path: '/set3/Meshy_AI_Concorde_in_Flight_ov_0404140408_texture.glb' },
    { key: '3', name: 'F-16', path: '/set3/Meshy_AI_Desert_Thunder_0404141103_texture.glb' },
    { key: '4', name: 'F-35', path: '/set3/Meshy_AI_F_22_Raptor_in_flight_0404140400_texture.glb' },
    { key: '5', name: 'F/A-18 Super Hornet', path: '/set3/Meshy_AI_F_A_18_Hornet_in_Flig_0404140344_texture.glb' },
    { key: '6', name: 'B-2', path: '/set3/Meshy_AI_b2_0404140608_texture.glb' },
    { key: '7', name: 'U-2', path: '/set3/Meshy_AI_B_52_Stratofortress_i_0404142231_texture.glb' },
  ],
  defaultModel: 0,
  defaultLighting: 0,
  lightingStyle: 'pointRing',
  nullBackground: true,
  positionYOffset: 0.8,
  rotationOverride: { x: -0.0215, y: 0.288, z: 0.288 },
  supportsAnimationSpeedBoost: true,
  xrayDistortionStrength: 1,
  xrayFlickerStrength: 1,
};
