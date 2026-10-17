#ifndef MOTIONTRIAL_USB_HOST_ARDUINO_H
#define MOTIONTRIAL_USB_HOST_ARDUINO_H
// Test doubles only: not electrical acceptance or USB hardware validation.
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string>
#include <algorithm>
static uint32_t hostNow = 0;
static bool hostPins[32] = {};
static unsigned hostToneStarts = 0, hostToneStops = 0;
static bool hostToneActive = false;
static uint32_t hostToneDuration = 0;
static uint8_t hostTonePin = 255;
static const int HIGH = 1, LOW = 0, OUTPUT = 1;
inline uint32_t millis() { return hostNow; }
inline void pinMode(uint8_t, int) {}
inline void digitalWrite(uint8_t pin, int value) { hostPins[pin] = value != 0; }
inline void tone(uint8_t pin, unsigned int frequency, unsigned long duration) {
  if (frequency != 2000) abort();
  ++hostToneStarts; hostTonePin = pin; hostToneDuration = duration; hostToneActive = true;
}
inline void noTone(uint8_t pin) { ++hostToneStops; hostTonePin = pin; hostToneActive = false; }
class HostSerial {
 public:
  unsigned long baud = 0;
  std::string log, incoming;
  size_t readOffset = 0;
  unsigned reads = 0, writes = 0;
  int freeBytes = 256;
  size_t largestWrite = 0;
  unsigned capacityQueries = 0;
  unsigned longestWireTimeUs = 0;
  unsigned bridgeFlushes = 0, bridgeLostBytes = 0;
  std::string bridgeShiftRegister;
  void begin(unsigned long value) { baud = value; }
  int available() { return int(incoming.size() - readOffset); }
  int availableForWrite() {
    ++capacityQueries;
#if defined(NO_USB) && defined(ARDUINO_UNOR4_WIFI)
    return 0; // Exact official1.6 UART inherits Print's unimplemented method.
#else
    return freeBytes;
#endif
  }
  int read() {
    if (available() <= 0) return -1;
    ++reads;
    return uint8_t(incoming[readOffset++]);
  }
  size_t write(const uint8_t* bytes, size_t length) {
    if (length > size_t(freeBytes)) abort();
    ++writes; largestWrite = std::max(length, largestWrite);
    log.append((const char*)bytes, length);
    return length;
  }
  size_t write(uint8_t* bytes, size_t length) {
#if defined(NO_USB) && defined(ARDUINO_UNOR4_WIFI)
    ++writes; largestWrite = std::max(length, largestWrite);
    longestWireTimeUs = std::max(longestWireTimeUs,
      unsigned((length * 10 * 1000000 + 115200 - 1) / 115200));
    // The real UART write returns at TX_DATA_EMPTY. Its last byte is still in
    // flight until TX_COMPLETE; starting another transfer can lose that byte.
    if (!bridgeShiftRegister.empty()) { ++bridgeLostBytes; bridgeShiftRegister.clear(); }
    if (length > 0) {
      log.append((const char*)bytes, length - 1);
      bridgeShiftRegister.assign((const char*)bytes + length - 1, 1);
    }
    return length;
#else
    return write((const uint8_t*)bytes, length);
#endif
  }
  void flush() {
#if defined(NO_USB) && defined(ARDUINO_UNOR4_WIFI)
    ++bridgeFlushes;
    log += bridgeShiftRegister; bridgeShiftRegister.clear();
#endif
  }
  void queue(const std::string& text) { incoming = text; readOffset = 0; reads = 0; }
};
static HostSerial Serial;
#endif
