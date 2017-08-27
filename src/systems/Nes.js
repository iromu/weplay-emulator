import JSNES from 'node-nes'
import Canvas from 'canvas'
import {EventEmitter as Emitter} from 'events'
import stream from 'stream'
import PassUI from './PassUI'

class Nes extends Emitter {
  constructor() {
    super()
    if (!(this instanceof Nes)) return new Nes()
    this.joyPadEventTimeoutByKey = {}
    this.canvas = new Canvas(256, 240)
    this.bufferStream = new stream.PassThrough()
    this.emitStream = new stream.PassThrough()
    this.emitStream.on('data', (data) => {
      this.emit('audio', data)
    })
    this.gbOpts = {ui: PassUI.get(this)}
  }

  initWithRom(rom) {
    if (!this.nes) {
      this.nes = new JSNES(this.gbOpts)
      this.nes.loadRom(rom)
      this.nes.start()
      this.running = true
    }
  }

  initWithState(state) {
    this.initWithRom(state)
  }

  run() {
    const nes = this.nes
    // nes.ui.enabled()
    nes.isRunning = true //  not stopped
    // nes.ui.resetCanvas()
    this.loop = setInterval(nes.frame.bind(nes), 8)
    // const self = this
    // nes.on('draw', () => {
    //   self.canvas.toBuffer((err, buf) => {
    //     if (err) throw err
    //     self.emit('frame', buf)
    //   })
    // })
    this.running = true
  }

  snapshot() {
    if (!this.running) return
    return this.nes.saveState && this.nes.saveState()
  }

  move(key) {
    if (!this.running) return this
    if (key >= 0 && key < 8) {
      const gb = this.nes
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
    this.destroyed = true
    this.running = false
    this.canvas = null
    // this.nes = null
    return this
  }
}

export default Nes
