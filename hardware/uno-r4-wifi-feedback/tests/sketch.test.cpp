#include <stdlib.h>
// Explicit host-test credentials. Never read or depend on the user's private values.
// The production sketch is included unchanged; its private header is guard-skipped.
#define MOTIONTRIAL_ARDUINO_SECRETS_H
#define SECRET_SSID "MotionTrial-Host-Test-Only"
#ifdef MOTIONTRIAL_TEST_OPEN_NETWORK
#define SECRET_PASS ""
#else
#define SECRET_PASS "Host-Test-Password-Only"
#endif
#define MOTIONTRIAL_SHARED_KEY "0123456789abcdef0123456789abcdef"
#include "../uno-r4-wifi-feedback.ino"

static unsigned assertions = 0;
static void check(bool condition, const char* message) {
  ++assertions;
  if (!condition) { fprintf(stderr, "FAIL: %s\n", message); exit(1); }
}
static std::shared_ptr<HostSocket> enqueue(const std::string& method, const std::string& body,
  const std::string& key = MOTIONTRIAL_SHARED_KEY, bool complete = true) {
  auto socket = std::make_shared<HostSocket>();
  socket->request = method + (method == "GET" ? " /motiontrial/status" : " /motiontrial/feedback") +
    " HTTP/1.1\r\nHost: 192.168.1.42\r\nX-MotionTrial-Key: " + key +
    "\r\nContent-Type: text/plain\r\nContent-Length: " + std::to_string(body.size()) + "\r\n\r\n" + body;
  if (!complete) socket->request = socket->request.substr(0, socket->request.size() - 1);
  server.pending.push_back(socket);
  return socket;
}
static void pump(const std::shared_ptr<HostSocket>& socket) {
  for (unsigned i = 0; i < 50 && socket->open; ++i) { loop(); hostNow += 10; }
  check(!socket->open, "HTTP connection closes within fixed deadline");
}
static void resetReady() {
  forceIdle(); closeClient(); server.pending.clear();
  configReady = true; networkReady = true; hostNow = 1000;
  attemptedConnection = false; lastConnectMs = 0;
  Serial.queue("");
  WiFi.attempts = 0; WiFi.openAttempts = 0; WiFi.protectedAttempts = 0;
  lastWifiPollMs = hostNow; WiFi.connectionStatus = WL_CONNECTED;
}
static void checkNetworkMode(unsigned expectedAttempts) {
  check(WiFi.attempts == expectedAttempts, "actual connection attempts are counted");
#ifdef MOTIONTRIAL_TEST_OPEN_NETWORK
  check(WiFi.openAttempts == expectedAttempts && WiFi.protectedAttempts == 0,
    "empty password uses only the one-argument open-network overload");
  check(WiFi.lastPassword.empty(), "open connection supplies no password");
#else
  check(WiFi.protectedAttempts == expectedAttempts && WiFi.openAttempts == 0,
    "nonempty password always uses protected overload, with no open fallback");
  check(WiFi.lastPassword == SECRET_PASS, "protected connection receives configured test password");
#endif
  check(WiFi.lastSSID == SECRET_SSID, "both modes use the configured test network name");
}

