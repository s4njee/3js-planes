# Performance Ideas

## Next FPS Ideas

These are the next places worth testing before doing more broad refactors. They are ordered by likely FPS impact and implementation risk.

### A. Add adaptive DPR to the background renderer

The foreground `SafeCanvas` can now step down to DPR `0.75`, and `TilesBackgroundCanvas` now has matching adaptive scaling for the expensive tiles/clouds/atmosphere passes.

Status: implemented. `TilesBackgroundCanvas` now adapts background DPR through `1.25 -> 1 -> 0.75`, resyncs tile resolution after DPR changes, and reports background quality/DPR in the existing FPS meter.

Follow-up ideas:

- On low background DPR, keep clouds visible but reduce cloud coverage, shadow map size, and post passes.
- Tune the downshift/upshift thresholds after testing on target hardware.

### B. Make cloud quality degrade visually instead of disappearing

The no-cloud low tier looked bad, so the better path is softer degradation. Keep the cloud pass alive, but make it cheaper.

Ideas:

- On medium quality, lower `clouds.shadow.mapSize` to `256` and `cascadeCount` to `1`.
- On low quality, reduce `clouds.coverage` and shadow distance instead of disabling clouds.
- Add a manual cloud quality control: `High`, `Low`, `Off`. The automatic path should never jump all the way to `Off`.

### C. Disable or defer tile normal regeneration

`TileCreasedNormalsPlugin` runs `toCreasedNormals` on streamed tile geometry. That can cause both CPU spikes and GC while tiles stream in.

Ideas:

- Add a feature flag around `TileCreasedNormalsPlugin` and test FPS/frame pacing with it off.
- If the visual difference is acceptable, leave it off by default.
- If it is needed, run it only for high quality or only when the camera is idle.

### D. Throttle the minimap loop

`Minimap.jsx` still updates with `requestAnimationFrame`, including marker position, marker rotation, and `map.setCenter`. That is not the biggest GPU cost, but it can compete on the main thread.

Ideas:

- Update the minimap at 10-15 Hz.
- Only call `map.setCenter` when the lat/lon moved enough to change the displayed position.
- Pause minimap updates while hidden or when the user is not interacting with it.

### E. Reduce foreground lighting work when unchanged

The foreground still runs scene lighting updates every frame. Several lighting styles are animated, but static styles can be cached more aggressively.

Ideas:

- Skip `updateSceneLighting` when the active lighting style is static, the model has not changed, and cloud ambient factor has barely changed.
- Run animated lighting at a lower cadence when foreground effects are paused during boost/autopilot.
- Skip `materialManagerRef.current?.updateXrayAnimation(elapsed)` unless x-ray mode is active.

### F. Measure tile LOD settings directly

The tile renderer may be selecting too much detail for the current camera altitude/DPR. This needs measurement because changing LOD can cause visible pop-in.

Ideas:

- Log tile count, visible tile count, loaded tile count, and renderer draw calls in the FPS HUD during development.
- Test `3d-tiles-renderer` error target / LOD settings if available in the installed version.
- Tie LOD target to DPR: lower DPR should tolerate lower tile detail.

This visualization currently renders two independent WebGL scenes every frame:

- `src/TilesBackgroundCanvas.jsx` owns the Cesium/Google 3D Tiles background, volumetric clouds, atmosphere, lens flare, SMAA, and dithering.
- `src/MonolithCanvas.jsx` owns the aircraft, lighting, overlays, heat shimmer, and shared post-processing stack.

That architecture gives clean layering, but it is expensive because both renderers allocate full-screen buffers, both run at high DPR, and both animate every frame. The highest-impact work is to reduce pixels and passes before optimizing individual meshes.

## Highest Impact

### 1. Cap and adapt DPR in both renderers

`TilesBackgroundCanvas` calls `renderer.setPixelRatio(window.devicePixelRatio)`, and `MonolithCanvas` uses `Math.min(window.devicePixelRatio, 2)`. On Retina/HiDPI displays this can multiply fragment cost by 4x.

Status: initial implementation is in place. `TilesBackgroundCanvas` caps the background renderer at `1.25`, and `MonolithCanvas` now uses `SafeCanvas` with adaptive `dpr={[0.75, 1.5]}`.

Ideas:

- Tune the `1.25` background cap and `1.5` foreground cap after measuring visual quality and FPS.
- Use a lower cap for the background than the aircraft foreground because tiles, atmosphere, and clouds are visually forgiving.
- Add a similar FPS-driven DPR stepper to `TilesBackgroundCanvas`, or share the performance context between both scenes.

### 2. Add quality tiers for expensive full-screen effects

`TilesBackgroundCanvas` always runs this stack:

