// USB feedback is the active build. Wi-Fi is preserved below for later use.
// Uncomment this one line, then re-upload, to restore the original Wi-Fi build.
// #define MOTIONTRIAL_ENABLE_WIFI
#ifdef MOTIONTRIAL_ENABLE_WIFI
// MotionTrial local Wi-Fi feedback receiver, protocol version 1.
// Arduino UNO R4 WiFi: green D5, red D6, passive piezo D8, common GND.
// Use 1 kohm LED resistors. A buzzer exceeding 8 mA needs a driver circuit.
#include <WiFiS3.h>
#include "arduino_secrets.h"
#include "FeedbackProtocol.h"

static const uint8_t GREEN_PIN = 5;
static const uint8_t RED_PIN = 6;
static const uint8_t BUZZER_PIN = 8;
static const uint32_t RECONNECT_MS = 10000;
static const uint32_t WIFI_POLL_MS = 100;

WiFiServer server(80);
WiFiClient activeClient;
MotionTrial::RequestParser parser(MOTIONTRIAL_SHARED_KEY);
MotionTrial::FeedbackLease feedback;
bool clientOpen = false;
bool networkReady = false;
bool configReady = false;
bool attemptedConnection = false;
bool redWasOn = false;
bool buzzWasOn = false;
uint32_t acceptedAtMs = 0;
uint32_t lastConnectMs = 0;
uint32_t lastWifiPollMs = 0;
uint32_t offBeganMs = 0;
MotionTrial::State renderedState = MotionTrial::IDLE;

void renderOutputs(uint32_t now) {
  feedback.tick(now);
  if (feedback.state != renderedState) {
    renderedState = feedback.state;
    offBeganMs = now;
  }
  const MotionTrial::OutputPattern outputs = MotionTrial::outputPattern(feedback.state, uint32_t(now - offBeganMs));
  digitalWrite(GREEN_PIN, outputs.green ? HIGH : LOW);
  const bool redOn = outputs.red;
  const bool buzzOn = outputs.beep;
  if (redOn != redWasOn) { digitalWrite(RED_PIN, redOn ? HIGH : LOW); redWasOn = redOn; }
  if (buzzOn && !buzzWasOn) tone(BUZZER_PIN, 2000, 80);
  if (!buzzOn && buzzWasOn) noTone(BUZZER_PIN);
  buzzWasOn = buzzOn;
}

void forceIdle() {
  feedback.idle();
  noTone(BUZZER_PIN);
  digitalWrite(GREEN_PIN, LOW);
  digitalWrite(RED_PIN, LOW);
  redWasOn = false; buzzWasOn = false; renderedState = MotionTrial::IDLE;
}

void closeClient() {
  if (clientOpen) activeClient.stop();
  clientOpen = false;
  parser.reset();
}

void sendResponse(int code) {
  renderOutputs(millis());
  const char* reason = code == 200 ? "OK" : code == 401 ? "Unauthorized" :
    code == 404 ? "Not Found" : code == 405 ? "Method Not Allowed" :
    code == 408 ? "Request Timeout" : code == 413 ? "Content Too Large" :
    code == 431 ? "Request Header Fields Too Large" : "Bad Request";
  char json[144];
  if (code == 200) snprintf(json, sizeof(json),
    "{\"device\":\"motiontrial-uno-r4-wifi\",\"protocol\":1,\"state\":\"%s\"}",
    MotionTrial::stateName(feedback.state));
  else snprintf(json, sizeof(json), "{\"error\":\"request_rejected\"}");
  char response[384];
  const int size = snprintf(response, sizeof(response),
    "HTTP/1.1 %d %s\r\nContent-Type: application/json\r\nContent-Length: %u\r\n"
    "Cache-Control: no-store\r\nConnection: close\r\n\r\n%s", code, reason,
    (unsigned)strlen(json), json);
  if (size > 0 && size < (int)sizeof(response)) activeClient.write((const uint8_t*)response, size);
  renderOutputs(millis());
  closeClient();
}

