const Gameboy = require('./systems/Gameboy')
const Nes = require('./systems/Nes')

module.exports = {
  getEmu: function getEmu(system) {
    let emu = new Gameboy()
    switch (system) {
      case 'gb':
        emu = new Gameboy()
        break
      case 'nes':
        emu = new Nes()
        break
    }
    return emu
  }
}
