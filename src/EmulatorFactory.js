import Gameboy from './systems/Gameboy'
import Nes from './systems/Nes'

export default {
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