void serviceHttp() {
  renderOutputs(millis());
  if (!clientOpen) {
    activeClient = server.available();
    renderOutputs(millis());
    if (!activeClient) return;
    clientOpen = true; acceptedAtMs = millis(); parser.reset();
  }
  // Fixed deadline, even if a peer dribbles bytes forever. Never wait for a line/body.
  if (uint32_t(millis() - acceptedAtMs) >= MotionTrial::REQUEST_MS) { sendResponse(408); return; }
  const int available = activeClient.available();
  renderOutputs(millis());
  if (available <= 0) return;
  uint8_t bytes[64];
  const int count = activeClient.read(bytes, available < (int)sizeof(bytes) ? available : sizeof(bytes));
  for (int i = 0; i < count && !parser.done; ++i) parser.feed(bytes[i]);
  renderOutputs(millis());
  if (uint32_t(millis() - acceptedAtMs) >= MotionTrial::REQUEST_MS) { sendResponse(408); return; }
  if (!parser.done) return;
  // Only a complete, authenticated, valid POST refreshes the 900 ms output lease.
  if (parser.status == 200 && parser.post) {
    feedback.accept(parser.requestedState, millis());
    renderOutputs(millis());
  }
  sendResponse(parser.status);
}

void serviceNetwork(uint32_t now) {
  if (uint32_t(now - lastWifiPollMs) < WIFI_POLL_MS) return;
  lastWifiPollMs = now;
  const int status = WiFi.status();
  renderOutputs(millis());
  if (status == WL_CONNECTED) {
    if (!networkReady) {
      forceIdle(); closeClient(); server.begin(); networkReady = true;
      Serial.print("MotionTrial UNO R4 WiFi protocol 1 ready. IP: ");
      Serial.println(WiFi.localIP());
    }
    return;
  }
  // Networking may block inside the vendor library: clear outputs BEFORE reconnecting.
  forceIdle();
  if (networkReady) { closeClient(); server.end(); networkReady = false; }
  if (!attemptedConnection || uint32_t(now - lastConnectMs) >= RECONNECT_MS) {
    attemptedConnection = true; lastConnectMs = now;
    Serial.println("MotionTrial: connecting to configured Wi-Fi...");
    // WiFiS3 uses a distinct overload for truly open, password-free networks.
    // Never retry a protected network as open when its password fails.
    if (strlen(SECRET_PASS) == 0) WiFi.begin(SECRET_SSID);
    else WiFi.begin(SECRET_SSID, SECRET_PASS);
    forceIdle();
  }
}

// Read-only USB diagnostic: a late-opened Serial Monitor can request the IP
// with '?'. Bounded reads never wait for input or renew movement feedback.
void serviceSerialStatus() {
  bool requested = false;
  for (uint8_t i = 0; i < 8 && Serial.available() > 0; ++i)
    if (Serial.read() == '?') requested = true;
  if (!requested) return;
  if (!configReady) Serial.println("MotionTrial: configure private Wi-Fi settings first.");
  else if (!networkReady) Serial.println("MotionTrial: Wi-Fi not connected yet.");
  else {
    Serial.print("MotionTrial UNO R4 WiFi protocol 1 ready. IP: ");
    Serial.println(WiFi.localIP());
  }
}

void setup() {
  pinMode(GREEN_PIN, OUTPUT); pinMode(RED_PIN, OUTPUT); pinMode(BUZZER_PIN, OUTPUT);
  forceIdle();
  Serial.begin(115200); // Never wait for Serial: USB power-bank operation must work.
  configReady = MotionTrial::isHexKey(MOTIONTRIAL_SHARED_KEY) &&
    strlen(SECRET_SSID) > 0 && strcmp(SECRET_SSID, "YOUR_2_4_GHZ_WIFI_NAME") != 0;
  if (!configReady) Serial.println("MotionTrial: edit private arduino_secrets.h before use. Outputs stay idle.");
}

void loop() {
  renderOutputs(millis());
  serviceSerialStatus();
  renderOutputs(millis());
  if (!configReady) return;
  serviceNetwork(millis());
  renderOutputs(millis());
  if (networkReady) serviceHttp();
  renderOutputs(millis());
}

#else
#include <Arduino.h>
#include <stdio.h>
#include "FeedbackProtocol.h"
#include "UsbFeedback.h"

