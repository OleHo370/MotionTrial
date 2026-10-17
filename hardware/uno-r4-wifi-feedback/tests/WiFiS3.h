#ifndef MOTIONTRIAL_HOST_WIFI_STUB_H
#define MOTIONTRIAL_HOST_WIFI_STUB_H
// Test doubles only. These are NOT networking, electrical, or board acceptance tests.
#include <stdint.h>
#include <stdio.h>
#include <algorithm>
#include <memory>
#include <string>
#include <vector>

static uint32_t hostNow = 0;
static bool hostPins[32] = {};
static unsigned hostToneStarts = 0, hostToneStops = 0;
static bool hostToneActive = false;
static uint32_t hostToneDuration = 0;
static uint8_t hostTonePin = 255;
static const int HIGH = 1, LOW = 0, OUTPUT = 1, WL_CONNECTED = 3;
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
  unsigned reads = 0;
  void begin(unsigned long value) { baud = value; }
  void print(const char* text) { log += text; }
  void println(const char* text) { log += std::string(text) + "\n"; }
  int available() { return int(incoming.size() - readOffset); }
  int read() {
    if (available() <= 0) return -1;
    ++reads;
    return uint8_t(incoming[readOffset++]);
  }
  void queue(const std::string& text) { incoming = text; readOffset = 0; reads = 0; }
};
static HostSerial Serial;
struct HostSocket {
  std::string request, response;
  size_t offset = 0;
  bool open = true;
};
class WiFiClient {
 public:
  std::shared_ptr<HostSocket> socket;
  WiFiClient() {}
  explicit WiFiClient(std::shared_ptr<HostSocket> value) : socket(value) {}
  operator bool() const { return socket && socket->open; }
  int available() { return socket && socket->open ? int(socket->request.size() - socket->offset) : 0; }
  int read(uint8_t* bytes, size_t length) {
    const size_t count = std::min(length, size_t(available()));
    for (size_t i = 0; i < count; ++i) bytes[i] = uint8_t(socket->request[socket->offset++]);
    return int(count);
  }
  size_t write(const uint8_t* bytes, size_t length) {
    if (!socket || !socket->open) return 0;
    socket->response.append((const char*)bytes, length);
    return length;
  }
  void stop() { if (socket) socket->open = false; }
};
class WiFiServer {
 public:
  std::vector<std::shared_ptr<HostSocket>> pending;
  unsigned begins = 0, ends = 0;
  explicit WiFiServer(int) {}
  WiFiClient available() {
    if (pending.empty()) return WiFiClient();
    const auto socket = pending.front(); pending.erase(pending.begin());
    return WiFiClient(socket);
  }
  void begin() { ++begins; }
  void end() { ++ends; }
};
class HostWiFi {
 public:
  int connectionStatus = WL_CONNECTED;
  unsigned attempts = 0;
  unsigned openAttempts = 0, protectedAttempts = 0;
  bool wasIdleAtBegin = false;
  std::string lastSSID, lastPassword;
  int status() { return connectionStatus; }
  int begin(const char* ssid) {
    ++attempts; ++openAttempts;
    lastSSID = ssid; lastPassword.clear();
    wasIdleAtBegin = !hostPins[5] && !hostPins[6] && !hostToneActive;
    return connectionStatus;
  }
  int begin(const char* ssid, const char* password) {
    ++attempts; ++protectedAttempts;
    lastSSID = ssid; lastPassword = password;
    wasIdleAtBegin = !hostPins[5] && !hostPins[6] && !hostToneActive;
    return connectionStatus;
  }
  const char* localIP() { return "192.168.1.42"; }
};
static HostWiFi WiFi;
#endif
