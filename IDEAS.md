# Ideas

This project already has a strong base: a cinematic aircraft scene, real city search, terrain-backed geospatial positioning, a live minimap, clouds, contrails, heat shimmer, and model switching. These ideas build on that rather than replacing it.

## High-Impact Interaction

### Flight Plans

Let the user search multiple cities and build a route: Tokyo -> Seoul -> Shanghai -> Hong Kong. The minimap can draw the route as a polyline while the aircraft gently turns toward the next waypoint.

Implementation notes:
- Store an array of waypoints beside `flightState`.
- Add a lightweight route layer to `Minimap.jsx`.
- In `MonolithCanvas.jsx`, steer `worldYaw` toward the bearing to the next waypoint instead of instantly teleporting.

### Fly-To Animation

City search currently teleports. Make it feel like a cinematic jump: clouds streak, FOV widens, the minimap marker glides, then the aircraft emerges over the destination.

Implementation notes:
- Replace one-shot teleport with a timed transition command in `flight-store.js`.
- Interpolate cartographic coordinates using great-circle-ish lerp for short hops.
- Add a brief boost visual while the transition is active.

### Mission Cards

After selecting a city, show a small "mission card" with the city name, local time, distance from the last city, and a simple objective like "cross the bay", "climb through cloud layer", or "follow the coast".

Implementation notes:
- Extend `CitySearch.jsx` selection payload with display name and maybe address parts from Nominatim.
- Track previous selected city in shared state.
- Keep the card compact and transient so it does not compete with the scene.

### Click-To-Fly From Minimap

Allow clicking anywhere on the minimap to set a destination. Search is great for named places; click-to-fly makes exploration feel playful.

Implementation notes:
- Listen for MapLibre `click` events in `Minimap.jsx`.
- Convert `event.lngLat` to a flight command.
- Use the same transition path as city search so both inputs feel consistent.

## Visual Polish

### Altitude-Aware Atmosphere

Make the sky, haze, and cloud density react to altitude. Low altitude gets more terrain haze and shadowed clouds; high altitude gets deeper blue, clearer horizon, and thinner clouds.

Implementation notes:
- Use `flightState.alt` to drive `AerialPerspectiveEffect`, cloud coverage, and exposure.
- Add a smoothed altitude visual state so changes do not flicker.

### Weather Presets

Add a few named atmosphere modes: `Clear Dawn`, `Storm Wall`, `Golden Hour`, `Night Recon`, `Volcanic Ash`. These should be visual presets, not menu clutter.

Implementation notes:
- Centralize preset values for cloud coverage, sun direction, exposure, tint, and post-processing.
- Let keyboard shortcuts or a small UI cycle through them.
- Keep the default bright and readable.

### Sonic Boom Moment

When the SR-71 boost begins, spawn a brief vapor cone and circular shock ripple around the plane. It should be fast, bright, and gone before it becomes noisy.

Implementation notes:
- Add a transparent cone or ring mesh near the aircraft in `MonolithCanvas.jsx`.
- Drive opacity and scale from boost intensity.
- Use a shader with fresnel falloff so it reads as vapor, not a solid object.

### Aircraft Shadow And Ground Contact

When the plane is closer to terrain, project a soft moving shadow or contact blob onto the scene. It helps sell altitude and speed.

Implementation notes:
- Use a simple transparent plane under the aircraft when below a threshold.
- Fade it out with altitude.
- Stretch it subtly with heading and speed.

### City Reveal Label

After a city selection, briefly render a tasteful label near the horizon: `TOKYO`, `REYKJAVIK`, `RIO DE JANEIRO`. It gives the jump a sense of arrival.

Implementation notes:
- Reuse the existing UI overlay pattern in `monolith/ui.js`.
- Use uppercase city text and a short fade in/out.
- Avoid permanent labels over the main view.

## Minimap And Navigation

### Follow / Free Mode Toggle

Dragging the minimap currently pauses auto-centering temporarily. Make it explicit: a small `Follow` button that re-centers the aircraft after the user pans away.

Implementation notes:
- Track `isFollowing` in `Minimap.jsx`.
- Turn it off when the user drags or zooms.
- Turn it on when the user clicks `Follow`.

