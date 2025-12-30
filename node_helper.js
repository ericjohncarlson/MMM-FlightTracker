const NodeHelper = require('node_helper');
const Adsb = require('./lib/adsb');
const { parse } = require('csv-parse');
const fs = require('fs');
const path = require('path');

module.exports = NodeHelper.create({
    airlines: [],
    aircrafts: [],
    clients: [],
    isConnected: null,
    adsb: null,

    init: function() {
        this.adsb = new Adsb();
        this._loadDatabases();
    },

    _loadDatabases: function() {
        // Load CSV databases for network/SBS1 mode (tar1090 mode doesn't need these)
        const airlineParser = parse({
            delimiter: ',',
            columns: ['id', 'name', 'alias', 'iata', 'icao', 'callsign', 'country', 'active']
        });
        const aircraftsParser = parse({
            delimiter: ',',
            columns: ['icao', 'regid', 'mdl', 'type', 'operator']
        });

        const airlinesPath = path.join(__dirname, 'data', 'airlines.csv');
        const aircraftsPath = path.join(__dirname, 'data', 'aircrafts.csv');

        if (fs.existsSync(airlinesPath)) {
            fs.createReadStream(airlinesPath)
                .pipe(airlineParser)
                .on('error', err => console.error('Airlines DB error:', err))
                .on('data', row => {
                    Object.keys(row).forEach(key => {
                        if (row[key] === '\\N') row[key] = null;
                    });
                    row.id = Number.parseInt(row.id, 10);
                    row.active = row.active === 'Y';
                    this.airlines.push(row);
                })
                .on('end', () => console.log('Airlines DB loaded'));
        }

        if (fs.existsSync(aircraftsPath)) {
            fs.createReadStream(aircraftsPath)
                .pipe(aircraftsParser)
                .on('error', err => console.error('Aircrafts DB error:', err))
                .on('data', row => {
                    Object.keys(row).forEach(key => {
                        if (row[key] === '') row[key] = null;
                    });
                    this.aircrafts.push(row);
                })
                .on('end', () => console.log('Aircrafts DB loaded'));
        }
    },

    stop: function() {
        console.log('Closing down ADS-B client ...');
        this.adsb.stop();
    },

    socketNotificationReceived: function(id, payload) {
        if (id === 'START_TRACKING') {
            this.startTracking(payload);
        }
        if (id === 'GET_IS_CONNECTED') {
            this.sendSocketNotification('SET_IS_CONNECTED', this.isConnected);
        }
        if (id === 'GET_AIRCRAFTS') {
            this.trackAircrafts(payload);
        }
    },

    startTracking: function(config) {
        if (this.clients.includes(JSON.stringify(config.client))) {
            console.log('An instance of ADS-B client with the same configuration already exists. Skipping ...');
            this.isConnected = true;
            return;
        }

        console.log('Initialising ADS-B client ...');
        this.clients.push(JSON.stringify(config.client));

        if (config.hasOwnProperty('orderBy') && config.orderBy.split(':').length !== 2) {
            console.warn('The format of "orderBy" config is not valid, it will be ignored.');
        }

        try {
            this.adsb.on('socket-closed', () => {
                this.isConnected = null;
                this.sendSocketNotification('SET_IS_CONNECTED', this.isConnected);
            }).on('socket-opened', () => {
                this.isConnected = true;
                this.sendSocketNotification('SET_IS_CONNECTED', this.isConnected);
            }).start(config.client);
            this.isConnected = true;
        } catch (e) {
            console.error('Failed to initialise ADS-B client', e);
            this.clients.pop();
            this.isConnected = false;
        }
    },

    trackAircrafts: function(config) {
        let aircrafts;

        if (this.adsb.getMode() === 'tar1090') {
            // tar1090 mode - data is already enriched
            aircrafts = this._getAircraftsTar1090(config);
        } else {
            // Network/SBS1 mode - need to enrich with CSV databases
            aircrafts = this._getAircraftsNetwork(config);
        }

        // Apply sorting
        aircrafts = this._sortAircrafts(aircrafts, config);

        // Apply limit
        if (config.hasOwnProperty('limit') && config.limit > 0 && aircrafts.length > config.limit) {
            aircrafts = aircrafts.slice(0, config.limit);
        }

        this.sendSocketNotification('SET_AIRCRAFTS', aircrafts);
    },

    _getAircraftsTar1090: function(config) {
        // tar1090 provides enriched data directly
        return this.adsb.getAircrafts()
            .filter(aircraft => aircraft.callsign)
            .map(aircraft => ({
                callsign: aircraft.callsign,
                airline: aircraft.operator || this._getAirlineFromCallsign(aircraft.callsign),
                type: aircraft.type,
                description: aircraft.description,
                registration: aircraft.registration,
                altitude: aircraft.altitude,
                speed: aircraft.speed,
                heading: aircraft.heading,
                verticalRate: aircraft.verticalRate,
                lat: aircraft.lat,
                lng: aircraft.lng,
                distance: aircraft.distance, // Already in nautical miles
                direction: aircraft.direction, // Already in degrees
                route: aircraft.route,
                squawk: aircraft.squawk,
                // Flag to indicate distance is already in nautical miles
                distanceUnit: 'nm'
            }));
    },

    _getAircraftsNetwork: function(config) {
        // Network/SBS1 mode - enrich with CSV databases and calculate distance
        return this.adsb.getStore().getAircrafts()
            .filter(aircraft => aircraft.callsign)
            .map(aircraft => {
                const icao = parseInt(aircraft.icao, 10).toString(16);
                const plane = this.aircrafts.find(p => p.icao === icao);
                const enriched = {
                    ...aircraft,
                    airline: this._getAirlineForAircraft(aircraft, plane),
                    type: aircraft.type || (plane && plane.type),
                    distanceUnit: 'm' // Distance will be in meters
                };

                // Calculate distance and direction from base coordinates
                if (aircraft.lat && aircraft.lng && config.latLng && Array.isArray(config.latLng)) {
                    const R = 6371e3; // metres
                    const radLat1 = this._toRadians(config.latLng[0]);
                    const radLat2 = this._toRadians(aircraft.lat);
                    const deltaLat = this._toRadians(aircraft.lat - config.latLng[0]);
                    const deltaLng = this._toRadians(aircraft.lng - config.latLng[1]);

                    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
                        Math.cos(radLat1) * Math.cos(radLat2) *
                        Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

                    enriched.distance = R * c; // In meters

                    const y = Math.sin(deltaLng) * Math.cos(radLat2);
                    const x = Math.cos(radLat1) * Math.sin(radLat2) -
                        Math.sin(radLat1) * Math.cos(radLat2) * Math.cos(deltaLng);
                    const bearing = this._toDegrees(Math.atan2(y, x));
                    enriched.direction = (bearing + 360) % 360;
                }

                return enriched;
            });
    },

    _getAirlineFromCallsign: function(callsign) {
        if (!callsign) return 'Unknown';
        if (!/\d/.test(callsign)) return 'Private';

        const airline = this.airlines.find(a => a.icao === callsign.substr(0, 3));
        if (airline) {
            return airline.alias || airline.name;
        }
        return 'Unknown';
    },

    _getAirlineForAircraft: function(aircraft, plane) {
        if (!/\d/.test(aircraft.callsign)) return 'Private';
        if (plane && plane.operator) return plane.operator;

        const airline = this.airlines.find(a => a.icao === aircraft.callsign.substr(0, 3));
        if (airline) {
            let name = airline.alias || airline.name;
            if (!airline.active) name += '*';
            return name;
        }
        return 'Unknown';
    },

    _sortAircrafts: function(aircrafts, config) {
        const orderBy = config.orderBy ? config.orderBy.split(':') : [];

        if (orderBy.length !== 2) return aircrafts;

        const property = orderBy[0] === 'age' ? 'count' : orderBy[0];
        const multiplier = orderBy[1] === 'asc' ? 1 : -1;

        return aircrafts
            .filter(aircraft => aircraft.hasOwnProperty(property))
            .sort((a, b) => {
                const valueA = a[property];
                const valueB = b[property];
                if (typeof valueA === 'string' && typeof valueB === 'string') {
                    return valueA.toLowerCase() < valueB.toLowerCase()
                        ? -1 * multiplier
                        : valueA.toLowerCase() > valueB.toLowerCase() ? multiplier : 0;
                }
                if (typeof valueA === 'number' && typeof valueB === 'number') {
                    return (valueA - valueB) * multiplier;
                }
                return 0;
            });
    },

    _toRadians: function(n) {
        return n * Math.PI / 180;
    },

    _toDegrees: function(n) {
        return n * 180 / Math.PI;
    }
});