- `NormalPass`
- `CloudsEffect`
- `AerialPerspectiveEffect`
- `LensFlareEffect`
- `SMAAEffect`
- `DitheringEffect`

Every enabled pass costs full-screen work, and clouds/atmosphere are usually the dominant GPU cost.

Status: initial implementation is in place. `TilesBackgroundCanvas` samples background FPS and applies three quality tiers: high keeps all passes, medium disables lens flare, and low disables lens flare plus SMAA while lowering cloud shadow cascades/map size.

Ideas:

- Tune the FPS thresholds and sustain timing after testing on target hardware.
- Consider disabling SMAA whenever DPR is above 1, because high DPR already hides a lot of aliasing.
- Consider rendering the background to a lower-resolution render target and compositing behind the aircraft.
- Add an explicit no-clouds fallback for integrated GPUs and mobile if the low tier is still too slow.

Good initial low-risk toggle order:

1. Lens flare off.
2. SMAA off.
3. Cloud shadows lower: `cascadeCount = 1`, `mapSize = 256`.
4. Clouds off or reduced coverage/sample quality.
5. Aerial perspective off only as a last resort, because it anchors the scene visually.

### 3. Avoid updating 3D tiles resolution every frame

`TilesBackgroundCanvas` calls `tiles.setResolutionFromRenderer(camera, renderer)` during setup and resize, which is good. The older R3F tile component calls it every frame in `src/monolith/CesiumTilesBackground.jsx`.

Status: implemented for the known tile paths. `TilesBackgroundCanvas` keeps resolution updates resize-only, while `CesiumTilesBackground.jsx` and `globe-tiles.js` now resync tile resolution only when the renderer drawing-buffer size changes.

Ideas:

- Tune `3d-tiles-renderer` LOD knobs after measuring. The current scene uses Google photorealistic tiles, so tile selection can become CPU/network heavy while moving.

### 4. Stop rendering work that is visually hidden

`App.jsx` always mounts both the background and foreground scenes. The foreground canvas uses alpha and sits over the background, so both are paying per-frame render cost.

Status: initial implementation is in place. The foreground `SharedEffectStack` now has a `paused` mode, and `MonolithCanvas` pauses the foreground full-screen composer while boost/autopilot fast travel is active.

Ideas:

- If the aircraft scene is mostly transparent around the plane, keep it, but reduce its DPR more aggressively than the background.
- If a loading/error/hidden state covers a canvas, pause that renderer.

For R3F, consider `frameloop="demand"` only for static modes. The main aircraft scene animates continuously, so demand rendering is not a drop-in fix unless flight, effects, and controls are also event-driven.

## Foreground Scene

### 5. Use the existing adaptive canvas wrapper

`src/shared/webgl/SafeCanvas.tsx` already provides:

- WebGL context fallback probing.
- FPS sampling.
- Adaptive DPR stepping.
- Optional FPS HUD.

Status: implemented. `MonolithCanvas` now uses `SafeCanvas` with `dpr={[0.75, 1.5]}`, the direct `window.devicePixelRatio` override is gone, and foreground antialiasing is disabled through `rendererOptions={{ antialias: false, alpha: true }}`.

Recommended direction:

- Tune the foreground DPR range after checking visual quality on target devices.

### 6. Reuse scratch objects in the per-frame loop

`MonolithCanvas` allocates objects inside `useFrame`, including:

- `planeGeoAnchor.clone()`
- `new THREE.Vector3()`
- `new THREE.Vector3(0, 1, 0)` in cloud and terrain sections

Status: implemented for the remaining foreground paths. The per-frame aircraft anchor clone now copies into a scratch vector, and the cloud/terrain Y-axis vectors share a module-level constant. Contrails have been removed.

These allocations are not the biggest GPU cost, but they can cause garbage collection stutter.

Ideas:

- Keep checking new animation code for allocations inside `useFrame`.

### 7. Reduce per-frame material/state updates

The foreground frame loop updates several systems every tick:

- `materialManagerRef.current?.updateXrayAnimation(elapsed)`
- `lightingRigRef.current?.updateSceneLighting(...)`
- heat shimmer uniforms and mesh transforms

Ideas:

- Skip x-ray animation updates unless x-ray mode is active.
- Skip bloom ring animation unless cinematic bloom is active.
- Skip heat shimmer mesh transforms unless boost intensity is visible or approaching visible.
- Reduce lighting refresh frequency when inputs have not changed.

### 8. Lower post-processing defaults

`SharedEffectStack` already disables the composer when `qualityTier === 'low'`, but it only receives useful FPS data when mounted under `FrameRateMonitorProvider`.

Ideas:

