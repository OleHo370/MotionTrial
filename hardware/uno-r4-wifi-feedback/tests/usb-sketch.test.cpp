#include <stdlib.h>
#include "../uno-r4-wifi-feedback.ino"

static unsigned assertions = 0;
static const char* SESSION = "0123456789abcdef";
static void check(bool condition, const char* message) {
  ++assertions;
  if (!condition) { fprintf(stderr, "FAIL: %s\n", message); exit(1); }
}
static std::string send(const std::string& bytes, unsigned loops = 30) {
  const auto logStart = Serial.log.size();
  Serial.queue(bytes);
  for (unsigned i = 0; i < loops; ++i) loop();
  return Serial.log.substr(logStart);
}
static void ack(const std::string& response, const char* session, uint32_t seq, const char* state) {
  const auto expected = std::string("{\"device\":\"motiontrial-uno-r4-usb\",\"protocol\":1,\"session\":\"") +
    session + "\",\"seq\":" + std::to_string(seq) + ",\"state\":\"" + state + "\"}\n";
  check(response == expected, "exact one-line protocol ACK");
}
static void reset() {
  usb = MotionTrial::UsbFeedback();
  replySize = replyOffset = 0;
  redWasOn = buzzWasOn = false; renderedState = MotionTrial::IDLE;
  hostNow = 1000; Serial.freeBytes = 256; Serial.queue("");
  setup();
  ack(send(std::string("HELLO ") + SESSION + "\n"), SESSION, 0, "idle");
}

