
const gameboy = require('gameboy');
const Canvas = require('canvas');
const Emitter = require('events').EventEmitter;

class Emulator {
  constructor() {
    if (!(this instanceof Emulator)) return new Emulator();
    this.canvas = new Canvas(160, 144);
    this.gbOpts = { drawEvents: true };
  }

  initWithRom(rom) {
    this.gameboy = gameboy(this.canvas, rom, this.gbOpts);
    this.gameboy.start();
  }

  initWithState(state) {
    this.gameboy = gameboy(this.canvas, '', this.gbOpts);
    this.gameboy.returnFromState(state);
  }

  run() {
    const gb = this.gameboy;
    gb.stopEmulator = 1; // not stopped
    this.loop = setInterval(gb.run.bind(gb), 8);
    const self = this;
    gb.on('draw', () => {
      self.canvas.toBuffer((err, buf) => {
        if (err) throw err;
        self.emit('frame', buf);
      });
    });
    this.running = true;
  }

  snapshot() {
    if (!this.running) return;
    return this.gameboy.saveState();
  }

  move(key) {
    if (!this.running) return this;
    if (key >= 0 && key < 8) {
      const gb = this.gameboy;
      gb.JoyPadEvent(key, true);
      setTimeout(() => {
        gb.JoyPadEvent(key, false);
      }, 50);
    }
    return this;
  }

  destroy() {
    if (this.destroyed) return this;
    clearInterval(this.loop);
    // ignore stacked key timers from Emulator#move
    this.gameboy.JoyPadEvent = () => {};
    this.destroyed = true;
    this.running = false;
    this.canvas = null;
    this.gameboy = null;
    return this;
  }
}

Emulator.prototype.__proto__ = Emitter.prototype;

module.exports = Emulator;