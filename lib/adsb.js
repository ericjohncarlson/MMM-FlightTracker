'use strict';

const net = require('net');
const http = require('http');
const https = require('https');
const EventEmitter = require('events');
const AircraftStore = require('mode-s-aircraft-store');

const ADSB_LOL_ROUTESET_URL = 'https://api.adsb.lol/api/0/routeset';

class Adsb extends EventEmitter {

    constructor() {
        super();
        this.store = new AircraftStore({
            timeout: 30000
        });
        this.instance = null;
        this.pollInterval = null;
        this.mode = null;
        this.routeCache = new Map(); // Cache routes by callsign
    }

    start(argv) {
        if (this.instance || this.pollInterval) {
            throw new Error('Cannot start ADS-B client more than once');
        }

        this.mode = argv.mode || 'network';

        switch (this.mode) {
            case 'tar1090':
                this._initTar1090(argv);
                break;
            case 'network':
            default:
                this._initSocket(argv);
                break;
        }
    }

    stop() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        if (this.instance) {
            this.instance.destroy();
            this.instance = null;
        }
    }

    getStore() {
        return this.store;
    }

    getMode() {
        return this.mode;
    }

    // For tar1090 mode - returns aircraft directly (not from store)
    getAircrafts() {
        return this.aircrafts || [];
    }

    _initTar1090(argv) {
        if (!argv.host) {
            throw new Error('The host (IP or hostname) is required. Please specify one.');
        }

        const port = argv.port || 8080;
        const path = argv.path || '/data/aircraft.json';
        const interval = (argv.interval || 1) * 1000;
        const enableRoutes = argv.enableRoutes !== false; // Default true

        this.aircrafts = [];

        const fetchData = () => {
            const url = `http://${argv.host}:${port}${path}`;

            http.get(url, (res) => {
                let data = '';

                res.on('data', chunk => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        this._processTar1090Data(json, enableRoutes);
                        this.emit('socket-opened');
                    } catch (e) {
                        console.error('Failed to parse tar1090 data:', e.message);
                    }
                });
            }).on('error', (e) => {
                console.error(`Failed to fetch tar1090 data: ${e.message}`);
                this.emit('socket-closed');
            });
        };

        // Initial fetch
        fetchData();

        // Set up polling
        this.pollInterval = setInterval(fetchData, interval);

        console.log(`tar1090 client started, polling http://${argv.host}:${port}${path} every ${interval}ms`);
    }

    _processTar1090Data(json, enableRoutes) {
        if (!json.aircraft || !Array.isArray(json.aircraft)) {
            return;
        }

        // Filter to aircraft with valid data
        const validAircraft = json.aircraft.filter(ac =>
            ac.flight || ac.r // Has callsign or registration
        );

        // Map tar1090 fields to our format
        this.aircrafts = validAircraft.map(ac => ({
            icao: ac.hex,
            callsign: (ac.flight || ac.r || '').trim(),
            registration: ac.r,
            type: ac.t,
            description: ac.desc,
            operator: ac.ownOp,
            year: ac.year,
            altitude: ac.alt_baro || ac.alt_geom,
            speed: ac.gs, // Already in knots
            heading: ac.track,
            verticalRate: ac.baro_rate || ac.geom_rate,
            lat: ac.lat,
            lng: ac.lon,
            distance: ac.r_dst, // Already in nautical miles from tar1090
            direction: ac.r_dir, // Already calculated by tar1090
            squawk: ac.squawk,
            category: ac.category,
            rssi: ac.rssi,
            seen: ac.seen,
            route: this.routeCache.get((ac.flight || '').trim()) || null
        }));

        // Fetch routes for aircraft that don't have cached routes
        if (enableRoutes) {
            this._fetchRoutes(validAircraft);
        }

        this.emit('data', this.aircrafts);
    }

    _fetchRoutes(aircraftList) {
        // Filter to aircraft with callsigns that look like flight numbers and have positions
        const needRoutes = aircraftList.filter(ac => {
            const callsign = (ac.flight || '').trim();
            // Has callsign, has position, not already cached, looks like a flight number (has digits)
            return callsign &&
                   ac.lat &&
                   ac.lon &&
                   !this.routeCache.has(callsign) &&
                   /\d/.test(callsign);
        });

        if (needRoutes.length === 0) {
            return;
        }

        const planes = needRoutes.map(ac => ({
            callsign: (ac.flight || '').trim(),
            lat: ac.lat,
            lng: ac.lon
        }));

        const postData = JSON.stringify({ planes });

        const options = {
            hostname: 'api.adsb.lol',
            port: 443,
            path: '/api/0/routeset',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', chunk => {
                data += chunk;
            });

            res.on('end', () => {
                // Skip if empty response or error status
                if (res.statusCode !== 200 || !data || data.length === 0) {
                    return;
                }
                try {
                    const routes = JSON.parse(data);
                    this._processRoutes(routes);
                } catch (e) {
                    // Route lookup failed, not critical - only log if there was actual data
                    if (data.length > 0) {
                        console.debug('Route lookup parse error:', e.message, 'Data:', data.substring(0, 100));
                    }
                }
            });
        });

        req.on('error', (e) => {
            // Route lookup failed, not critical - silently ignore
        });

        req.setTimeout(5000, () => {
            req.destroy();
        });

        req.write(postData);
        req.end();
    }

    _processRoutes(routes) {
        // The API returns an array of route objects
        if (!Array.isArray(routes)) {
            return;
        }

        for (const routeData of routes) {
            if (routeData && routeData.callsign && routeData._airport_codes_iata) {
                const callsign = routeData.callsign;
                const route = routeData._airport_codes_iata; // e.g., "DFW-PHL"

                this.routeCache.set(callsign, route);

                // Update existing aircraft with route
                const aircraft = this.aircrafts.find(ac => ac.callsign === callsign);
                if (aircraft) {
                    aircraft.route = route;
                }
            }
        }
    }

    _initSocket(argv, attempts = 0) {
        if (!argv.host) {
            throw new Error('The host (IP or hostname) is required. Please specify one.');
        }
        if (!argv.port) {
            throw new Error('The port is required. Please specify one.');
        }

        this.instance = new net.Socket()
            .on('data', data => {
                data.toString().split("\n").forEach(line => {
                    const csv = line.trim().split(',');

                    if (['ID', 'AIR', 'MSG'].includes(csv[0])) {
                        this.store.addMessage(csv);
                    }
                });
            }).on('close', () => {
                this.emit('socket-closed');
                const timeout = Math.min(Math.pow(attempts, 2), 30);
                console.warn(`Stream to ${argv.host}:${argv.port} has been closed due to an error. Retrying to open it again in ${timeout} seconds ...`);
                attempts++;
                setTimeout(() => {
                    this._initSocket(argv, attempts);
                }, timeout * 1000);
            }).on('error', error => {
                console.error(`Failed to open stream to ${argv.host}:${argv.port}: ${error.message}`);
            }).connect(argv.port, argv.host, () => {
                console.log(`Successfully opened stream to ${argv.host}:${argv.port}. Waiting for data...`);
                this.emit('socket-opened');
            });
    }

}

module.exports = Adsb;