### Heading And Range Rings

Add subtle rings around the marker and a forward heading line. This makes the minimap feel like flight instrumentation instead of a generic map.

Implementation notes:
- Add a GeoJSON source/layer for a short heading line.
- Add one or two pixel-space rings around the marker element.
- Keep colors restrained so OpenStreetMap remains readable.

### Satellite Tile Mode

Offer a map style toggle between OpenStreetMap and satellite imagery. The terrain scene is photorealistic, so satellite view would make the minimap feel more connected to the main view.

Implementation notes:
- Add a style switcher in `Minimap.jsx`.
- Use a provider with acceptable public terms and quota, or keep it behind an env var.
- Preserve marker and route layers across style swaps.

## Aircraft And Controls

### Camera Modes

Add chase, cockpit, orbit, and cinematic camera modes. The current chase feel is good; alternate modes would make the same scene feel much larger.

Implementation notes:
- Store camera mode in Monolith scene state.
- Keep controls disabled for cinematic/cockpit modes.
- Smoothly blend camera offsets instead of snapping.

### Model Hangar Overlay

Replace hidden model hotkeys with a compact hangar overlay showing aircraft thumbnails, names, and one-line traits. The existing key controls can stay as shortcuts.

Implementation notes:
- Use `MODEL_SET_DEF.models` as the data source.
- Add a non-card, bottom or side dock UI so it does not obscure the aircraft.
- Preload the next likely model with the existing model cache helper.

### Plane-Specific Flight Feel

Give each aircraft different motion personality: SR-71 fast and stable, Osprey slower with heavy turns, helicopter with hovering drift, F-35 with sharper pitch and bank.

Implementation notes:
- Extend model definitions with `turnRate`, `bankAmount`, `boostSpeedMps`, and `elevationResponsiveness`.
- Feed those values into the existing flight-control interpolation.

### Gentle Autopilot

Add a toggle that keeps the plane flying smoothly when the user is not pressing keys. It could slowly bank, drift through clouds, and orbit a selected city.

Implementation notes:
- Add an `autopilotEnabled` ref/state.
- Let user input temporarily override it.
- Use low-frequency sine/noise so motion feels alive but not random.

## Sound And Mood

### Engine Audio

Add a soft looping engine bed with pitch and volume tied to boost and model type. It does not need to be loud; even quiet motion audio can make the whole thing feel more physical.

Implementation notes:
- Use Web Audio with a user-initiated start button to satisfy browser autoplay rules.
- Crossfade loop layers for idle, cruise, and boost.
- Add a mute button and remember the setting in localStorage.

### Radio Chatter

Add optional, sparse radio-style text/audio snippets after city changes: "Tokyo tower, Blackbird departing east." Keep it rare and atmospheric.

Implementation notes:
- Generate from city labels and heading.
- Show as a transient text line, with audio as a later enhancement.
- Avoid constant chatter.

### Screenshot Mode

Add a single key or button that hides UI, centers the aircraft, and captures a high-resolution screenshot. This project is visual enough that sharing images should be first-class.

Implementation notes:
- Temporarily hide `CitySearch` and `Minimap`.
- Use `gl.domElement.toDataURL()` for the aircraft canvas, or composite multiple layers if needed.
- Restore UI immediately after capture.

## Technical Quality

### Deployment Clarity

Keep `DEPLOY.md` as the short runbook and `CLOUDFLARE.md` as the deeper notes. If GitHub Actions gets added later, document exactly which branch deploys production.

### Visual Regression Screenshots

Use Playwright to capture desktop and mobile screenshots after major visual changes. This app has multiple canvases and lazy-loaded chunks, so screenshots catch issues that a build cannot.

Implementation notes:
- Start Vite with `npm run dev -- --host 127.0.0.1`.
- Wait for canvas pixels to become non-blank.
- Capture at least desktop and mobile viewports.

### Shared Flight State Cleanup

The project now has several scene layers reading and writing shared flight data. A small event/store abstraction could make future route, autopilot, and minimap features safer.

Implementation notes:
- Keep the current lightweight module shape.
- Add explicit commands for teleport, route, follow mode, and selected city.
- Avoid a heavy state library unless the command surface grows much larger.
