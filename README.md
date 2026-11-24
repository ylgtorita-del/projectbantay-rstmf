# Bantay LiDAR

A desktop app (React + Electron) that draws a live 2D map of the surroundings from a **YDLIDAR T-mini Plus**. It also has proximity alerts and recording/replay, and builds a Windows installer.

## Requirements (development machine only)
- Node.js 20 LTS or newer: `winget install OpenJS.NodeJS.LTS`, then reopen the terminal
- The lidar's USB driver (CP210x) installed, so the lidar shows up as a COM port

People who install the app with the `.exe` don't need Node or Python.

## Commands
```powershell
npm install        # installs dependencies and rebuilds serialport for Electron
npm run dev        # runs the app with hot reload
npm run dist       # builds dist\Bantay LiDAR Setup 1.0.0.exe
```

## Using it
1. Plug in the lidar and pick its COM port. The app selects COM4, or the first USB-serial port, automatically.
2. Leave the baud rate at **230400** and click **Connect**. The motor starts spinning and points appear.
3. **Distance decode:** the YDLidar SDK decodes the distance as `raw >> 2`, but `YDLIDAR-TEST.py` prints the raw value, which is 4× larger. Hold an object at a measured distance (for example 1 m). If the map is 4× too small or too large, disconnect, switch this setting and reconnect.
4. **Proximity alert:** set a distance threshold and, optionally, a direction sector (0° is the front of the lidar, angles increase clockwise). Points inside the zone turn red, the sector flashes, and a beep can play.
5. **Record:** saves each revolution to a `.jsonl` file. **Export CSV** converts the last or a chosen recording into `timestamp_ms,revolution,angle_deg,distance_mm,intensity`. **Open recording…** replays a file with play, pause, scrub and speed controls.

6. **Detection:** walls are drawn as blue lines labelled with their distance. Objects get an orange box with an ID number and distance, and turn pink when they are moving. The Detection panel lists objects from nearest to farthest; click one to highlight it. If results are noisy or objects merge together, open **Tuning** to adjust the settings.

### Range
The T-mini Plus datasheet gives **0.05–12 m** for bright surfaces. Dark, glossy or glass surfaces give shorter range, or no reading at all. Beams spread out with distance (about 0.9° apart at 10 Hz, so roughly 16 cm between points at 10 m), so the farther away an object is, the bigger it has to be to get enough points to count as an object. With the default of 4 points, that means at least about 0.5 m wide at 10 m and about 6 cm wide at 1 m. The lidar sees only the side of an object facing it, so each box shows that visible part.

Disconnecting or closing the app sends the stop-scan command (`A5 65`), so the motor stops.

## Code map
- `src/main/lidar/parser.ts`: the packet parser (a port of `YDLIDAR-TEST.py` that also checks checksums, interpolates every sample and groups samples into full revolutions)
- `src/main/lidar/serial.ts`: opens the serial port and sends start/stop scan commands
- `src/main/recorder.ts`: JSONL recording, replay loading and CSV export
- `src/renderer/src/components/RadarCanvas.tsx`: the radar view (canvas; zoom with the mouse wheel, pan by dragging, double-click to reset)
- `electron-builder.yml`: the NSIS installer settings
# projectbantay-rstmf
