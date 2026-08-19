'use strict';

/**
 * Injeta eventos de mouse/teclado recebidos do viewer no sistema operacional
 * real, usando @nut-tree-fork/nut-js (funciona em Windows, macOS e Linux —
 * no Linux requer X11; Wayland tem suporte parcial dependendo do compositor).
 *
 * Coordenadas de mouse chegam normalizadas (0..1, relativas ao tamanho do
 * vídeo que o viewer está vendo) e são convertidas aqui para pixels reais da
 * tela primária do host.
 */

const { mouse, keyboard, Point, Button, Key } = require('@nut-tree-fork/nut-js');

mouse.config.mouseSpeed = 4000; // movimento instantâneo o suficiente p/ sentir "ao vivo"
keyboard.config.autoDelayMs = 0;

let screenSize = { width: 1920, height: 1080 };

function setScreenSize(width, height) {
  screenSize = { width, height };
}

const BUTTON_MAP = {
  0: Button.LEFT,
  1: Button.MIDDLE,
  2: Button.RIGHT,
};

// Mapa DOM KeyboardEvent.code -> nut-js Key. Cobre o essencial de um
// teclado ABNT2/US; teclas fora do mapa são ignoradas silenciosamente.
const KEY_MAP = {
  Backspace: Key.Backspace, Tab: Key.Tab, Enter: Key.Enter, NumpadEnter: Key.Enter,
  ShiftLeft: Key.LeftShift, ShiftRight: Key.RightShift,
  ControlLeft: Key.LeftControl, ControlRight: Key.RightControl,
  AltLeft: Key.LeftAlt, AltRight: Key.RightAlt,
  MetaLeft: Key.LeftSuper, MetaRight: Key.RightSuper,
  CapsLock: Key.CapsLock, Escape: Key.Escape, Space: Key.Space,
  PageUp: Key.PageUp, PageDown: Key.PageDown, End: Key.End, Home: Key.Home,
  ArrowLeft: Key.Left, ArrowUp: Key.Up, ArrowRight: Key.Right, ArrowDown: Key.Down,
  Insert: Key.Insert, Delete: Key.Delete,
  Minus: Key.Minus, Equal: Key.Equal, BracketLeft: Key.LeftBracket, BracketRight: Key.RightBracket,
  Backslash: Key.Backslash, Semicolon: Key.Semicolon, Quote: Key.Quote,
  Comma: Key.Comma, Period: Key.Period, Slash: Key.Slash, Backquote: Key.Grave,
  F1: Key.F1, F2: Key.F2, F3: Key.F3, F4: Key.F4, F5: Key.F5, F6: Key.F6,
  F7: Key.F7, F8: Key.F8, F9: Key.F9, F10: Key.F10, F11: Key.F11, F12: Key.F12,
  Digit0: Key.Num0, Digit1: Key.Num1, Digit2: Key.Num2, Digit3: Key.Num3, Digit4: Key.Num4,
  Digit5: Key.Num5, Digit6: Key.Num6, Digit7: Key.Num7, Digit8: Key.Num8, Digit9: Key.Num9,
};
for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  KEY_MAP[`Key${letter}`] = Key[letter];
}

function resolveKey(code) {
  return KEY_MAP[code] || null;
}

async function inject(event) {
  try {
    switch (event.type) {
      case 'mousemove': {
        const x = Math.round(event.x * screenSize.width);
        const y = Math.round(event.y * screenSize.height);
        await mouse.setPosition(new Point(x, y));
        break;
      }
      case 'mousedown': {
        const btn = BUTTON_MAP[event.button];
        if (btn !== undefined) await mouse.pressButton(btn);
        break;
      }
      case 'mouseup': {
        const btn = BUTTON_MAP[event.button];
        if (btn !== undefined) await mouse.releaseButton(btn);
        break;
      }
      case 'wheel': {
        if (event.deltaY) {
          if (event.deltaY > 0) await mouse.scrollDown(Math.min(20, Math.abs(Math.round(event.deltaY / 20)) || 1));
          else await mouse.scrollUp(Math.min(20, Math.abs(Math.round(event.deltaY / 20)) || 1));
        }
        if (event.deltaX) {
          if (event.deltaX > 0) await mouse.scrollRight(Math.min(20, Math.abs(Math.round(event.deltaX / 20)) || 1));
          else await mouse.scrollLeft(Math.min(20, Math.abs(Math.round(event.deltaX / 20)) || 1));
        }
        break;
      }
      case 'keydown': {
        const key = resolveKey(event.code);
        if (key !== null) await keyboard.pressKey(key);
        break;
      }
      case 'keyup': {
        const key = resolveKey(event.code);
        if (key !== null) await keyboard.releaseKey(key);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    // Nunca deixa uma falha de injeção derrubar a sessão inteira.
    console.error('[input-controller] falha ao injetar evento', event?.type, err);
  }
}

module.exports = { inject, setScreenSize };