int main() {
  setup();
  check(Serial.baud == 115200 && Serial.log.empty(), "USB starts115200 without wait or startup noise");
  check(!hostPins[5] && !hostPins[6] && !hostToneActive, "boot all outputs idle");
  check(send(std::string("SET ") + SESSION + " 1 off\n").empty(), "SET without HELLO rejected");
  reset();
  ack(send(std::string("SET ") + SESSION + " 1 good\n"), SESSION, 1, "good");
  check(hostPins[5] && !hostPins[6] && !hostToneActive, "good green silent");
  const auto leaseAt = usb.feedback.lastPostMs;
  hostNow += 500;
  ack(send(std::string("STATUS ") + SESSION + " 2\n"), SESSION, 2, "good");
  check(usb.feedback.lastPostMs == leaseAt, "STATUS read-only never renews lease");
  check(send(std::string("SET ") + SESSION + " 2 off\n").empty(), "STATUS sequence prevents replay");
  hostNow = leaseAt + 899; loop(); check(usb.feedback.state == MotionTrial::GOOD, "899ms lease active");
  hostNow = leaseAt + 900; loop();
  check(usb.feedback.state == MotionTrial::IDLE && !hostPins[5] && !hostPins[6] && !hostToneActive,
    "watchdog expires at900ms");
  ack(send(std::string("STATUS ") + SESSION + " 3\n"), SESSION, 3, "idle");

  reset();
  ack(send(std::string("SET ") + SESSION + " 1 off\n"), SESSION, 1, "off");
  check(!hostPins[5] && hostPins[6] && hostToneActive && hostTonePin == 8 && hostToneDuration == 80,
    "off starts red and finite2kHz80ms tone onD8");
  const auto began = offBeganMs;
  hostNow = began + 80; loop(); check(hostPins[6] && !hostToneActive, "beep ends at80ms");
  hostNow = began + 200; loop(); check(hostPins[6] && hostToneActive, "second beep starts at 200 ms");
  hostNow = began + 280; loop(); check(hostPins[6] && !hostToneActive, "second beep ends at 280 ms");
  hostNow = began + 300; loop(); check(!hostPins[6] && !hostToneActive, "red off at300ms");
  hostNow = began + 400; loop(); check(!hostPins[6] && hostToneActive, "third beep starts at 400 ms while red is off");
  hostNow = began + 480; loop(); check(!hostPins[6] && !hostToneActive, "third beep ends at 480 ms");
  hostNow = began + 600; loop(); check(hostPins[6] && hostToneActive, "pattern repeats at600ms");
  ack(send(std::string("SET ") + SESSION + " 2 idle\n"), SESSION, 2, "idle");
  check(!hostPins[5] && !hostPins[6] && !hostToneActive, "explicit idle stops lights and sound");

  reset();
  const auto tonesBeforeHeartbeat = hostToneStarts;
  ack(send(std::string("SET ") + SESSION + " 1 off\n"), SESSION, 1, "off");
  const auto heartbeatBegan = offBeganMs;
  for (unsigned t = 1; t < 1450; ++t) {
    hostNow = heartbeatBegan + t;
    if (t == 250) ack(send(std::string("SET ") + SESSION + " 2 off\n"), SESSION, 2, "off");
    if (t == 550) ack(send(std::string("SET ") + SESSION + " 3 off\n"), SESSION, 3, "off");
    loop();
    check(usb.feedback.state == MotionTrial::OFF && offBeganMs == heartbeatBegan &&
      !hostPins[5] && hostPins[6] == (t % 600 < 300) && hostToneActive == (t % 200 < 80),
      "same-state heartbeats renew the lease without resetting red or faster beep timing");
  }
  check(hostToneStarts - tonesBeforeHeartbeat == 8,
    "off starts exactly eight finite beeps at 0, 200, 400, 600, 800, 1000, 1200 and 1400 ms");
  hostNow = heartbeatBegan + 1450; loop();
  check(usb.feedback.state == MotionTrial::IDLE && !hostPins[5] && !hostPins[6] && !hostToneActive,
    "900 ms watchdog after the final heartbeat interrupts an active faster beep");
  hostNow = heartbeatBegan + 1600; loop();
  check(hostToneStarts - tonesBeforeHeartbeat == 8 && !hostToneActive,
    "expired feedback cannot start another beep");

  reset();
  ack(send(std::string("SET ") + SESSION + " 1 good\n"), SESSION, 1, "good");
  const auto originalLease = usb.feedback.lastPostMs;
  const std::string invalid[] = {
    "SET 1111111111111111 2 off\n", "SET 0123456789abcdef 1 off\n", "SET 0123456789abcdef 0 off\n",
    "SET 0123456789abcdef -2 off\n", "SET 0123456789abcdef 4294967296 off\n",
    "SET 0123456789abcdef 2 OFF\n", "SET 0123456789abcdef 2 off extra\n",
    "SET 0123456789abcdef 2\n", "STATUS 0123456789abcdef 2 extra\n",
    "SET 0123456789abcdef 2.0 off\n", "SET 0123456789abcdef 2\toff\n",
    "SET  0123456789abcdef 2 off\n", "SET 0123456789abcdef 2 off \n",
    "SET 0123456789abcdef 2 off\r\n", "HELLO ABCDEF0123456789\n", "HELLO 0123456789abcde\n",
    "HELLO 0123456789abcdef x\n", "\n", "?\n", std::string(256, 'x') + "SET 0123456789abcdef 2 off\n",
    std::string("SET 0123456789abcdef 2 off") + std::string(1, '\0') + "\n"
  };
  for (const auto& frame : invalid) {
    hostNow = originalLease + 200;
    check(send(frame).empty(), "malformed/replayed/wrong-session frame gets no ACK");
    check(usb.lastSequence == 1 && usb.feedback.lastPostMs == originalLease &&
      usb.feedback.state == MotionTrial::GOOD && hostPins[5] && !hostPins[6],
      "invalid frame cannot change state, ordering or lease");
  }
  ack(send(std::string("SET ") + SESSION + " 2 good\n"), SESSION, 2, "good");
  ack(send("HELLO fedcba9876543210\n"), "fedcba9876543210", 0, "idle");
  check(!hostPins[5] && !hostPins[6] && !hostToneActive && !usb.feedback.hasLease,
    "HELLO always resets ordering and stops prior session feedback");
  check(send(std::string("SET ") + SESSION + " 999 off\n").empty(), "old session queued command rejected");
  ack(send("SET fedcba9876543210 4294967295 good\n"), "fedcba9876543210", UINT32_MAX, "good");
  check(send("SET fedcba9876543210 1 off\n").empty(), "sequence cannot wrap or replay within session");
  ack(send(std::string("HELLO ") + SESSION + "\n"), SESSION, 0, "idle");

  reset();
  ack(send(std::string("SET ") + SESSION + " 1 good\n"), SESSION, 1, "good");
  const auto partialLease = usb.feedback.lastPostMs;
  check(send("SET 0123456789abcdef 2 o").empty(), "partial frame no effect");
  hostNow = partialLease + 349;
  check(send("f").empty(), "dribbled byte still partial");
  hostNow = partialLease + 350;
  check(send("f\n").empty(), "fixed350ms deadline not extended by more bytes");
  check(usb.lastSequence == 1 && usb.feedback.lastPostMs == partialLease,
    "expired partial never applies or renews lease");
  ack(send(std::string("\nHELLO ") + SESSION + "\n"), SESSION, 0, "idle");
  check(send(std::string(200, 'z') + "\n").empty(), "overlong line discarded fully");
  ack(send(std::string("SET ") + SESSION + " 1 good\n"), SESSION, 1, "good");
  const auto floodLease = usb.feedback.lastPostMs;
  hostNow = floodLease + 900;
  Serial.queue(std::string(4096, 'q')); loop();
  check(Serial.reads == 32 && Serial.available() == 4064, "one loop reads at most32bytes of flood");
  check(usb.feedback.state == MotionTrial::IDLE && !hostPins[5] && !hostPins[6] && !hostToneActive,
    "RX flood cannot delay lease expiry");

  reset();
#if defined(NO_USB) && defined(ARDUINO_UNOR4_WIFI)
  Serial.freeBytes = 0;
  ack(send(std::string("SET ") + SESSION + " 1 off\n"), SESSION, 1, "off");
  check(Serial.capacityQueries == 0, "UNO bridge never queries unsupported availableForWrite");
  check(Serial.largestWrite <= 8 && Serial.longestWireTimeUs < 700,
    "UNO bridge native UART writes bounded to 8 bytes and under 0.7 ms at 115200 8N1");
  check(Serial.bridgeFlushes > 0 && Serial.bridgeLostBytes == 0 && Serial.bridgeShiftRegister.empty(),
    "UNO bridge flushes TX_COMPLETE before the next chunk and loses no final bytes");
  hostNow += 900;
  Serial.queue(std::string(4096, 'q')); loop();
  check(usb.feedback.state == MotionTrial::IDLE && !hostPins[5] && !hostPins[6] && !hostToneActive,
    "UNO bridge TX/RX work preserves watchdog despite unsupported capacity API");
#else
  Serial.freeBytes = 0;
  send(std::string("SET ") + SESSION + " 1 off\n");
  check(replyOffset == 0 && replySize > 0 && usb.feedback.state == MotionTrial::OFF,
    "non-reading host leaves bounded pending ACK without blocking");
  hostNow += 900;
  Serial.queue(std::string(4096, 'q')); loop();
  check(usb.feedback.state == MotionTrial::IDLE && !hostPins[5] && !hostPins[6] && !hostToneActive,
    "TX backpressure cannot delay watchdog");
  check(Serial.reads == 0 && replyOffset == 0, "one pending ACK bounds RX and TX under backpressure");
  Serial.freeBytes = 7;
  for (unsigned i = 0; i < 30; ++i) loop();
  check(replyOffset == replySize && Serial.largestWrite <= 16, "ACK chunks bounded by free capacity and16bytes");
#endif

  reset();
  hostNow = UINT32_MAX - 400;
  ack(send(std::string("SET ") + SESSION + " 1 good\n"), SESSION, 1, "good");
  hostNow = 498; loop(); check(usb.feedback.state == MotionTrial::GOOD, "lease899ms acrossmillisrollover");
  hostNow = 499; loop(); check(usb.feedback.state == MotionTrial::IDLE, "lease900ms acrossmillisrollover");
  hostNow = UINT32_MAX - 100;
  check(send("SET 0123456789abcdef 2 o").empty(), "rollover partial starts");
  hostNow = 249;
  check(send("ff\n").empty(), "partial deadline survivesmillisrollover");
  check(usb.lastSequence == 1, "rollover expired partial cannot change sequence");
  // Every proper prefix of a movement command stays inert, even if a sender
  // vanishes mid-frame. This exercises the actual sketch's parser and loop.
  const auto complete = std::string("SET ") + SESSION + " 2 off\n";
  for (size_t length = 0; length < complete.size(); ++length) {
    reset();
    ack(send(std::string("SET ") + SESSION + " 1 good\n"), SESSION, 1, "good");
    const auto beforePartial = usb.feedback.lastPostMs;
    check(send(complete.substr(0, length)).empty(), "every partial frame has no early ACK");
    check(usb.lastSequence == 1 && usb.feedback.state == MotionTrial::GOOD &&
      usb.feedback.lastPostMs == beforePartial, "every partial frame leaves outputs and lease unchanged");
    hostNow += 900; loop();
    check(usb.feedback.state == MotionTrial::IDLE && !hostPins[5] && !hostPins[6] && !hostToneActive,
      "every partial frame leaves lease watchdog operational");
  }
  printf("PASS: actual USB sketch with simulated GPIO/serial/clock (%s, %u assertions).\n",
#if defined(NO_USB) && defined(ARDUINO_UNOR4_WIFI)
    "official UNO R4 WiFi UART bridge",
#else
    "nativeCDC",
#endif
    assertions);
  return 0;
}
