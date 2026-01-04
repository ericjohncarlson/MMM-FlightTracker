# MagicMirror² Module: Flight Tracker

`MMM-FlightTracker` is a module for [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror) that displays real-time information about nearby aircraft using ADS-B data.

This fork has been modernized with:
- **tar1090 integration** for richer aircraft data (recommended)
- **Flight route lookup** via [adsb.im](https://adsb.im) API (same source as tar1090)
- **Streamlined dependencies** (removed RTL-SDR support, network-only mode)
- **Zero CVE vulnerabilities**

## Features

- Display aircraft callsign, airline, type, altitude, speed, heading
- Show flight routes (origin-destination) when available
- Support for tar1090/readsb JSON API or legacy SBS1 TCP stream
- Distance and bearing from your location
- Configurable units (metric/imperial/knots)
- Sort by distance, altitude, speed, or age

## Installation

Clone this module into your MagicMirror's `modules` directory:

```sh
cd ~/MagicMirror/modules
git clone https://github.com/ericjohncarlson/MMM-FlightTracker
cd MMM-FlightTracker
npm install
```

## Configuration

Add the module to your `config/config.js`:

### tar1090 Mode (Recommended)

Use this mode if you have [tar1090](https://github.com/wiedehopf/tar1090), [readsb](https://github.com/wiedehopf/readsb), or [adsb-ultrafeeder](https://github.com/sdr-enthusiasts/docker-adsb-ultrafeeder) running. This provides the richest data including full aircraft descriptions and pre-calculated distances.

```javascript
{
    module: 'MMM-FlightTracker',
    header: 'Nearby Aircraft',
    position: 'top_right',
    config: {
        client: {
            mode: 'tar1090',
            host: '192.168.1.100',  // Your tar1090/readsb host
            port: 8080,             // Web interface port
            enableRoutes: true      // Lookup flight routes via adsb.im
        },
        interval: 5,
        altitudeUnits: 'imperial',
        speedUnits: 'knots',
        orderBy: 'distance:asc',
        limit: 8,
        showAirline: true,
        showType: true,
        showSpeed: true,
        showAltitude: true,
        showHeading: true,
        showRoute: true
    }
}
```

### Network/SBS1 Mode (Legacy)

Use this mode to connect to a dump1090 SBS1 stream on port 30003:

```javascript
{
    module: 'MMM-FlightTracker',
    header: 'Nearby Aircraft',
    position: 'top_right',
    config: {
        client: {
            mode: 'network',
            host: '192.168.1.100',
            port: 30003
        },
        latLng: [40.4406, -79.9959],  // Required for distance calculation
        interval: 5,
        altitudeUnits: 'imperial',
        speedUnits: 'knots',
        orderBy: 'distance:asc',
        limit: 8
    }
}
```

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `interval` | Polling interval in seconds | `1` |
| `animationSpeed` | Animation speed in milliseconds | `1000` |
| `passingByThreshold` | Altitude threshold (ft) to separate "nearby" vs "passing" planes. Set to `-1` to disable. | `-1` |
| `minAltitude` | Only show aircraft at or above this altitude (ft). Set to `-1` to disable. | `-1` |
| `maxAltitude` | Only show aircraft at or below this altitude (ft). Set to `-1` to disable. | `-1` |
| `minDistance` | Only show aircraft at or beyond this distance (nm). Set to `-1` to disable. | `-1` |
| `maxDistance` | Only show aircraft within this distance (nm). Set to `-1` to disable. | `-1` |
| `latLng` | Your coordinates `[lat, lng]` for distance calculation. Required for network mode. Optional for tar1090 mode as fallback when receiver doesn't provide distance (e.g., dump1090-fa). | `[]` |
| `orderBy` | Sort order: `distance:asc`, `altitude:desc`, `speed:asc`, `age:asc`, etc. | `undefined` |
| `limit` | Maximum number of aircraft to display | `-1` (all) |
| `altitudeUnits` | `metric` (meters) or `imperial` (feet) | Global config |
| `speedUnits` | `metric` (km/h), `imperial` (mph), or `knots` | Global config |
| `showAirline` | Show airline/operator name | `true` |
| `showType` | Show aircraft type code (e.g., B738, A320) | `true` |
| `showSpeed` | Show ground speed | `true` |
| `showAltitude` | Show altitude with climb/descent indicator | `true` |
| `showHeading` | Show cardinal direction (N, NE, E, etc.) | `true` |
| `showRoute` | Show flight route if available (e.g., DFW-PHL) | `true` |

### Client Options

| Option | Description | Default |
|--------|-------------|---------|
| `mode` | `tar1090` or `network` | `network` |
| `host` | Hostname or IP of your ADS-B receiver | Required |
| `port` | Port number (8080 for tar1090, 30003 for SBS1) | Required |
| `enableRoutes` | Enable route lookup via adsb.im API (tar1090 mode only) | `true` |

## Display Format

```
SWA1098 / SOUTHWEST AIRLINES CO · B38M (DFW-PHL)
500 knots  ↑ 31000 ft  NE  60.4 nm
```

- **Line 1:** Callsign / Airline (max 25 chars) · Aircraft Type (Route)
- **Line 2:** Speed, Altitude (↑ climbing, ↓ descending, → level), Heading, Distance

## Data Sources

### tar1090 Mode
- Aircraft data: Local tar1090 JSON API (`/data/aircraft.json`)
- Includes: registration, aircraft type, operator, pre-calculated distance
- Route data: [adsb.im API](https://adsb.im) (same source as tar1090 web UI)
  - Routes cached for 15 minutes per callsign
  - Low-confidence routes are filtered out

### Network Mode
- Aircraft data: SBS1 BaseStation format over TCP
- Enriched with local CSV databases (airlines, aircraft types)
- Distance calculated using Haversine formula

## Credits

- Original module by [Thomas Bouron](https://github.com/tbouron/MMM-FlightTracker)
- Modernized fork by [Eric Carlson](https://github.com/ericjohncarlson/MMM-FlightTracker)
- Route data from [adsb.im](https://adsb.im) and [VRS standing-data](https://github.com/vradarserver/standing-data)

## License

Apache-2.0
