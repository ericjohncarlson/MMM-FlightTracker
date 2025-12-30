'use strict';

const net = require('net');
const EventEmitter = require('events');
const AircraftStore = require('mode-s-aircraft-store');

class Adsb extends EventEmitter {

    constructor() {
        super();
        this.store = new AircraftStore({
            timeout: 30000
        });
        this.instance = null;
    }

    start(argv) {
        if (this.instance) {
            throw new Error('Cannot start ADS-B client more than once');
        }

        this._initSocket(argv);
    }

    stop() {
        if (this.instance) {
            this.instance.destroy();
            this.instance = null;
        }
    }

    getStore() {
        return this.store;
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
