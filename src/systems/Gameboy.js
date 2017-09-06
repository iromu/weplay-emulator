import gameboy from 'gameboy'
import Canvas from 'canvas'
import {EventEmitter as Emitter} from 'events'
import SoundInterfaceFactory from './SoundInterfaceFactory'

require('./Float32Array.concat')

class Gameboy extends Emitter {
  constructor() {
    super()
    if (!(this instanceof Gameboy)) return new Gameboy()
    this.joyPadEventTimeoutByKey = {}
    this.canvas = new Canvas(160, 144)
    this.soundInterface = SoundInterfaceFactory.get(this)
    this.gbOpts = {drawEvents: true, sound: this.soundInterface, audioBufferMin: 100, audioBufferMax: 200}
  }

  initWithRom(rom) {
    this.gameboy = gameboy(this.canvas, rom, this.gbOpts)
    this.gameboy.start()
  }

  initWithState(state) {
    if (!this.gameboy) {
      this.gameboy = gameboy(this.canvas, '', this.gbOpts)
    }
    this.gameboy.returnFromState(state)
  }

  run() {
    const gb = this.gameboy
    gb.stopEmulator = 1 //  not stopped
    this.loop = setInterval(gb.run.bind(gb), 8)
    const self = this
    gb.on('draw', () => {
      self.canvas.toBuffer((err, buf) => {
        if (err) throw err
        self.emit('frame', buf)
      })
    })
    this.running = true
  }

  snapshot() {
    if (!this.running) return
    return this.gameboy.saveState()
  }

  move(key) {
    if (!this.running) return this
    if (key >= 0 && key < 8) {
      const gb = this.gameboy
      gb.JoyPadEvent(key, true)
      // Extend timeout
      if (this.joyPadEventTimeoutByKey[key]) {
        clearTimeout(this.joyPadEventTimeoutByKey[key])
        this.joyPadEventTimeoutByKey[key] = undefined
      }
      this.joyPadEventTimeoutByKey[key] = setTimeout(() => {
        gb.JoyPadEvent(key, false)
        clearTimeout(this.joyPadEventTimeoutByKey[key])
        this.joyPadEventTimeoutByKey[key] = undefined
      }, 50)
    }
    return this
  }

  destroy() {
    if (this.destroyed) return this
    clearInterval(this.loop)
    //  ignore stacked key timers from Emulator#move
    this.gameboy.JoyPadEvent = () => {
      // ignored
    }
    this.gameboy.stopEmulator = 3
    this.destroyed = true
    this.running = false
    this.canvas = null
    // this.gameboy = null
    return this
  }
}

export default Gameboy