- First wire `SafeCanvas` so this quality tier is active.
- Consider degrading before turning the whole composer off: disable chromatic aberration, barrel blur, scanlines, then bloom.
- Avoid `enableNormalPass` unless an active effect needs it. The normal pass is currently enabled for non-volumetric effects too.

## Background Scene

### 9. Remove tile normal regeneration unless it is visibly required

`TilesBackgroundCanvas` registers `TileCreasedNormalsPlugin`, which traverses every tile model and replaces each geometry with `toCreasedNormals(...)`.

That can be expensive during tile streaming because it allocates new geometry and processes tile meshes on the main thread.

Ideas:

- Temporarily disable `TileCreasedNormalsPlugin` and compare visual quality and frame pacing.
- If creased normals are needed, only apply them to specific assets or lower-detail modes.
- Profile tile load stutters separately from steady-state FPS.

### 10. Reduce cloud and atmosphere cost

The background has volumetric clouds with shadows:

```js
clouds.shadow.farScale = 0.25;
clouds.shadow.maxFar = 1e5;
clouds.shadow.cascadeCount = 2;
clouds.shadow.mapSize.set(512, 512);
```

Status: partially implemented. The automatic background quality tier keeps clouds/atmosphere visible, but the low tier reduces cloud shadow cost and drops lens flare/SMAA.

Ideas:

- Tune whether medium should lower cloud shadow settings before low tier.
- If a no-cloud fallback is added later, make it a manual user-facing toggle rather than automatic.
- Avoid updating sun direction every frame unless longitude changes enough to matter, but verify the visual result before keeping it.

### 11. Throttle autopilot-dependent updates

`TilesBackgroundCanvas` updates camera, sun, tiles, and renderer every animation frame. Some values do not need full-rate updates.

Ideas:

- Update sun direction at 5-10 Hz or only after longitude changes by a small threshold.
- Keep camera updates every frame while moving, but skip autopilot math when no controls/autopilot are active.
- If the aircraft/background are stationary, consider reducing background rendering cadence.

## UI and Map

### 12. Reduce minimap update rate

`src/Minimap.jsx` updates marker position, marker rotation, and map center every `requestAnimationFrame`.

Ideas:

- Update the minimap at 10-15 Hz instead of 60 Hz.
- Only call `map.setCenter` when the projected movement exceeds a threshold.
- Pause minimap updates while it is hidden or offscreen.

This probably will not fix GPU-bound rendering, but it can reduce main-thread pressure.

## Asset Pipeline

### 13. Optimize GLB assets offline

The models in `public/set3` are loaded as textured GLBs and some use DRACO. Runtime parsing and high-poly meshes can still be costly.

Ideas:

- Run `gltf-transform inspect public/set3/*.glb` to identify triangle counts, texture sizes, and material counts.
- Use `gltf-transform optimize` with texture resizing and mesh simplification for web variants.
- Prefer KTX2/Basis compressed textures if texture memory or upload time is high.
- Merge small materials where possible to reduce draw calls.
- Keep high-quality originals outside the runtime path and load optimized web assets by default.

### 14. Cache and prefetch strategically

`MonolithCanvas` already uses `cachedFetch` plus an in-memory parsed model cache. That helps model switching, but first load still pays network, DRACO, texture upload, and parse cost.

Ideas:

- Preload the next/previous aircraft after the default model is interactive.
- Use `requestIdleCallback` for noncritical preloads.
- Add a small loading budget so prefetching does not compete with initial tile streaming.

## Measurement Plan

1. Add a visible FPS/debug overlay for both renderers.
2. Record baseline FPS at DPR 0.75, 1, 1.25, 1.5, and 2.
3. Test with effects disabled one at a time: clouds, lens flare, SMAA, foreground composer, minimap.
4. Separate first-load stutter from steady-state FPS.
5. Use Chrome Performance and WebGL inspector data to classify CPU-bound vs GPU-bound frames.

Suggested baseline scenarios:

- Desktop, default city, no boost, idle.
- Desktop, boost active for 10 seconds.
- Desktop, autopilot/minimap click-to-fly.
- Mobile or integrated GPU, default load.
- Model switching after assets are cached.

## Recommended First Sprint

1. Cap `TilesBackgroundCanvas` DPR to `1.25`.
2. Move `MonolithCanvas` to `SafeCanvas` with `dpr={[0.75, 1.5]}`.
3. Add a simple `quality` state for `TilesBackgroundCanvas` and disable lens flare/SMAA on low FPS.
4. Throttle `Minimap` to 10-15 Hz.
5. Remove obvious per-frame allocations in `MonolithCanvas`.

Those changes are low-risk and should improve frame pacing before deeper visual tradeoffs like disabling clouds or changing the two-canvas architecture.