int main() {
  setup();
  check(Serial.baud == 115200, "Serial baud115200");
  check(!hostPins[5] && !hostPins[6] && feedback.state == MotionTrial::IDLE, "setup outputs idle");
  check(hostToneStops > 0, "setup explicitly stops tone");
  check(configReady, "explicit test credentials pass real sketch configuration validation");
  WiFi.connectionStatus = 0; hostNow = WIFI_POLL_MS; loop();
  checkNetworkMode(1);
  check(WiFi.wasIdleAtBegin && !hostToneActive && !hostPins[5] && !hostPins[6],
    "first connection keeps all outputs idle before and after WiFi.begin");
  hostNow += WIFI_POLL_MS; loop();
  checkNetworkMode(1);
  check(!networkReady, "failed connection cannot start the HTTP service");
  hostNow = lastConnectMs + RECONNECT_MS; loop();
  checkNetworkMode(2);
  check(WiFi.wasIdleAtBegin && feedback.state == MotionTrial::IDLE,
    "failed-network retry stays idle and retains the configured security mode");
  WiFi.connectionStatus = WL_CONNECTED; hostNow += WIFI_POLL_MS; loop();
  check(networkReady && !hostPins[5] && !hostPins[6] && !hostToneActive,
    "initial connection starts HTTP service without activating feedback");
  resetReady();
  auto good = enqueue("POST", "good\n"); pump(good);
  check(feedback.state == MotionTrial::GOOD && hostPins[5] && !hostPins[6], "valid good POST drives green only");
  check(good->response.find("\"device\":\"motiontrial-uno-r4-wifi\",\"protocol\":1,\"state\":\"good\"") != std::string::npos, "correct state JSON");
  const auto accepted = feedback.lastPostMs;
  hostNow = accepted + 500;
  auto get = enqueue("GET", ""); pump(get);
  check(feedback.lastPostMs == accepted, "actual status handler does not renew lease");
  hostNow = accepted + 900; loop();
  check(!hostPins[5] && !hostPins[6] && feedback.state == MotionTrial::IDLE, "actual loop expires outputs at900ms");

  resetReady();
  auto off = enqueue("POST", "off\n"); pump(off);
  check(!hostPins[5] && hostPins[6] && hostToneStarts > 0, "valid off starts red beep");
  check(hostTonePin == 8 && hostToneDuration == 80, "tone is onD8 with finite80ms duration");
  hostNow = offBeganMs + 100; loop();
  check(hostPins[6] && !buzzWasOn, "red remains while short beep stops");
  hostNow = offBeganMs + 350; loop();
  check(!hostPins[6] && !buzzWasOn, "flash off phase");

  resetReady(); feedback.accept(MotionTrial::GOOD, hostNow); renderOutputs(hostNow);
  const auto originalLease = feedback.lastPostMs;
  auto invalid = enqueue("POST", "off\n", "ffffffffffffffffffffffffffffffff"); pump(invalid);
  check(invalid->response.find("401 Unauthorized") != std::string::npos, "actual handler rejects wrong key");
  check(feedback.lastPostMs == originalLease && feedback.state == MotionTrial::GOOD, "wrong key does not change or renew outputs");

  resetReady(); feedback.accept(MotionTrial::GOOD, hostNow); renderOutputs(hostNow);
  const auto partialLease = feedback.lastPostMs;
  auto partial = enqueue("POST", "off\n", MOTIONTRIAL_SHARED_KEY, false); pump(partial);
  check(partial->response.find("408 Request Timeout") != std::string::npos, "partial body times out");
  check(feedback.lastPostMs == partialLease && feedback.state == MotionTrial::GOOD, "partial POST did not apply");
  hostNow = partialLease + 900; loop();
  check(feedback.state == MotionTrial::IDLE && !hostPins[5], "partial client cannot block watchdog");

  resetReady(); feedback.accept(MotionTrial::OFF, hostNow); renderOutputs(hostNow);
  auto dribble = std::make_shared<HostSocket>();
  dribble->request = "P"; server.pending.push_back(dribble);
  for (unsigned i = 0; i < 40 && dribble->open; ++i) {
    loop(); hostNow += 10; if (i % 9 == 0) dribble->request += "O";
  }
  check(!dribble->open && dribble->response.find("408 Request Timeout") != std::string::npos, "dribbled bytes cannot extend350ms deadline");

  resetReady(); feedback.accept(MotionTrial::OFF, hostNow); renderOutputs(hostNow);
  WiFi.connectionStatus = 0; hostNow += 100; loop();
  check(feedback.state == MotionTrial::IDLE && !hostPins[5] && !hostPins[6] && !buzzWasOn, "WiFi disconnect force idle");
  check(WiFi.attempts == 1 && WiFi.wasIdleAtBegin, "outputs cleared before reconnect call");
  checkNetworkMode(1);
  check(!hostToneActive && !clientOpen && !networkReady,
    "disconnect stops sound and closes networking state");
  hostNow = lastConnectMs + RECONNECT_MS; loop();
  checkNetworkMode(2);
  check(!hostPins[5] && !hostPins[6] && !hostToneActive,
    "continued disconnection never restores stale feedback");
  WiFi.connectionStatus = WL_CONNECTED; hostNow += 100; loop();
  check(networkReady && feedback.state == MotionTrial::IDLE, "reconnect stays idle until new command");

  resetReady(); feedback.accept(MotionTrial::GOOD, hostNow); renderOutputs(hostNow);
  const auto serialLease = feedback.lastPostMs;
  const auto serialToneStarts = hostToneStarts;
  const auto queryLogStart = Serial.log.size();
  Serial.queue("?"); loop();
  const auto queryLog = Serial.log.substr(queryLogStart);
  check(queryLog == "MotionTrial UNO R4 WiFi protocol 1 ready. IP: 192.168.1.42\n",
    "connected serial query prints only the existing ready/IP marker");
  check(Serial.available() == 0 && Serial.reads == 1, "serial query consumes its input byte");
  check(feedback.state == MotionTrial::GOOD && feedback.lastPostMs == serialLease &&
    hostPins[5] && !hostPins[6] && hostToneStarts == serialToneStarts,
    "serial status query neither changes outputs nor renews the feedback lease");
  const auto ignoredLogStart = Serial.log.size();
  Serial.queue("xyz\r\n"); loop();
  check(Serial.log.size() == ignoredLogStart && Serial.available() == 0,
    "non-query serial bytes produce no log or echo");
  check(feedback.lastPostMs == serialLease && feedback.state == MotionTrial::GOOD,
    "ignored serial input cannot change the active feedback command");

  const auto boundedLogStart = Serial.log.size();
  Serial.queue(std::string(20, '?')); loop();
  check(Serial.reads == 8 && Serial.available() == 12,
    "one loop consumes at most eight serial bytes");
  check(Serial.log.substr(boundedLogStart) == queryLog,
    "multiple queries in one bounded batch produce only one status line");
  Serial.queue("abcdefgh?");
  const auto delayedLogStart = Serial.log.size(); loop();
  check(Serial.reads == 8 && Serial.available() == 1 && Serial.log.size() == delayedLogStart,
    "a query after byte eight is deferred to the next loop");
  loop();
  check(Serial.available() == 0 && Serial.log.substr(delayedLogStart) == queryLog,
    "deferred query is handled by the next loop without blocking");

  resetReady(); networkReady = false; WiFi.connectionStatus = 0;
  const auto noNetworkLogStart = Serial.log.size(); Serial.queue("?"); loop();
  const auto noNetworkLog = Serial.log.substr(noNetworkLogStart);
  check(!noNetworkLog.empty() && noNetworkLog.find("192.168.1.42") == std::string::npos &&
    noNetworkLog.find("ready. IP:") == std::string::npos,
    "disconnected serial query gives a generic status instead of a stale IP");
  check(feedback.state == MotionTrial::IDLE && !hostPins[5] && !hostPins[6] && !hostToneActive,
    "disconnected query leaves all outputs idle");
  resetReady(); configReady = false;
  const auto noConfigLogStart = Serial.log.size(); Serial.queue("?"); loop();
  const auto noConfigLog = Serial.log.substr(noConfigLogStart);
  check(!noConfigLog.empty() && noConfigLog.find("192.168.1.42") == std::string::npos &&
    noConfigLog.find("ready. IP:") == std::string::npos,
    "unconfigured serial query gives a generic setup status even before loop returns");
  check(feedback.state == MotionTrial::IDLE && !hostPins[5] && !hostPins[6] && !hostToneActive,
    "unconfigured query cannot activate feedback");

  resetReady(); feedback.accept(MotionTrial::GOOD, hostNow); renderOutputs(hostNow);
  const auto floodedLease = feedback.lastPostMs;
  Serial.queue(std::string(1024, '?')); hostNow += 900; loop();
  check(Serial.reads == 8 && Serial.available() == 1016,
    "serial flood is bounded without draining all pending bytes");
  check(feedback.lastPostMs == floodedLease && feedback.state == MotionTrial::IDLE &&
    !hostPins[5] && !hostPins[6] && !hostToneActive,
    "serial queries cannot delay watchdog expiry or renew the feedback lease");
  check(Serial.log.find("MotionTrial UNO R4 WiFi protocol 1 ready. IP: 192.168.1.42") != std::string::npos, "connected IP printed");
  check(Serial.log.find(MOTIONTRIAL_SHARED_KEY) == std::string::npos, "shared key never printed");
  check(Serial.log.find(SECRET_SSID) == std::string::npos, "SSID never printed");
#ifndef MOTIONTRIAL_TEST_OPEN_NETWORK
  check(Serial.log.find(SECRET_PASS) == std::string::npos, "password never printed");
#endif
  printf("PASS: actual sketch with explicit simulated Wi-Fi/GPIO clock doubles (%s network, %u assertions).\n",
#ifdef MOTIONTRIAL_TEST_OPEN_NETWORK
    "open",
#else
    "protected",
#endif
    assertions);
  return 0;
}
