import Canvas from 'canvas'

let self

class PassUI {
  constructor(nes) {
    this.nes = nes
    this.canvas = new Canvas(256, 240)
    this.offscreenRGBCount = 256 * 240 * 4
    this.drawContextOffscreen = this.canvas.getContext('2d')

    // Get a CanvasPixelArray buffer:
    try {
      this.canvasBuffer = this.drawContextOffscreen.createImageData(256, 240)
    } catch (error) {
      console.log(`Falling back to the getImageData initialization (Error "${error.message}").`, 1)
      this.canvasBuffer = this.drawContextOffscreen.getImageData(0, 0, 256, 240)
    }

    const canvasData = this.canvasBuffer.data
    let index = this.offscreenRGBCount

    while (index > 0) {
      canvasData[index -= 4] = 0xF8
      canvasData[index + 1] = 0xF8
      canvasData[index + 2] = 0xF8
      canvasData[index + 3] = 0xFF
    }
  }

  enable() {
  }

  updateStatus() {
  }

  writeAudio() {
  }

  writeFrame(buffer, prevBuffer) {
    const canvasData = this.canvasBuffer.data
    var pixel, i, j

    for (i = 0; i < 256 * 240; i++) {
      pixel = buffer[i]
      if (pixel !== prevBuffer[i]) {
        j = i * 4
        canvasData[j] = pixel & 0xFF
        canvasData[j + 1] = (pixel >> 8) & 0xFF
        canvasData[j + 2] = (pixel >> 16) & 0xFF
        prevBuffer[i] = pixel
      }
    }
    this.drawContextOffscreen.putImageData(this.canvasBuffer, 0, 0)
    this.canvas.toBuffer((err, buf) => {
      if (err) throw err
      self.emit('frame', buf)
    })
  }
}

export default {
  get: function get(ref) {
    self = ref
    return (nes) => {
      return new PassUI(nes)
    }
  }
}
