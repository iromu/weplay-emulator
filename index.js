'use strict';

const fs = require('fs');
const Emulator = require('./emulator');
const join = require('path').join;
const md5 = require('crypto').createHash('md5');
const msgpack = require('msgpack');
const debug = require('debug')('weplay:worker');

if (!process.env.WEPLAY_ROM) {
    console.error('You must specify the ENV variable `WEPLAY_ROM` '
        + 'pointint to location of rom file to broadcast.');
    process.exit(1);
}

process.title = 'weplay-emulator';

// redis
const redis = require('./redis')();
const sub = require('./redis')();
const io = require('socket.io-emitter')(redis);

// rom
let file = process.env.WEPLAY_ROM;
if ('/' != file[0]) file = join(process.cwd(), file);
console.log('rom %s', file);
const rom = fs.readFileSync(file);
const hash = md5.update(file).digest('hex');
console.log('rom hash %s', hash);

// save interval
const saveInterval = process.env.WEPLAY_SAVE_INTERVAL || 60000;
console.log('save interval %d', saveInterval);

// load emulator
let emu;

function load() {
    console.log('loading emulator');
    emu = new Emulator();

    emu.on('error', () => {
        console.log(`${new Date} - restarting emulator`);
        emu.destroy();
        setTimeout(load, 1000);
    });

    emu.on('frame', frame => {
        redis.publish('weplay:frame:raw', frame);
    });

    redis.get(`weplay:state:${hash}`, (err, state) => {
        if (err) throw err;
        if (state) {
            console.log('init from state');
            emu.initWithState(msgpack.unpack(state));
        } else {
            console.log('init from rom');
            emu.initWithRom(rom);
        }
        emu.run();
        save();
    });

    function save() {
        console.log('will save in %d', saveInterval);
        setTimeout(() => {
            const snap = emu.snapshot();
            if (snap) {
                console.log('saving state');
                redis.set(`weplay:state:${hash}`, msgpack.pack(snap));
                redis.expire(`weplay:state:${hash}`, saveInterval);
                save();
            }
        }, saveInterval);
    }
}

sub.subscribe('weplay:move');
sub.on('message', (channel, move) => {
    if ('weplay:move' != channel) return;
    emu.move(move.toString());
});

load();
