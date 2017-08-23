var self

const PassUI = function (nes) {
  this.nes = nes
  this.offscreenRGBCount = 256 * 240 * 4
  this.enable = function () {
  }
  this.updateStatus = function () {
  }
  this.writeAudio = function () {
  }
  this.writeFrame = function (buffer, prevBuffer) {
    this.drawContextOffscreen = self.canvas.getContext('2d')
    // Get a CanvasPixelArray buffer:
    try {
      this.canvasBuffer = this.drawContextOffscreen.createImageData(256, 240)
    } catch (error) {
      console.log('Falling back to the getImageData initialization (Error "' + error.message + '").', 1)
      this.canvasBuffer = this.drawContextOffscreen.getImageData(0, 0, 256, 240)
    }
    // var canvasData = this.canvasBuffer.data
    // var pixel, i, j
    //
    // for (i = 0; i < 256 * 240; i++) {
    //   pixel = buffer[i]
    //
    //   //if (pixel !== prevBuffer[i]) {
    //     j = i * 4
    //   canvasData[j] = pixel & 0xFF
    //   canvasData[j + 1] = (pixel >> 8) & 0xFF
    //   canvasData[j + 2] = (pixel >> 16) & 0xFF
    //   //  prevBuffer[i] = pixel
    //   //}
    // }
    var canvasRGBALength = this.offscreenRGBCount
    var canvasData = this.canvasBuffer.data
    var bufferIndex = 0
    for (var canvasIndex = 0; canvasIndex < canvasRGBALength; ++canvasIndex) {
      canvasData[canvasIndex++] = buffer[bufferIndex++]
      canvasData[canvasIndex++] = buffer[bufferIndex++]
      canvasData[canvasIndex++] = buffer[bufferIndex++]
    }
    this.drawContextOffscreen.putImageData(this.canvasBuffer, 0, 0)
    self.canvas.toBuffer((err, buf) => {
      if (err) throw err
      self.emit('frame', buf)
    })
  }
}

module.exports = {
  get: function get(ref) {
    self = ref
    return PassUI
  }
}
