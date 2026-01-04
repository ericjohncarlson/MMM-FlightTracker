Module.register('MMM-FlightTracker', {
    // Default module config.
    defaults: {
        interval: 1,
        animationSpeed: 1000,
        passingByThreshold: -1,
        latLng: [],
        minAltitude: -1,
        maxAltitude: -1,
        minDistance: -1,
        maxDistance: -1,
        altitudeUnits: config.units,
        speedUnits: config.units,
        showAirline: true,
        showType: true,
        showSpeed: true,
        showAltitude: true,
        showHeading: true,
        showRoute: true
    },

    aircrafts: [],
    isConnected: null,

    start: function() {
        this.sendSocketNotification('START_TRACKING', this.config);
        this.trackPlanes();
        setInterval(() => {
            this.trackPlanes();
        }, this.config.interval * 1000);
    },

    getStyles: function () {
        return [
            'MMM-FlightTracker.css'
        ];
    },

    socketNotificationReceived: function (id, payload) {
        if (id === 'SET_IS_CONNECTED') {
            this.isConnected = payload;
            this.updateDom(this.config.animationSpeed);
        }
        if (id === 'SET_AIRCRAFTS') {
            const animate = this.aircrafts.length !== payload.length;
            const isUpdated = JSON.stringify(this.aircrafts) !== JSON.stringify(payload);
            if (isUpdated) {
                this.aircrafts = payload;
                this.updateDom(animate ? this.config.animationSpeed : undefined);
            }
        }
    },

    trackPlanes: function() {
        if (this.isConnected === null) {
            Log.log('Node helper not connected yet to the ADS-B client. Waiting...');
            this.sendSocketNotification('GET_IS_CONNECTED');
        } else {
            this.sendSocketNotification('GET_AIRCRAFTS', this.config);
        }
    },

    getDom: function() {
        const wrapper = document.createElement('div');
        wrapper.className = 'flight-tracker';

        if (this.isConnected === null) {
            wrapper.className = 'light small dimmed';
            wrapper.innerHTML = this.translate('Connecting tracker');
            return wrapper;
        }
        if (this.isConnected === false) {
            wrapper.className = 'light small dimmed';
            wrapper.innerHTML = this.translate('Failed to start. Please check the logs');
            return wrapper;
        }
        if (this.aircrafts.length === 0) {
            wrapper.className = 'light small dimmed';
            wrapper.innerHTML = this.translate('No planes nearby');
            return wrapper;
        }

        if (this.config.passingByThreshold > 0) {
            const windowPlanes = this.aircrafts.filter(aircraft => aircraft.altitude * (aircraft.unit === 0 && this.config.altitudeUnits === 'metric' ? 0.3040 : 1) <= this.config.passingByThreshold);
            if (windowPlanes.length > 0) {
                wrapper.appendChild(this.getSection(windowPlanes, true));
            }
            const passingByPlanes = this.aircrafts.filter(aircraft => aircraft.altitude * (aircraft.unit === 0 && this.config.altitudeUnits === 'metric' ? 0.3040 : 1) > this.config.passingByThreshold);
            if (passingByPlanes.length > 0) {
                wrapper.appendChild(this.getSection(passingByPlanes, false));
            }
        } else {
            wrapper.appendChild(this.getSection(this.aircrafts, false));
        }

        return wrapper;
    },

    getSection(aircrafts, showDistance) {
        const section = document.createElement('div');

        section.append(...aircrafts.map(aircraft => {
            const row = document.createElement('div');
            row.className = 'aircraft';

            const altitude = aircraft.altitude
                ? Math.floor(aircraft.altitude * (aircraft.unit === 0 && this.config.altitudeUnits === 'metric' ? 0.3040 : 1))
                : null;

            // Line 1: Callsign / Airline · Type (Route)
            const aircraftHeading = document.createElement('div');
            aircraftHeading.className = 'aircraft-heading medium';
            aircraftHeading.innerHTML = `<span class="bright">${aircraft.callsign}</span>`;
            if (this.config.showAirline && aircraft.airline) {
                const airlineDisplay = aircraft.airline.substring(0, 25);
                aircraftHeading.innerHTML += `<span class="dimmed airline"> / ${airlineDisplay}</span>`;
            }
            // Show short type code (e.g., A320, B738)
            if (this.config.showType && aircraft.type) {
                aircraftHeading.innerHTML += `<span class="dimmed type"> · ${aircraft.type}</span>`;
            }
            // Show route if available (e.g., "BWI-PIT")
            if (this.config.showRoute && aircraft.route) {
                aircraftHeading.innerHTML += `<span class="dimmed route"> (${aircraft.route})</span>`;
            }
            row.appendChild(aircraftHeading);

            // Line 2: Speed, Altitude, Direction, Distance
            const metadata = [];
            if (this.config.showSpeed && aircraft.speed) {
                let speed;
                let speedUnits;
                switch (this.config.speedUnits) {
                    case 'metric':
                        speed = aircraft.speed * 1.8520008892119;
                        speedUnits = 'km/h';
                        break;
                    case 'imperial':
                        speed = aircraft.speed * 1.15078;
                        speedUnits = 'mph';
                        break;
                    case 'knots':
                    default:
                        speed = aircraft.speed;
                        speedUnits = this.translate('knots');
                }
                metadata.push(`<span>${Math.floor(speed)} ${speedUnits}</span>`);
            }
            if (this.config.showAltitude && aircraft.altitude) {
                let altitudeIcon;
                if (aircraft.verticalRate < 0) {
                    altitudeIcon = '↓';
                } else if (aircraft.verticalRate > 0) {
                    altitudeIcon = '↑';
                } else {
                    altitudeIcon = '→';
                }
                metadata.push(`<span>${altitudeIcon} ${altitude} ${this.config.altitudeUnits === 'metric' ? 'm' : 'ft'}</span>`);
            }
            if (this.config.showHeading && aircraft.heading) {
                metadata.push(`<span>${this.cardinalDirection(aircraft.heading)}</span>`);
            }
            if (showDistance && aircraft.distance) {
                let distance;
                let distanceUnits;
                // Check if distance is already in nautical miles (tar1090) or meters (network mode)
                if (aircraft.distanceUnit === 'nm') {
                    // Already in nautical miles from tar1090
                    if (this.config.altitudeUnits === 'metric') {
                        distance = aircraft.distance * 1.852; // nm to km
                        distanceUnits = 'km';
                    } else {
                        distance = aircraft.distance;
                        distanceUnits = 'nm';
                    }
                } else {
                    // In meters from network mode
                    if (this.config.altitudeUnits === 'metric') {
                        distance = aircraft.distance / 1000;  // meters to km
                        distanceUnits = 'km';
                    } else {
                        distance = aircraft.distance / 1852;  // meters to nautical miles
                        distanceUnits = 'nm';
                    }
                }
                metadata.push(`<span>${distance.toFixed(1)} ${distanceUnits}</span>`);
            }
            if (metadata.length > 0) {
                const aircraftMetadata = document.createElement('div');
                aircraftMetadata.className = 'aircraft-metadata small dimmed';
                aircraftMetadata.innerHTML = metadata.join('');
                row.appendChild(aircraftMetadata);
            }

            return row;
        }));

        return section;
    },

    cardinalDirection(direction) {
        if (direction> 11.25 && direction<= 33.75){
            return this.translate('NNE');
        } else if (direction> 33.75 && direction<= 56.25) {
            return this.translate('NE');
        } else if (direction> 56.25 && direction<= 78.75) {
            return this.translate('ENE');
        } else if (direction> 78.75 && direction<= 101.25) {
            return this.translate('E');
        } else if (direction> 101.25 && direction<= 123.75) {
            return this.translate('ESE');
        } else if (direction> 123.75 && direction<= 146.25) {
            return this.translate('SE');
        } else if (direction> 146.25 && direction<= 168.75) {
            return this.translate('SSE');
        } else if (direction> 168.75 && direction<= 191.25) {
            return this.translate('S');
        } else if (direction> 191.25 && direction<= 213.75) {
            return this.translate('SSW');
        } else if (direction> 213.75 && direction<= 236.25) {
            return this.translate('SW');
        } else if (direction> 236.25 && direction<= 258.75) {
            return this.translate('WSW');
        } else if (direction> 258.75 && direction<= 281.25) {
            return this.translate('W');
        } else if (direction> 281.25 && direction<= 303.75) {
            return this.translate('WNW');
        } else if (direction> 303.75 && direction<= 326.25) {
            return this.translate('NW');
        } else if (direction> 326.25 && direction<= 348.75) {
            return this.translate('NNW');
        } else {
            return this.translate('N');
        }
    }

});
