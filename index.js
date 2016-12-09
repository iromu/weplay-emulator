'use strict';

const fs = require('fs');
const Emulator = require('./emulator');
const join = require('path').join;
const crypto = require('crypto');
const msgpack = require('msgpack');
const debug = require('debug')('weplay:worker');

const logger = require('weplay-common').logger('weplay-emulator');


if (!process.env.WEPLAY_ROM) {
    logger.error('You must specify the ENV variable `WEPLAY_ROM` '
        + 'pointint to location of rom file to broadcast.');
    process.exit(1);
}

process.title = 'weplay-emulator';

// redis
const redis = require('weplay-common').redis();
const sub = require('weplay-common').redis();


var digest = function (state) {
    var md5 = crypto.createHash('md5');
    return md5.update(state).digest('hex');
};

// rom
let file = process.env.WEPLAY_ROM;
if ('/' != file[0]) file = join(process.cwd(), file);
logger.info('rom %s', file);
const rom = fs.readFileSync(file);
var romHash = digest(file);
logger.info('rom hash %s', romHash);

// save interval
const saveInterval = process.env.WEPLAY_SAVE_INTERVAL || 60000;
logger.info('save interval %d', saveInterval);

// load emulator
let emu;



function load() {
    logger.info('loading emulator');
    emu = new Emulator();
    var frameCounter = 0;
    emu.on('error', () => {
        logger.error('restarting emulator');
        emu.destroy();
        setTimeout(load, 1000);
    });

    emu.on('frame', frame => {
        frameCounter++;
        redis.publish('weplay:frame:raw', frame);
    });

    redis.get(`weplay:state:${romHash}`, (err, state) => {
        if (err) throw err;
        if (state) {
            logger.info('init from state', {state: digest(state)});
            emu.initWithState(msgpack.unpack(state));
        } else {
            logger.info('init from rom');
            emu.initWithRom(rom);
        }
        emu.run();
        save();
    });

    function save() {
        logger.info('will save in %d', saveInterval);
        setTimeout(() => {
            const snap = emu.snapshot();
            if (snap) {
                logger.info('saving state');
                redis.set(`weplay:state:${romHash}`, msgpack.pack(snap));
                redis.expire(`weplay:state:${romHash}`, saveInterval);
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