static const uint8_t GREEN_PIN = 5;
static const uint8_t RED_PIN = 6;
static const uint8_t BUZZER_PIN = 8;
MotionTrial::UsbFeedback usb;
bool redWasOn = false, buzzWasOn = false;
uint32_t offBeganMs = 0;
MotionTrial::State renderedState = MotionTrial::IDLE;
char reply[160];
size_t replySize = 0, replyOffset = 0;

void renderOutputs(uint32_t now) {
  usb.tick(now);
  if (usb.feedback.state != renderedState) {
    renderedState = usb.feedback.state;
    offBeganMs = now;
  }
  const MotionTrial::OutputPattern outputs = MotionTrial::outputPattern(
    usb.feedback.state, uint32_t(now - offBeganMs));
  digitalWrite(GREEN_PIN, outputs.green ? HIGH : LOW);
  if (outputs.red != redWasOn) {
    digitalWrite(RED_PIN, outputs.red ? HIGH : LOW); redWasOn = outputs.red;
  }
  if (outputs.beep && !buzzWasOn) tone(BUZZER_PIN, 2000, 80);
  if (!outputs.beep && buzzWasOn) noTone(BUZZER_PIN);
  buzzWasOn = outputs.beep;
}

void queueUsbReply() {
  const int count = snprintf(reply, sizeof(reply),
    "{\"device\":\"motiontrial-uno-r4-usb\",\"protocol\":1,\"session\":\"%s\",\"seq\":%lu,\"state\":\"%s\"}\n",
    usb.session, (unsigned long)usb.lastSequence, MotionTrial::stateName(usb.feedback.state));
  replySize = count > 0 && count < (int)sizeof(reply) ? (size_t)count : 0;
  replyOffset = 0;
}

void serviceUsbReply() {
  if (replyOffset >= replySize) return;
  size_t count = replySize - replyOffset;
#if defined(NO_USB) && defined(ARDUINO_UNOR4_WIFI)
  // Official UNO R4 WiFi core 1.6 routes Serial through the ESP32 USB/UART
  // bridge. UART inherits availableForWrite()==0 even when it can transmit.
  // Its native mutable-buffer write returns at TX_DATA_EMPTY, before the last
  // byte has finished shifting. Complete each chunk before starting another
  // transfer, or the core can lose a byte. There is no host flow control:
  // eight 8N1 bytes at 115200 take less than 0.7 ms, including this flush.
  // Service the independent lease on both sides of the hardware transfer.
  if (count > 8) count = 8;
  renderOutputs(millis());
  replyOffset += Serial.write((uint8_t*)reply + replyOffset, count);
  Serial.flush(); // Wait only for UART TX_COMPLETE, not for the PC to read.
  renderOutputs(millis());
#else
  // UNO R4 USB writes may wait when full. Never request more than free space.
  const int available = Serial.availableForWrite();
  if (available <= 0) return;
  if (count > (size_t)available) count = (size_t)available;
  if (count > 16) count = 16;
  replyOffset += Serial.write((const uint8_t*)reply + replyOffset, count);
#endif
}

void setup() {
  pinMode(GREEN_PIN, OUTPUT); pinMode(RED_PIN, OUTPUT); pinMode(BUZZER_PIN, OUTPUT);
  noTone(BUZZER_PIN); digitalWrite(GREEN_PIN, LOW); digitalWrite(RED_PIN, LOW);
  Serial.begin(115200); // No Serial wait; no Wi-Fi library, credentials or networking.
}

void loop() {
  renderOutputs(millis());
  serviceUsbReply();
  // Bound RX work. Keep one pending response so a non-reading host cannot block
  // the lease watchdog or overwrite a partially transmitted JSON line.
  for (uint8_t i = 0; i < 32 && replyOffset >= replySize && Serial.available() > 0; ++i) {
    const int byte = Serial.read();
    if (byte < 0) break;
    if (usb.feed((uint8_t)byte, millis())) {
      renderOutputs(millis());
      queueUsbReply();
    }
  }
  renderOutputs(millis());
  serviceUsbReply();
}
#endif
