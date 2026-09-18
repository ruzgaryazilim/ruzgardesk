import Foundation
import CoreGraphics

// RuzgarDesk Native macOS Input Injection Agent
// Reads line-delimited commands from stdin and posts events using CoreGraphics Quartz Event Services.
// Requires Accessibility permissions in System Settings -> Privacy & Security -> Accessibility.

setbuf(stdout, nil)
setbuf(stderr, nil)

var screenLeft: Double = 0
var screenTop: Double = 0
var screenWidth: Double = 1920
var screenHeight: Double = 1080

var isLeftDown = false
var isRightDown = false

// Windows Virtual Key code -> macOS CGKeyCode
let vkMap: [Int: CGKeyCode] = [
    8: 51,   // Backspace
    9: 48,   // Tab
    13: 36,  // Enter
    16: 56,  // Shift
    17: 59,  // Control
    18: 58,  // Option / Alt
    20: 57,  // CapsLock
    27: 53,  // Escape
    32: 49,  // Space
    33: 116, // PageUp
    34: 121, // PageDown
    35: 119, // End
    36: 115, // Home
    37: 123, // Left Arrow
    38: 126, // Up Arrow
    39: 124, // Right Arrow
    40: 125, // Down Arrow
    45: 114, // Insert / Help
    46: 117, // Forward Delete
    // Digits 0-9
    48: 29, 49: 18, 50: 19, 51: 20, 52: 21,
    53: 23, 54: 22, 55: 26, 56: 28, 57: 25,
    // Letters A-Z
    65: 0, 66: 11, 67: 8, 68: 2, 69: 14, 70: 3, 71: 5, 72: 4, 73: 34,
    74: 38, 75: 40, 76: 37, 77: 46, 78: 45, 79: 31, 80: 35, 81: 12,
    82: 15, 83: 1, 84: 17, 85: 32, 86: 9, 87: 13, 88: 7, 89: 16, 90: 6,
    // Command / Windows Meta
    91: 55, 92: 55, 93: 110,
    // Numpad 0-9
    96: 82, 97: 83, 98: 84, 99: 85, 100: 86,
    101: 87, 102: 88, 103: 89, 104: 91, 105: 92,
    106: 67, 107: 69, 109: 78, 110: 65, 111: 75,
    // Function keys F1-F12
    112: 122, 113: 120, 114: 99, 115: 118, 116: 96, 117: 97,
    118: 98, 119: 100, 120: 101, 121: 109, 122: 103, 123: 111,
    // Punctuation
    186: 41, // Semicolon
    187: 24, // Equal
    188: 43, // Comma
    189: 27, // Minus
    190: 47, // Period
    191: 44, // Slash
    192: 50, // Backquote
    219: 33, // Left Bracket
    220: 42, // Backslash
    221: 30, // Right Bracket
    222: 39  // Quote
]

func calcPoint(_ xFrac: Double, _ yFrac: Double) -> CGPoint {
    let px = screenLeft + xFrac * screenWidth
    let py = screenTop + yFrac * screenHeight
    return CGPoint(x: px, y: py)
}

func moveMouse(to pt: CGPoint) {
    let type: CGEventType
    if isLeftDown {
        type = .leftMouseDragged
    } else if isRightDown {
        type = .rightMouseDragged
    } else {
        type = .mouseMoved
    }
    if let ev = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: pt, mouseButton: .left) {
        ev.post(tap: .cghidEventTap)
    }
}

func mouseDown(btn: String, at pt: CGPoint) {
    moveMouse(to: pt)
    let type: CGEventType
    let button: CGMouseButton
    if btn == "R" {
        type = .rightMouseDown
        button = .right
        isRightDown = true
    } else if btn == "M" {
        type = .otherMouseDown
        button = .center
    } else {
        type = .leftMouseDown
        button = .left
        isLeftDown = true
    }
    if let ev = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: pt, mouseButton: button) {
        ev.post(tap: .cghidEventTap)
    }
}

func mouseUp(btn: String, at pt: CGPoint) {
    let type: CGEventType
    let button: CGMouseButton
    if btn == "R" {
        type = .rightMouseUp
        button = .right
        isRightDown = false
    } else if btn == "M" {
        type = .otherMouseUp
        button = .center
    } else {
        type = .leftMouseUp
        button = .left
        isLeftDown = false
    }
    if let ev = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: pt, mouseButton: button) {
        ev.post(tap: .cghidEventTap)
    }
}

func scrollWheel(delta: Double, at pt: CGPoint) {
    moveMouse(to: pt)
    // Scale delta appropriately for macOS lines
    let lines = Int32(delta > 0 ? max(1, Int(delta / 40)) : min(-1, Int(delta / 40)))
    if let ev = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: lines, wheel2: 0, wheel3: 0) {
        ev.post(tap: .cghidEventTap)
    }
}

func keyEvent(vk: Int, down: Bool) {
    guard let cgKey = vkMap[vk] else { return }
    if let ev = CGEvent(keyboardEventSource: nil, virtualKey: cgKey, keyDown: down) {
        ev.post(tap: .cghidEventTap)
    }
}

func typeUnicode(codepoint: Int) {
    guard let scalar = UnicodeScalar(codepoint) else { return }
    let str = String(Character(scalar))
    let utf16 = Array(str.utf16)
    if let evDown = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true) {
        evDown.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
        evDown.post(tap: .cghidEventTap)
    }
    if let evUp = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) {
        evUp.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
        evUp.post(tap: .cghidEventTap)
    }
}

// Signal readiness to parent Electron process
print("RD_READY")
fflush(stdout)

// Process commands from stdin
while let line = readLine() {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { continue }

    let parts = trimmed.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
    let cmd = parts[0]

    switch cmd {
    case "SCREEN":
        if parts.count >= 5,
           let l = Double(parts[1]),
           let t = Double(parts[2]),
           let w = Double(parts[3]),
           let h = Double(parts[4]),
           w > 0, h > 0 {
            screenLeft = l
            screenTop = t
            screenWidth = w
            screenHeight = h
        }
    case "M":
        if parts.count >= 3,
           let x = Double(parts[1]),
           let y = Double(parts[2]) {
            moveMouse(to: calcPoint(x, y))
        }
    case "D":
        if parts.count >= 4,
           let x = Double(parts[2]),
           let y = Double(parts[3]) {
            mouseDown(btn: parts[1], at: calcPoint(x, y))
        }
    case "U":
        if parts.count >= 4,
           let x = Double(parts[2]),
           let y = Double(parts[3]) {
            mouseUp(btn: parts[1], at: calcPoint(x, y))
        }
    case "C":
        if parts.count >= 4,
           let x = Double(parts[2]),
           let y = Double(parts[3]) {
            let pt = calcPoint(x, y)
            mouseDown(btn: parts[1], at: pt)
            mouseUp(btn: parts[1], at: pt)
        }
    case "W":
        if parts.count >= 4,
           let delta = Double(parts[1]),
           let x = Double(parts[2]),
           let y = Double(parts[3]) {
            scrollWheel(delta: delta, at: calcPoint(x, y))
        }
    case "K":
        if parts.count >= 3,
           let vk = Int(parts[1]),
           let down = Int(parts[2]) {
            keyEvent(vk: vk, down: down == 1)
        }
    case "T":
        if parts.count >= 2,
           let cp = Int(parts[1]) {
            typeUnicode(codepoint: cp)
        }
    case "PING":
        print("PONG")
        fflush(stdout)
    default:
        break
    }
}
